"""Read-only PyIceberg catalog adapter."""

from __future__ import annotations

import json
from datetime import UTC, date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any

from pyiceberg.catalog import load_catalog
from pyiceberg.exceptions import BadRequestError, NoSuchNamespaceError, NoSuchTableError
from pyiceberg.table import Table

from icevue.config import Settings
from icevue.errors import CatalogConfigurationError, CatalogConnectionError, TableNotFoundError
from icevue.models import (
    CatalogStatus,
    CatalogTree,
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
    TableRef,
)


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
        self.supports_nested_namespaces = (
            str(properties.get("rest.signing-name", "")).lower() != "s3tables"
        )

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
                # S3 Tables supports only single-level namespaces.
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
            nodes = []
            for namespace in namespaces:
                tables = sorted(
                    self.catalog.list_tables(namespace),
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
