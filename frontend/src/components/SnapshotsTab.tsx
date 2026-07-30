import { Camera, GitCommitHorizontal } from "lucide-react";
import { formatBytes, formatDate, formatNumber } from "../format";
import type { TableDetail } from "../types";
import { EmptyState } from "./Common";

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
              <span><small>Added records</small><strong>{formatNumber(snapshot.summary["added-records"])}</strong></span>
              <span><small>Total records</small><strong>{formatNumber(snapshot.summary["total-records"])}</strong></span>
              <span><small>Data files</small><strong>{formatNumber(snapshot.summary["total-data-files"])}</strong></span>
              <span><small>Total size</small><strong>{formatBytes(snapshot.summary["total-files-size"])}</strong></span>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

