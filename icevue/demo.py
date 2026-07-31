"""Deterministic demo metadata used for local evaluation."""

from __future__ import annotations

from datetime import UTC, datetime

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


def _iso(timestamp_ms: int) -> str:
    return datetime.fromtimestamp(timestamp_ms / 1000, tz=UTC).isoformat()


TABLES = [
    TableRef(namespace="analytics", name="events"),
    TableRef(namespace="analytics", name="sessions"),
    TableRef(namespace="commerce", name="customers"),
    TableRef(namespace="commerce", name="orders"),
    TableRef(namespace="commerce.raw", name="order_events"),
]

PARTITIONS = [
    {
        "event_date": f"2026-07-{day:02d}",
        "event_type": event_type,
        "record_count": 1_250_000 + day * 18_731 + index * 76_421,
        "file_count": 18 + ((day + index) % 9),
        "total_data_file_size_in_bytes": 196_000_000 + day * 2_750_000,
        "last_updated_at": f"2026-07-{day:02d}T23:48:12Z",
    }
    for day in range(1, 31)
    for index, event_type in enumerate(("page_view", "checkout", "purchase"))
]


class DemoCatalogService:
    """In-memory catalog with production-shaped responses."""

    def __init__(self, catalog_id: str = "demo", name: str = "Demo"):
        self.catalog_id = catalog_id
        self.name = name

    def tree(self) -> CatalogTree:
        namespaces = []
        for namespace in ("analytics", "commerce", "commerce.raw"):
            namespaces.append(
                NamespaceNode(
                    namespace=namespace,
                    display_name=namespace.split(".")[-1],
                    tables=[table for table in TABLES if table.namespace == namespace],
                )
            )
        return CatalogTree(
            catalog=CatalogStatus(
                id=self.catalog_id,
                name=self.name,
                mode="demo",
                connected=True,
                uri=None,
                message="Using built-in sample metadata",
            ),
            namespaces=namespaces,
        )

    def table(self, namespace: str, name: str) -> TableDetail:
        is_events = name in {"events", "order_events"}
        fields = [
            SchemaField(id=1, name="event_id", type="string", required=True),
            SchemaField(id=2, name="event_time", type="timestamptz", required=True),
            SchemaField(id=3, name="event_type", type="string", required=True),
            SchemaField(id=4, name="user_id", type="long", required=False),
            SchemaField(
                id=5,
                name="context",
                type="struct<device: string, country: string, attributes: map<string, string>>",
                required=False,
                doc="Enrichment attributes captured at ingestion time.",
            ),
            SchemaField(id=6, name="amount", type="decimal(18, 2)", required=False),
        ]
        if not is_events:
            fields = [
                SchemaField(id=1, name="id", type="long", required=True),
                SchemaField(id=2, name="created_at", type="timestamptz", required=True),
                SchemaField(id=3, name="status", type="string", required=True),
                SchemaField(id=4, name="payload", type="string", required=False),
            ]

        now_ms = 1785368892000
        partition_fields = (
            [
                PartitionField(
                    field_id=1000,
                    source_id=2,
                    name="event_date",
                    transform="day",
                    source_column="event_time" if is_events else "created_at",
                ),
                PartitionField(
                    field_id=1001,
                    source_id=3,
                    name="event_type",
                    transform="identity",
                    source_column="event_type" if is_events else "status",
                ),
            ]
            if is_events
            else []
        )
        added_data_files = (24, 8, 26)
        added_records = (1_420_000, 84_392_821, 1_588_000)
        total_data_files = (648, 599, 625)
        total_records = (84_392_821, 84_392_821, 85_980_821)
        total_file_sizes = (14_683_920_144, 14_120_640_000, 14_339_060_000)
        snapshots = [
            SnapshotInfo(
                snapshot_id=913740415582630 + index,
                parent_snapshot_id=913740415582629 + index if index else None,
                sequence_number=122 + index,
                timestamp_ms=now_ms - (2 - index) * 86_400_000,
                timestamp=_iso(now_ms - (2 - index) * 86_400_000),
                operation="append" if index != 1 else "replace",
                manifest_list=(
                    f"s3://warehouse/{namespace.replace('.', '/')}/{name}/metadata/"
                    f"snap-{913740415582630 + index}.avro"
                ),
                summary={
                    "added-data-files": str(added_data_files[index]),
                    "added-records": str(added_records[index]),
                    **(
                        {
                            "deleted-data-files": "57",
                            "deleted-records": "84392821",
                        }
                        if index == 1
                        else {}
                    ),
                    "total-data-files": str(total_data_files[index]),
                    "total-records": str(total_records[index]),
                    "total-files-size": str(total_file_sizes[index]),
                },
                current=index == 2,
            )
            for index in range(3)
        ]
        return TableDetail(
            namespace=namespace,
            name=name,
            identifier=f"{namespace}.{name}",
            location=f"s3://warehouse/{namespace.replace('.', '/')}/{name}",
            format_version=2,
            metadata_location=(
                f"s3://warehouse/{namespace.replace('.', '/')}/{name}/metadata/"
                "00042-a4dc4f.metadata.json"
            ),
            last_updated_ms=now_ms,
            last_updated=_iso(now_ms),
            current_snapshot_id=snapshots[-1].snapshot_id,
            current_schema_id=2,
            default_spec_id=1 if partition_fields else 0,
            default_sort_order_id=1,
            schemas=[
                SchemaVersion(schema_id=1, fields=fields[:-1], current=False),
                SchemaVersion(schema_id=2, fields=fields, current=True),
            ],
            partition_specs=[
                PartitionSpec(
                    spec_id=1 if partition_fields else 0,
                    fields=partition_fields,
                    current=True,
                )
            ],
            sort_orders=[
                SortOrder(
                    order_id=1,
                    current=True,
                    fields=[
                        SortField(
                            source_id=2,
                            source_column="event_time" if is_events else "created_at",
                            transform="identity",
                            direction="desc",
                            null_order="nulls-last",
                        )
                    ],
                )
            ],
            snapshots=snapshots,
            properties={
                "commit.retry.num-retries": "4",
                "history.expire.max-snapshot-age-ms": "432000000",
                "read.split.target-size": "134217728",
                "write.distribution-mode": "hash",
                "write.metadata.compression-codec": "gzip",
                "write.parquet.compression-codec": "zstd",
                "write.target-file-size-bytes": "536870912",
            },
            refs={
                "main": {"snapshot-id": snapshots[-1].snapshot_id, "type": "branch"},
                "release-2026-07": {"snapshot-id": snapshots[0].snapshot_id, "type": "tag"},
            },
        )

    def partitions(
        self,
        namespace: str,
        name: str,
        page: int,
        page_size: int,
        query: str | None,
    ) -> PartitionPage:
        del namespace
        rows = PARTITIONS if name in {"events", "order_events"} else []
        if query:
            lowered = query.lower()
            rows = [row for row in rows if lowered in " ".join(map(str, row.values())).lower()]
        start = (page - 1) * page_size
        page_rows = rows[start : start + page_size]
        columns = list(PARTITIONS[0]) if PARTITIONS else []
        return PartitionPage(
            rows=page_rows,
            columns=columns,
            page=page,
            page_size=page_size,
            total=len(rows),
            has_more=start + page_size < len(rows),
        )
