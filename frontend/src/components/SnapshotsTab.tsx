import { Camera, GitCommitHorizontal } from "lucide-react";
import { formatBytes, formatDate, formatNumber } from "../format";
import type { TableDetail } from "../types";
import { EmptyState } from "./Common";

function rewriteFiles(
  operation: string | null,
  summary: Record<string, string>,
): string {
  if (operation !== "replace") return "—";
  const input = formatNumber(summary["deleted-data-files"]);
  const output = formatNumber(summary["added-data-files"]);
  if (input === "—" && output === "—") return "—";
  return `${input} → ${output}`;
}

export function SnapshotsTab({ table }: { table: TableDetail }) {
  if (!table.snapshots.length) {
    return (
      <EmptyState
        icon={<Camera size={25} />}
        title="No snapshots"
        detail="The table does not contain snapshot history."
      />
    );
  }

  return (
    <div className="tab-content snapshot-list">
      {table.snapshots.map((snapshot) => (
        <article className={`snapshot ${snapshot.current ? "snapshot--current" : ""}`} key={snapshot.snapshot_id}>
          <div className="snapshot__rail">
            <span><GitCommitHorizontal size={15} /></span>
          </div>
          <div className="snapshot__body">
            <header>
              <div>
                <strong>{snapshot.operation ?? "unknown"}</strong>
                {snapshot.current && <span className="current-badge">Current</span>}
              </div>
              <time>{formatDate(snapshot.timestamp)}</time>
            </header>
            <div className="snapshot__id">
              <span>Snapshot</span>
              <code>{snapshot.snapshot_id}</code>
              {snapshot.sequence_number !== null && <span>Sequence {snapshot.sequence_number}</span>}
            </div>
            <div className="snapshot__stats">
              <span className="snapshot-stat--added">
                <small>Added files</small>
                <strong>{formatNumber(snapshot.summary["added-data-files"])}</strong>
              </span>
              <span className="snapshot-stat--removed" title="Data files removed from this snapshot">
                <small>Removed files</small>
                <strong>{formatNumber(snapshot.summary["deleted-data-files"])}</strong>
              </span>
              <span title="For replace snapshots: input files removed → output files added">
                <small>Rewrite in → out</small>
                <strong>{rewriteFiles(snapshot.operation, snapshot.summary)}</strong>
              </span>
              <span>
                <small>Total files</small>
                <strong>{formatNumber(snapshot.summary["total-data-files"])}</strong>
              </span>
              <span className="snapshot-stat--added">
                <small>Added records</small>
                <strong>{formatNumber(snapshot.summary["added-records"])}</strong>
              </span>
              <span className="snapshot-stat--removed">
                <small>Deleted records</small>
                <strong>{formatNumber(snapshot.summary["deleted-records"])}</strong>
              </span>
              <span>
                <small>Total records</small>
                <strong>{formatNumber(snapshot.summary["total-records"])}</strong>
              </span>
              <span>
                <small>Total size</small>
                <strong>{formatBytes(snapshot.summary["total-files-size"])}</strong>
              </span>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
