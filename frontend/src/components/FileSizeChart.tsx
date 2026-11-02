import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import { LoaderCircle, RotateCw } from "lucide-react";
import { getFileSizes } from "../api";
import { formatBytes, formatCompact, formatNumber } from "../format";
import type { FileSizeBucket, FileSizeDistribution, TableRef } from "../types";
import { useWidth } from "./SnapshotTrends";

const HEIGHT = 200;
const MARGIN = { top: 16, right: 16, bottom: 30, left: 52 };

const TARGET_SOURCE_LABEL: Record<string, string> = {
  "s3tables-compaction": "S3 Tables",
  "table-property": "property",
  default: "default",
};

const TARGET_SOURCE_TITLE: Record<string, string> = {
  "s3tables-compaction": "S3 Tables managed compaction targetFileSizeMB",
  "table-property": "Table property write.target-file-size-bytes",
  default: "Not configured; Iceberg default 512 MiB",
};

type Metric = "files" | "bytes";

function sizeLabel(bytes: number): string {
  const mib = bytes / 1024 / 1024;
  return mib >= 1024 ? `${mib / 1024}G` : `${mib}M`;
}

/** Short axis label such as "<1M", "8–32M" or "≥1G". */
export function bucketLabel(bucket: FileSizeBucket): string {
  if (bucket.lower_bytes === 0 && bucket.upper_bytes !== null) return `<${sizeLabel(bucket.upper_bytes)}`;
  if (bucket.upper_bytes === null) return `≥${sizeLabel(bucket.lower_bytes)}`;
  return `${sizeLabel(bucket.lower_bytes)}–${sizeLabel(bucket.upper_bytes)}`;
}

function bucketRange(bucket: FileSizeBucket): string {
  if (bucket.lower_bytes === 0 && bucket.upper_bytes !== null) return `< ${formatBytes(bucket.upper_bytes)}`;
  if (bucket.upper_bytes === null) return `≥ ${formatBytes(bucket.lower_bytes)}`;
  return `${formatBytes(bucket.lower_bytes)} – ${formatBytes(bucket.upper_bytes)}`;
}

function percent(part: number, whole: number): string {
  if (!whole) return "0%";
  const value = (part / whole) * 100;
  return `${value < 0.1 && value > 0 ? "<0.1" : value.toFixed(value < 10 ? 1 : 0)}%`;
}

function niceTop(max: number): { top: number; step: number } {
  if (max <= 0) return { top: 1, step: 1 };
  const raw = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  return { top: Math.ceil(max / step) * step, step };
}

function Histogram({ data }: { data: FileSizeDistribution }) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const [metric, setMetric] = useState<Metric>("files");
  const [active, setActive] = useState<number | null>(null);
  const width = Math.max(measured, 280);
  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const buckets = data.buckets;

  const layout = useMemo(() => {
    const values = buckets.map((bucket) => (metric === "files" ? bucket.file_count : bucket.total_bytes));
    const { top, step } = niceTop(Math.max(0, ...values));
    const slot = plotWidth / buckets.length;
    const barWidth = Math.max(4, slot * 0.72);
    const y = (value: number) => MARGIN.top + plotHeight - (value / top) * plotHeight;
    const bars = values.map((value, index) => ({
      value,
      x: MARGIN.left + slot * index + (slot - barWidth) / 2,
      center: MARGIN.left + slot * index + slot / 2,
      y: y(value),
      height: MARGIN.top + plotHeight - y(value),
      width: barWidth,
    }));
    const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
    const target = data.target_file_size_bytes;
    const targetIndex = buckets.findIndex(
      (bucket) => target >= bucket.lower_bytes && (bucket.upper_bytes === null || target < bucket.upper_bytes),
    );
    // Buckets are evenly spaced, so place the marker at the real position: on the
    // boundary between slots when the target equals a bucket edge, otherwise
    // interpolated (log scale) inside its bucket.
    let targetX: number | null = null;
    if (targetIndex >= 0) {
      const bucket = buckets[targetIndex];
      const left = MARGIN.left + slot * targetIndex;
      if (target === bucket.lower_bytes) {
        targetX = left;
      } else if (bucket.lower_bytes > 0 && bucket.upper_bytes !== null) {
        const ratio =
          Math.log(target / bucket.lower_bytes) / Math.log(bucket.upper_bytes / bucket.lower_bytes);
        targetX = left + slot * ratio;
      } else {
        targetX = left + slot / 2;
      }
    }
    return { bars, ticks, y, slot, targetX };
  }, [buckets, metric, plotWidth, plotHeight, data.target_file_size_bytes]);

  const tickLabel = (value: number) => (metric === "files" ? formatCompact(value) : formatBytes(value));
  const showEveryLabel = layout.slot >= 44;
  const detail = active === null ? null : buckets[active];

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const last = buckets.length - 1;
    const current = active ?? 0;
    const next =
      event.key === "ArrowLeft" ? Math.max(0, current - 1)
      : event.key === "ArrowRight" ? Math.min(last, current + 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : undefined;
    if (event.key === "Escape") {
      setActive(null);
      return;
    }
    if (next === undefined) return;
    event.preventDefault();
    setActive(next);
  }

  return (
    <>
      <div className="filesize-toolbar">
        <dl className="filesize-stats">
          <div><dt>Data files</dt><dd>{formatNumber(data.data_file_count)}</dd></div>
          <div><dt>Total size</dt><dd>{formatBytes(data.total_bytes)}</dd></div>
          <div><dt>Min</dt><dd>{formatBytes(data.min_bytes)}</dd></div>
          <div><dt>Median</dt><dd>{formatBytes(data.median_bytes)}</dd></div>
          <div><dt>Mean</dt><dd>{formatBytes(data.mean_bytes)}</dd></div>
          <div><dt>Max</dt><dd>{formatBytes(data.max_bytes)}</dd></div>
          <div title={TARGET_SOURCE_TITLE[data.target_file_size_source] ?? TARGET_SOURCE_TITLE.default}>
            <dt>Target · {TARGET_SOURCE_LABEL[data.target_file_size_source] ?? "default"}</dt>
            <dd>{formatBytes(data.target_file_size_bytes)}</dd>
          </div>
        </dl>
        <div className="segmented" role="radiogroup" aria-label="Bar metric">
          {(["files", "bytes"] as const).map((value) => (
            <button
              key={value}
              role="radio"
              aria-checked={metric === value}
              className={metric === value ? "segmented--active" : ""}
              onClick={() => setMetric(value)}
            >
              {value === "files" ? "File count" : "Bytes"}
            </button>
          ))}
        </div>
      </div>
      <div
        ref={ref}
        className="trend-card__plot"
        tabIndex={0}
        role="group"
        aria-roledescription="chart"
        aria-label={`Data file size histogram, ${buckets.length} size ranges. Use arrow keys to inspect ranges.`}
        onKeyDown={onKeyDown}
        onFocus={() => setActive((value) => value ?? 0)}
        onBlur={() => setActive(null)}
      >
        <svg width={width} height={HEIGHT} aria-hidden="true" onPointerLeave={() => setActive(null)}>
          {layout.ticks.map((tick) => (
            <g key={tick} className="trend-axis">
              <line x1={MARGIN.left} x2={width - MARGIN.right} y1={layout.y(tick)} y2={layout.y(tick)} />
              <text x={MARGIN.left - 8} y={layout.y(tick)} dy="0.32em" textAnchor="end">
                {tickLabel(tick)}
              </text>
            </g>
          ))}
          {layout.targetX !== null && (
            <g className="filesize-target">
              <title>{`Target file size: ${formatBytes(data.target_file_size_bytes)}`}</title>
              <line x1={layout.targetX} x2={layout.targetX} y1={MARGIN.top - 4} y2={MARGIN.top + plotHeight} />
              <text
                x={layout.targetX + (layout.targetX > width - MARGIN.right - 90 ? -4 : 4)}
                y={MARGIN.top + 4}
                textAnchor={layout.targetX > width - MARGIN.right - 90 ? "end" : "start"}
              >
                {`target ${formatBytes(data.target_file_size_bytes)}`}
              </text>
            </g>
          )}
          {layout.bars.map((bar, index) => (
            <g
              key={index}
              className={`filesize-bar${active === index ? " filesize-bar--active" : ""}`}
              onPointerEnter={() => setActive(index)}
              onPointerDown={() => setActive(index)}
            >
              <rect
                className="filesize-bar__hit"
                x={MARGIN.left + layout.slot * index}
                y={MARGIN.top}
                width={layout.slot}
                height={plotHeight}
              />
              {bar.value > 0 && (
                <rect x={bar.x} y={bar.y} width={bar.width} height={Math.max(1, bar.height)} rx={2} />
              )}
              {(showEveryLabel || index % 2 === 0) && (
                <text className="trend-axis--x" x={bar.center} y={HEIGHT - 10} textAnchor="middle">
                  {bucketLabel(buckets[index])}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>
      <div className="trend-card__detail" aria-live="polite">
        {detail ? (
          <>
            <span className="trend-detail__value">{bucketRange(detail)}</span>
            <span>
              {formatNumber(detail.file_count)} files ({percent(detail.file_count, data.data_file_count)})
            </span>
            <span>
              {formatBytes(detail.total_bytes)} ({percent(detail.total_bytes, data.total_bytes)} of bytes)
            </span>
            <span>{formatNumber(detail.record_count)} records</span>
          </>
        ) : (
          <span className="trend-detail__hint">
            Hover, tap, or focus and use arrow keys to inspect a size range.
          </span>
        )}
      </div>
    </>
  );
}

export function FileSizeChart({ catalogId, table }: { catalogId: string; table: TableRef }) {
  const [data, setData] = useState<FileSizeDistribution | null>(null);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    getFileSizes(catalogId, table, controller.signal)
      .then(setData)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Unable to read data files");
      });
    return () => controller.abort();
  }, [catalogId, table.namespace, table.name, reloadKey]);

  return (
    <section className="filesize" aria-label="Data file size distribution">
      <article className="trend-card">
        <header>
          <h3>Data file size distribution</h3>
          <span>
            {data
              ? data.snapshot_id === null
                ? "No current snapshot"
                : `Current snapshot ${data.snapshot_id}`
              : ""}
          </span>
        </header>
        {error ? (
          <div className="trend-card__empty filesize-error">
            <span>{error}</span>
            <button className="button" onClick={() => setReloadKey((value) => value + 1)}>
              <RotateCw size={13} /> Retry
            </button>
          </div>
        ) : !data ? (
          <p className="trend-card__empty">
            <span><LoaderCircle className="spin" size={16} /> Reading manifests</span>
          </p>
        ) : data.data_file_count === 0 ? (
          <p className="trend-card__empty">The current snapshot has no live data files.</p>
        ) : (
          <Histogram data={data} />
        )}
      </article>
      <p className="snapshot-trends__note">
        Live data files of the current snapshot, read from its manifests. Sizes are on-disk
        (compressed) bytes.
        {data && data.delete_file_count > 0 &&
          ` Delete files are excluded: ${formatNumber(data.delete_file_count)} files, ${formatBytes(data.delete_file_bytes)}.`}
      </p>
    </section>
  );
}
