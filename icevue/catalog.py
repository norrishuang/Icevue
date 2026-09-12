"""PyIceberg catalog adapter — read and write operations."""

from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any

import boto3
from botocore.exceptions import ClientError
from pyiceberg.catalog import load_catalog
from pyiceberg.exceptions import (
    BadRequestError,
    NoSuchNamespaceError,
    NoSuchTableError,
    RESTError,
)

try:
    from pyiceberg.exceptions import NamespaceAlreadyExistsError  # type: ignore[attr-defined]
except ImportError:
    NamespaceAlreadyExistsError = Exception  # type: ignore[assignment,misc]

try:
    from pyiceberg.exceptions import TableAlreadyExistsError  # type: ignore[attr-defined]
except ImportError:
    TableAlreadyExistsError = Exception  # type: ignore[assignment,misc]
from pyiceberg.partitioning import (
    PartitionField as IcebergPartitionField,
    PartitionSpec as IcebergPartitionSpec,
)
from pyiceberg.schema import Schema
from pyiceberg.table import Table
from pyiceberg.transforms import IdentityTransform
from pyiceberg.types import (
    BinaryType,
    BooleanType,
    DateType,
    DecimalType,
    DoubleType,
    FixedType,
    FloatType,
    IntegerType,
    LongType,
    NestedField,
    StringType,
    TimestampType,
    TimestamptzType,
    TimeType,
    UUIDType,
)

from icevue.config import Settings
from icevue.errors import (
    CatalogConfigurationError,
    CatalogConnectionError,
    NamespaceNotFoundError,
    TableNotFoundError,
)
from icevue.models import (
    CatalogStatus,
    CatalogTree,
    NamespaceDetail,
    NamespaceNode,
    PartitionField,
    PartitionPage,
    PartitionSpec,
    SchemaField,
    SchemaVersion,
    SnapshotInfo,
    SortField,
    SortOrder,
    TableDetail,
    TableInput,
    TableRef,
)

_SIMPLE_TYPES: dict[str, Any] = {
    "boolean": BooleanType(),
    "bool": BooleanType(),
    "int": IntegerType(),
    "integer": IntegerType(),
    "long": LongType(),
    "bigint": LongType(),
    "float": FloatType(),
    "double": DoubleType(),
    "date": DateType(),
    "time": TimeType(),
    "timestamp": TimestampType(),
    "timestamptz": TimestamptzType(),
    "timestamp_tz": TimestamptzType(),
    "string": StringType(),
    "varchar": StringType(),
    "text": StringType(),
    "uuid": UUIDType(),
    "binary": BinaryType(),
    "bytes": BinaryType(),
}


def _parse_iceberg_type(type_str: str) -> Any:
    lower = type_str.lower().strip()
    if lower in _SIMPLE_TYPES:
        return _SIMPLE_TYPES[lower]
    m = re.match(r"decimal\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)", lower)
    if m:
        return DecimalType(int(m.group(1)), int(m.group(2)))
    m = re.match(r"fixed\s*\(\s*(\d+)\s*\)", lower)
    if m:
        return FixedType(int(m.group(1)))
    return StringType()


_FLAT_NAMESPACE_SIGNING_NAMES = frozenset({"glue", "s3tables"})


def _iso(timestamp_ms: int | None) -> str | None:
    if timestamp_ms is None:
        return None
    return datetime.fromtimestamp(timestamp_ms / 1000, tz=UTC).isoformat()


def _safe_string(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, Enum):
        return str(value.value)
    return str(value)


def _json_value(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, bytes):
        return value.hex()
    if isinstance(value, dict):
        return {str(key): _json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    return value


def _model_dict(value: Any) -> dict[str, Any]:
    if hasattr(value, "model_dump"):
        return value.model_dump(by_alias=True, exclude_none=True)
    if hasattr(value, "dict"):
        return value.dict(by_alias=True, exclude_none=True)
    return {}


class IcebergCatalogService:
    """Translate PyIceberg objects into stable API response models."""

    def __init__(self, settings: Settings, display_name: str | None = None):
        properties = settings.pyiceberg_properties()
        if not properties.get("uri"):
            raise CatalogConfigurationError(
                "ICEVUE_CATALOG_URI is required when ICEVUE_DEMO_MODE is false"
            )
        self.settings = settings
        self.display_name = display_name or settings.catalog_name
        self.catalog = load_catalog(settings.catalog_name, **properties)
        self.signing_name = str(properties.get("rest.signing-name", "")).lower()
        self.supports_nested_namespaces = (
            self.signing_name not in _FLAT_NAMESPACE_SIGNING_NAMES
        )
        self.glue_client = None
        if self.signing_name == "glue":
            self.glue_client = boto3.client(
                "glue",
                region_name=properties.get("rest.signing-region"),
            )

    @staticmethod
    def _is_missing_namespace_error(exc: Exception) -> bool:
        return isinstance(exc, NoSuchNamespaceError) or (
            isinstance(exc, RESTError) and "EntityNotFoundException" in str(exc)
        )

    @staticmethod
    def _is_iceberg_glue_table(table: dict[str, Any]) -> bool:
        parameters = table.get("Parameters") or {}
        table_type = str(parameters.get("table_type", "")).upper()
        return table_type == "ICEBERG" or bool(parameters.get("metadata_location"))

    def _list_glue_tables(self, namespace: tuple[str, ...]) -> list[tuple[str, ...]]:
        if self.glue_client is None:
            return []

        request = {"DatabaseName": ".".join(namespace)}
        if self.settings.catalog_warehouse:
            request["CatalogId"] = self.settings.catalog_warehouse

        tables = []
        try:
            paginator = self.glue_client.get_paginator("get_tables")
            for page in paginator.paginate(**request):
                tables.extend(
                    (*namespace, table["Name"])
                    for table in page.get("TableList", [])
                    if self._is_iceberg_glue_table(table)
                )
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") != "EntityNotFoundException":
                raise
        return tables

    def _list_tables(self, namespace: tuple[str, ...]) -> list[tuple[str, ...]]:
        if getattr(self, "signing_name", "") == "glue":
            return self._list_glue_tables(namespace)
        return [tuple(identifier) for identifier in self.catalog.list_tables(namespace)]

    def _safe_list_tables(self, namespace: tuple[str, ...]) -> list[tuple[str, ...]]:
        try:
            return self._list_tables(namespace)
        except Exception as exc:
            if not self._is_missing_namespace_error(exc):
                raise
            return []

    def _list_all_namespaces(self) -> list[tuple[str, ...]]:
        pending = [tuple(namespace) for namespace in self.catalog.list_namespaces()]
        if not getattr(self, "supports_nested_namespaces", True):
            return sorted(
                pending,
                key=lambda item: tuple(part.lower() for part in item),
            )

        namespaces: set[tuple[str, ...]] = set()

        while pending:
            namespace = pending.pop()
            if namespace in namespaces:
                continue
            namespaces.add(namespace)

            try:
                children = self.catalog.list_namespaces(namespace)
            except (BadRequestError, NoSuchNamespaceError):
                children = []
            for child in children:
                child_tuple = tuple(child)
                if child_tuple[: len(namespace)] != namespace:
                    child_tuple = (*namespace, *child_tuple)
                if child_tuple not in namespaces:
                    pending.append(child_tuple)

        return sorted(
            namespaces,
            key=lambda item: tuple(part.lower() for part in item),
        )

    def tree(self) -> CatalogTree:
        try:
            namespaces = self._list_all_namespaces()
            if getattr(self, "signing_name", "") == "glue" and namespaces:
                worker_count = min(8, len(namespaces))
                with ThreadPoolExecutor(max_workers=worker_count) as executor:
                    table_lists = list(executor.map(self._safe_list_tables, namespaces))
            else:
                table_lists = [self._safe_list_tables(namespace) for namespace in namespaces]

            nodes = []
            for namespace, identifiers in zip(namespaces, table_lists, strict=True):
                tables = sorted(
                    identifiers,
                    key=lambda item: item[-1].lower(),
                )
                nodes.append(
                    NamespaceNode(
                        namespace=".".join(namespace),
                        display_name=namespace[-1],
                        tables=[
                            TableRef(namespace=".".join(identifier[:-1]), name=identifier[-1])
                            for identifier in tables
                        ],
                    )
                )
        except Exception as exc:
            raise CatalogConnectionError(f"Unable to list the Iceberg catalog: {exc}") from exc

        return CatalogTree(
            catalog=CatalogStatus(
                id=self.settings.catalog_name,
                name=getattr(self, "display_name", self.settings.catalog_name),
                mode="rest",
                connected=True,
                uri=self.settings.catalog_uri,
            ),
            namespaces=nodes,
        )

    def _load_table(self, namespace: str, name: str) -> Table:
        identifier = (*namespace.split("."), name)
        try:
            return self.catalog.load_table(identifier)
        except NoSuchTableError as exc:
            raise TableNotFoundError(f"Table {namespace}.{name} was not found") from exc
        except Exception as exc:
            raise CatalogConnectionError(f"Unable to load table {namespace}.{name}: {exc}") from exc

    def table(self, namespace: str, name: str) -> TableDetail:
        table = self._load_table(namespace, name)
        metadata = table.metadata
        current_schema = table.schema()
        field_names = {field.field_id: field.name for field in current_schema.fields}

        schemas = [
            SchemaVersion(
                schema_id=schema.schema_id,
                current=schema.schema_id == metadata.current_schema_id,
                fields=[
                    SchemaField(
                        id=field.field_id,
                        name=field.name,
                        type=str(field.field_type),
                        required=field.required,
                        doc=field.doc,
                    )
                    for field in schema.fields
                ],
            )
            for schema in metadata.schemas
        ]

        specs = [
            PartitionSpec(
                spec_id=spec.spec_id,
                current=spec.spec_id == metadata.default_spec_id,
                fields=[
                    PartitionField(
                        field_id=field.field_id,
                        source_id=field.source_id,
                        name=field.name,
                        transform=str(field.transform),
                        source_column=field_names.get(field.source_id),
                    )
                    for field in spec.fields
                ],
            )
            for spec in metadata.partition_specs
        ]

        sort_orders = [
            SortOrder(
                order_id=order.order_id,
                current=order.order_id == metadata.default_sort_order_id,
                fields=[
                    SortField(
                        source_id=field.source_id,
                        transform=str(field.transform),
                        direction=_safe_string(field.direction),
                        null_order=_safe_string(field.null_order),
                        source_column=field_names.get(field.source_id),
                    )
                    for field in order.fields
                ],
            )
            for order in metadata.sort_orders
        ]

        snapshots = []
        for snapshot in reversed(metadata.snapshots):
            summary = snapshot.summary
            summary_dict = {}
            if summary is not None:
                summary_dict = {
                    str(key): str(value)
                    for key, value in _model_dict(summary).items()
                    if key != "operation"
                }
            snapshots.append(
                SnapshotInfo(
                    snapshot_id=snapshot.snapshot_id,
                    parent_snapshot_id=snapshot.parent_snapshot_id,
                    sequence_number=snapshot.sequence_number,
                    timestamp_ms=snapshot.timestamp_ms,
                    timestamp=_iso(snapshot.timestamp_ms) or "",
                    operation=_safe_string(getattr(summary, "operation", None)) or None,
                    manifest_list=snapshot.manifest_list,
                    summary=summary_dict,
                    current=snapshot.snapshot_id == metadata.current_snapshot_id,
                )
            )

        refs = {
            name: _json_value(_model_dict(ref))
            for name, ref in getattr(metadata, "refs", {}).items()
        }
        return TableDetail(
            namespace=namespace,
            name=name,
            identifier=f"{namespace}.{name}",
            location=table.location(),
            format_version=metadata.format_version,
            metadata_location=getattr(table, "metadata_location", None),
            last_updated_ms=metadata.last_updated_ms,
            last_updated=_iso(metadata.last_updated_ms),
            current_snapshot_id=metadata.current_snapshot_id,
            current_schema_id=metadata.current_schema_id,
            default_spec_id=metadata.default_spec_id,
            default_sort_order_id=metadata.default_sort_order_id,
            schemas=schemas,
            partition_specs=specs,
            sort_orders=sort_orders,
            snapshots=snapshots,
            properties={str(key): str(value) for key, value in metadata.properties.items()},
            refs=refs,
        )

    def partitions(
        self,
        namespace: str,
        name: str,
        page: int,
        page_size: int,
        query: str | None,
    ) -> PartitionPage:
        table = self._load_table(namespace, name)
        try:
            arrow_table = table.inspect.partitions()
            rows = [_json_value(row) for row in arrow_table.to_pylist()]
        except Exception as exc:
            raise CatalogConnectionError(
                f"Unable to inspect partitions for {namespace}.{name}: {exc}"
            ) from exc

        if query:
            lowered = query.lower()
            rows = [
                row
                for row in rows
                if lowered in json.dumps(row, default=str, sort_keys=True).lower()
            ]

        total = len(rows)
        start = (page - 1) * page_size
        page_rows = rows[start : start + page_size]
        columns = list(arrow_table.column_names)
        return PartitionPage(
            rows=page_rows,
            columns=columns,
            page=page,
            page_size=page_size,
            total=total,
            has_more=start + page_size < total,
        )

    def get_namespace(self, namespace: str) -> NamespaceDetail:
        ns_tuple = tuple(namespace.split("."))
        try:
            props = self.catalog.load_namespace_properties(ns_tuple)
            return NamespaceDetail(
                namespace=namespace,
                properties={str(k): str(v) for k, v in props.items()},
            )
        except NoSuchNamespaceError as exc:
            raise NamespaceNotFoundError(f"Namespace {namespace} was not found") from exc
        except Exception as exc:
            raise CatalogConnectionError(f"Unable to load namespace {namespace}: {exc}") from exc

    def create_namespace(self, namespace: str, properties: dict[str, str]) -> NamespaceDetail:
        ns_tuple = tuple(namespace.split("."))
        try:
            self.catalog.create_namespace(ns_tuple, properties=properties)
        except NamespaceAlreadyExistsError as exc:
            raise CatalogConnectionError(f"Namespace '{namespace}' already exists") from exc
        except Exception as exc:
            raise CatalogConnectionError(f"Unable to create namespace {namespace}: {exc}") from exc
        try:
            actual = self.catalog.load_namespace_properties(ns_tuple)
            return NamespaceDetail(
                namespace=namespace,
                properties={str(k): str(v) for k, v in actual.items()},
            )
        except Exception:
            return NamespaceDetail(namespace=namespace, properties=properties)

    def create_table(self, value: TableInput) -> TableDetail:
        nested_fields = []
        for field_id, field_input in enumerate(value.fields, start=1):
            field_type = _parse_iceberg_type(field_input.type)
            nested_fields.append(
                NestedField(
                    field_id=field_id,
                    name=field_input.name,
                    field_type=field_type,
                    required=field_input.required,
                    doc=field_input.doc,
                )
            )
        schema = Schema(*nested_fields)

        partition_spec = None
        if value.partition_by:
            name_to_id = {f.name: f.field_id for f in nested_fields}
            partition_fields = []
            for partition_id, pfield_name in enumerate(value.partition_by, start=1000):
                source_id = name_to_id.get(pfield_name)
                if source_id is None:
                    raise CatalogConnectionError(
                        f"Partition field '{pfield_name}' does not exist in schema"
                    )
                partition_fields.append(
                    IcebergPartitionField(
                        source_id=source_id,
                        field_id=partition_id,
                        name=pfield_name,
                        transform=IdentityTransform(),
                    )
                )
            partition_spec = IcebergPartitionSpec(fields=tuple(partition_fields))

        identifier = (*value.namespace.split("."), value.name)
        kwargs: dict[str, Any] = {"schema": schema, "properties": value.properties}
        if value.location:
            kwargs["location"] = value.location
        if partition_spec is not None:
            kwargs["partition_spec"] = partition_spec

        try:
            self.catalog.create_table(identifier, **kwargs)
        except TableAlreadyExistsError as exc:
            raise CatalogConnectionError(
                f"Table '{value.namespace}.{value.name}' already exists"
            ) from exc
        except Exception as exc:
            raise CatalogConnectionError(
                f"Unable to create table {value.namespace}.{value.name}: {exc}"
            ) from exc

        return self.table(value.namespace, value.name)
