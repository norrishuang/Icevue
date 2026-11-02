"""Read-only PyIceberg catalog adapter."""

from __future__ import annotations

import json
import logging
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
from pyiceberg.manifest import DataFileContent
from pyiceberg.table import Table
from pyiceberg.utils.concurrent import ExecutorFactory

from icevue.config import Settings
from icevue.errors import CatalogConfigurationError, CatalogConnectionError, TableNotFoundError
from icevue.file_sizes import build_distribution, resolve_target_file_size
from icevue.models import (
    CatalogStatus,
    CatalogTree,
    FileSizeDistribution,
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

logger = logging.getLogger(__name__)

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
        self.s3tables_client = None
        if self.signing_name == "s3tables" and settings.catalog_warehouse:
            self.s3tables_client = boto3.client(
                "s3tables",
                region_name=properties.get("rest.signing-region"),
            )

    def _s3tables_target_mb(self, namespace: str, name: str) -> int | None:
        """targetFileSizeMB of S3 Tables managed compaction, if enabled.

        Best effort: a missing permission or API error falls back to the
        Iceberg table property instead of failing the whole chart.
        """
        if self.s3tables_client is None:
            return None
        try:
            response = self.s3tables_client.get_table_maintenance_configuration(
                tableBucketARN=self.settings.catalog_warehouse,
                namespace=namespace,
                name=name,
            )
        except Exception:
            logger.warning(
                "Could not read S3 Tables maintenance config for %s.%s",
                namespace,
                name,
                exc_info=True,
            )
            return None
        compaction = (response.get("configuration") or {}).get("icebergCompaction") or {}
        if compaction.get("status") != "enabled":
            return None
        settings = (compaction.get("settings") or {}).get("icebergCompaction") or {}
        value = settings.get("targetFileSizeMB")
        return int(value) if isinstance(value, int) and value > 0 else None
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

    def file_sizes(self, namespace: str, name: str) -> FileSizeDistribution:
        """Histogram of live data files in the current snapshot.

        Reads only manifest entries (no column metrics), so cost scales with
        manifest count rather than schema width.
        """
        table = self._load_table(namespace, name)
        metadata = table.metadata
        target, target_source = resolve_target_file_size(
            dict(metadata.properties), self._s3tables_target_mb(namespace, name)
        )
        snapshot = metadata.current_snapshot()
        if snapshot is None:
            return build_distribution(
                [], snapshot_id=None, target_bytes=target, target_source=target_source
            )

        io = table.io

        def read(manifest):
            data: list[tuple[int, int]] = []
            deletes = [0, 0]
            for entry in manifest.fetch_manifest_entry(io, discard_deleted=True):
                data_file = entry.data_file
                if data_file.content == DataFileContent.DATA:
                    data.append((data_file.file_size_in_bytes, data_file.record_count))
                else:
                    deletes[0] += 1
                    deletes[1] += data_file.file_size_in_bytes
            return data, deletes

        try:
            results = list(ExecutorFactory.get_or_create().map(read, snapshot.manifests(io)))
        except Exception as exc:
            raise CatalogConnectionError(
                f"Unable to read data files for {namespace}.{name}: {exc}"
            ) from exc

        return build_distribution(
            (pair for data, _ in results for pair in data),
            snapshot_id=snapshot.snapshot_id,
            target_bytes=target,
            target_source=target_source,
            delete_file_count=sum(deletes[0] for _, deletes in results),
            delete_file_bytes=sum(deletes[1] for _, deletes in results),
        )
