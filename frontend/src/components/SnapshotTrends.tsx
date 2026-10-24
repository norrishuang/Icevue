import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { formatCompact, formatDate, formatNumber } from "../format";
import type { SnapshotInfo } from "../types";

const HEIGHT = 180;
const MARGIN = { top: 12, right: 16, bottom: 28, left: 52 };

const METRICS = [
  { key: "total-records", title: "Total records", unit: "records" },
  { key: "total-data-files", title: "Total data files", unit: "data files" },
] as const;

interface TrendPoint {
  snapshot: SnapshotInfo;
  value: number | null;
}

/** Returns a non-negative finite total, or null when the summary value is unknown. */
export function parseTotal(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function niceStep(max: number): number {
  const raw = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  return Math.max(1, step); // Totals are counts, so ticks stay on whole numbers.
}

function timeLabel(ms: number, spanMs: number): string {
  const options: Intl.DateTimeFormatOptions =
    spanMs < 3 * 86_400_000
      ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }
      : spanMs > 365 * 86_400_000
        ? { month: "short", year: "numeric" }
        : { month: "short", day: "numeric" };
  return new Intl.DateTimeFormat("en-US", options).format(new Date(ms));
}

/** Tracks an element's content width; a callback ref handles conditional mounting. */
function useWidth<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, width] as const;
}

function TrendChart({
  title,
  unit,
  points,
}: {
  title: string;
  unit: string;
  points: TrendPoint[];
}) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const width = Math.max(measured, 240);
  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const known = points.filter((point) => point.value !== null).length;

  useEffect(() => setActive(null), [points]);

  const layout = useMemo(() => {
    const times = points.map((point) => point.snapshot.timestamp_ms);
    const start = Math.min(...times);
    const span = Math.max(...times) - start;
    const max = Math.max(0, ...points.map((point) => point.value ?? 0));
    const step = niceStep(max || 1);
    const top = Math.max(step, Math.ceil(max / step) * step);
    const x = (ms: number) =>
      MARGIN.left + (span === 0 ? plotWidth / 2 : ((ms - start) / span) * plotWidth);
    const y = (value: number) => MARGIN.top + plotHeight - (value / top) * plotHeight;

    const plotted = points.map((point) => ({
      ...point,
      x: x(point.snapshot.timestamp_ms),
      y: point.value === null ? null : y(point.value),
    }));
    let path = "";
    let penDown = false;
    for (const point of plotted) {
      if (point.y === null) {
        penDown = false; // Unknown totals break the line instead of dropping to zero.
        continue;
      }
      path += `${penDown ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`;
      penDown = true;
    }
    const yTicks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
    const tickCount = span === 0 ? 1 : plotWidth < 360 ? 2 : 4;
    const xTicks = Array.from({ length: tickCount }, (_, i) =>
      tickCount === 1 ? start : start + (span * i) / (tickCount - 1),
    );
    return { plotted, path, x, y, span, yTicks, xTicks };
  }, [points, plotWidth, plotHeight]);

  const firstValue = points.find((point) => point.value !== null)?.value;
  const lastValue = [...points].reverse().find((point) => point.value !== null)?.value;
  const detail = active === null ? null : points[active];

  function pick(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    let best = 0;
    let bestScore = Infinity;
    layout.plotted.forEach((point, index) => {
      // Horizontal distance dominates; vertical distance separates equal timestamps.
      const score = Math.abs(point.x - px) * 1000 + (point.y === null ? plotHeight : Math.abs(point.y - py));
      if (score < bestScore) {
        bestScore = score;
        best = index;
      }
    });
    setActive(best);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const last = points.length - 1;
    const current = active ?? last;
    const next =
      event.key === "ArrowLeft" || event.key === "ArrowDown"
        ? Math.max(0, current - 1)
        : event.key === "ArrowRight" || event.key === "ArrowUp"
          ? Math.min(last, current + 1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
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
    <article className="trend-card" data-metric={unit}>
      <header>
        <h3>{title}</h3>
        <span>
          {known
            ? `${formatCompact(firstValue)} → ${formatCompact(lastValue)}`
            : "No data"}
        </span>
      </header>
      {known === 0 ? (
        <p className="trend-card__empty">
          No retained snapshot summary reports total {unit}.
        </p>
      ) : (
        <div
          ref={ref}
          className="trend-card__plot"
          tabIndex={0}
          role="group"
          aria-roledescription="chart"
          aria-label={`${title} by snapshot time, ${points.length} snapshots. Use arrow keys, Home, and End to inspect snapshots.`}
          onKeyDown={onKeyDown}
          onFocus={() =>
            setActive((value) => {
              if (value !== null) return value;
              const current = points.findIndex((point) => point.snapshot.current);
              return current >= 0 ? current : points.length - 1;
            })
          }
          onBlur={() => setActive(null)}
        >
          <svg
            width={width}
            height={HEIGHT}
            aria-hidden="true"
            onPointerDown={pick}
            onPointerMove={pick}
            onPointerLeave={(event) => event.pointerType === "mouse" && setActive(null)}
          >
            {layout.yTicks.map((tick) => (
              <g key={tick} className="trend-axis">
                <line x1={MARGIN.left} x2={width - MARGIN.right} y1={layout.y(tick)} y2={layout.y(tick)} />
                <text x={MARGIN.left - 8} y={layout.y(tick)} dy="0.32em" textAnchor="end">
                  {formatCompact(tick)}
                </text>
              </g>
            ))}
            {layout.xTicks.map((tick, index) => (
              <text
                key={tick}
                className="trend-axis trend-axis--x"
                x={layout.x(tick)}
                y={HEIGHT - 8}
                textAnchor={
                  layout.xTicks.length === 1
                    ? "middle"
                    : index === 0
                      ? "start"
                      : index === layout.xTicks.length - 1
                        ? "end"
                        : "middle"
                }
              >
                {timeLabel(tick, layout.span)}
              </text>
            ))}
            {layout.plotted.map((point, index) =>
              point.y === null ? (
                <line
                  key={`gap-${index}`}
                  className="trend-unknown"
                  x1={point.x}
                  x2={point.x}
                  y1={MARGIN.top}
                  y2={MARGIN.top + plotHeight}
                />
              ) : null,
            )}
            <path className="trend-line" d={layout.path} />
            {layout.plotted.map((point, index) =>
              point.y === null ? null : (
                <circle
                  key={`point-${index}`}
                  className={`trend-point${point.snapshot.current ? " trend-point--current" : ""}`}
                  cx={point.x}
                  cy={point.y}
                  r={point.snapshot.current ? 4 : 3}
                />
              ),
            )}
            {detail && active !== null && (
              <g className="trend-cursor">
                <line
                  x1={layout.plotted[active].x}
                  x2={layout.plotted[active].x}
                  y1={MARGIN.top}
                  y2={MARGIN.top + plotHeight}
                />
                {layout.plotted[active].y !== null && (
                  <circle cx={layout.plotted[active].x} cy={layout.plotted[active].y!} r={5.5} />
                )}
              </g>
            )}
          </svg>
        </div>
      )}
      {known > 0 && (
        <div className="trend-card__detail" aria-live="polite">
          {detail ? (
            <>
              <span className="trend-detail__value">
                {detail.value === null ? "Unknown" : formatNumber(detail.value)}{" "}
                <small>{unit}</small>
              </span>
              <span>{formatDate(detail.snapshot.timestamp)}</span>
              <span className="trend-detail__op">{detail.snapshot.operation ?? "unknown"}</span>
              <code>{detail.snapshot.snapshot_id}</code>
              {detail.snapshot.current && <span className="current-badge">Current</span>}
              <span className="trend-detail__index">
                {active! + 1} of {points.length}
              </span>
            </>
          ) : (
            <span className="trend-detail__hint">Hover, tap, or focus and use arrow keys to inspect snapshots.</span>
          )}
        </div>
      )}
    </article>
  );
}

export function SnapshotTrends({ snapshots }: { snapshots: SnapshotInfo[] }) {
  // Copy before sorting so the history list keeps the API order. Sort is stable for ties.
  const ordered = useMemo(
    () =>
      snapshots
        .filter((snapshot) => Number.isFinite(snapshot.timestamp_ms))
        .slice()
        .sort((a, b) => a.timestamp_ms - b.timestamp_ms),
    [snapshots],
  );
  const untimed = snapshots.length - ordered.length;
  const series = useMemo(
    () =>
      METRICS.map((metric) => ({
        ...metric,
        points: ordered.map((snapshot) => ({
          snapshot,
          value: parseTotal(snapshot.summary[metric.key]),
        })),
      })),
    [ordered],
  );

  if (!ordered.length) return null;

  return (
    <section className="snapshot-trends" aria-label="Snapshot trends">
      <div className="snapshot-trends__grid">
        {series.map((metric) => (
          <TrendChart key={metric.key} title={metric.title} unit={metric.unit} points={metric.points} />
        ))}
      </div>
      <p className="snapshot-trends__note">
        Totals are read from retained snapshot summaries, including snapshots on other branches and
        tags. Record totals count rows in data files and may include rows removed by delete files.
        Missing or invalid totals are shown as gaps.
        {untimed > 0 && ` ${untimed} snapshot${untimed === 1 ? "" : "s"} without a valid timestamp ${untimed === 1 ? "is" : "are"} not plotted.`}
      </p>
    </section>
  );
}
