"""Summarise live data file sizes into a fixed, log-spaced histogram."""

from __future__ import annotations

from collections.abc import Iterable

from icevue.models import FileSizeBucket, FileSizeDistribution

MIB = 1024 * 1024
DEFAULT_TARGET_FILE_SIZE = 512 * MIB

# Upper bounds (exclusive). The last bucket is open-ended.
BUCKET_EDGES = (1, 8, 32, 64, 128, 256, 512, 1024)


TARGET_PROPERTY = "write.target-file-size-bytes"
SOURCE_S3TABLES = "s3tables-compaction"
SOURCE_PROPERTY = "table-property"
SOURCE_DEFAULT = "default"


def resolve_target_file_size(
    properties: dict[str, str], managed_target_mb: int | None = None
) -> tuple[int, str]:
    """Pick the effective target size and say where it came from.

    Managed compaction (S3 Tables ``targetFileSizeMB``) wins because it is what
    the table's files converge to; otherwise the Iceberg write property; else
    the Iceberg default of 512 MiB.
    """
    if managed_target_mb is not None and managed_target_mb > 0:
        return managed_target_mb * MIB, SOURCE_S3TABLES
    raw = properties.get(TARGET_PROPERTY)
    try:
        value = int(raw) if raw is not None else 0
    except ValueError:
        value = 0
    if value > 0:
        return value, SOURCE_PROPERTY
    return DEFAULT_TARGET_FILE_SIZE, SOURCE_DEFAULT


def build_distribution(
    files: Iterable[tuple[int, int]],
    *,
    snapshot_id: int | None,
    target_bytes: int,
    target_source: str = SOURCE_DEFAULT,
    delete_file_count: int = 0,
    delete_file_bytes: int = 0,
) -> FileSizeDistribution:
    """Build a histogram from ``(file_size_in_bytes, record_count)`` pairs."""
    edges = [edge * MIB for edge in BUCKET_EDGES]
    lowers = [0, *edges]
    buckets = [
        FileSizeBucket(
            lower_bytes=lower,
            upper_bytes=edges[index] if index < len(edges) else None,
        )
        for index, lower in enumerate(lowers)
    ]

    sizes: list[int] = []
    total_records = 0
    for size, records in files:
        size = max(0, int(size))
        records = max(0, int(records))
        sizes.append(size)
        total_records += records
        index = next((i for i, edge in enumerate(edges) if size < edge), len(edges))
        bucket = buckets[index]
        bucket.file_count += 1
        bucket.total_bytes += size
        bucket.record_count += records

    sizes.sort()
    count = len(sizes)
    total = sum(sizes)
    median = None
    if count:
        middle = count // 2
        median = sizes[middle] if count % 2 else (sizes[middle - 1] + sizes[middle]) // 2

    return FileSizeDistribution(
        snapshot_id=snapshot_id,
        data_file_count=count,
        total_bytes=total,
        total_records=total_records,
        min_bytes=sizes[0] if count else None,
        median_bytes=median,
        mean_bytes=total // count if count else None,
        max_bytes=sizes[-1] if count else None,
        target_file_size_bytes=target_bytes,
        target_file_size_source=target_source,
        delete_file_count=delete_file_count,
        delete_file_bytes=delete_file_bytes,
        buckets=buckets,
    )
