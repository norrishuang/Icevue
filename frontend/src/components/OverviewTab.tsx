import {
  ArrowDownUp,
  Braces,
  Clock3,
  DatabaseZap,
  FileArchive,
  GitBranch,
  KeyRound,
  MapPin,
} from "lucide-react";
import type { TableDetail } from "../types";
import { formatBytes, formatCompact, formatDate, formatNumber } from "../format";
import { CopyValue, EmptyState } from "./Common";

function latestSummary(table: TableDetail): Record<string, string> {
  return table.snapshots.find((snapshot) => snapshot.current)?.summary ?? {};
}

export function OverviewTab({ table }: { table: TableDetail }) {
  const summary = latestSummary(table);
  const currentSpec = table.partition_specs.find((spec) => spec.current);
  const currentSort = table.sort_orders.find((order) => order.current);

  return (
    <div className="tab-content overview">
      <section className="metric-strip">
        <div className="metric">
          <span>Records</span>
          <strong>{formatCompact(summary["total-records"])}</strong>
          <small>{formatNumber(summary["total-records"])}</small>
        </div>
        <div className="metric">
          <span>Data files</span>
          <strong>{formatCompact(summary["total-data-files"])}</strong>
          <small>{formatNumber(summary["total-data-files"])}</small>
        </div>
        <div className="metric">
          <span>Table size</span>
          <strong>{formatBytes(summary["total-files-size"])}</strong>
          <small>Current snapshot</small>
        </div>
        <div className="metric">
          <span>Snapshots</span>
          <strong>{formatNumber(table.snapshots.length)}</strong>
          <small>{Object.keys(table.refs).length} refs</small>
        </div>
      </section>

      <div className="overview-grid">
        <section className="panel overview-grid__wide">
          <header className="panel__header">
            <div>
              <h2>Table identity</h2>
              <p>Physical location and active metadata pointer</p>
            </div>
            <DatabaseZap size={18} />
          </header>
          <dl className="detail-list">
            <div>
              <dt>
                <MapPin size={14} /> Location
              </dt>
              <dd><CopyValue value={table.location} label="table location" /></dd>
            </div>
            <div>
              <dt>
                <FileArchive size={14} /> Metadata file
              </dt>
              <dd>
                {table.metadata_location ? (
                  <CopyValue value={table.metadata_location} label="metadata location" />
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div>
              <dt>
                <Clock3 size={14} /> Last updated
              </dt>
              <dd>{formatDate(table.last_updated)}</dd>
            </div>
            <div>
              <dt>
                <KeyRound size={14} /> Snapshot ID
              </dt>
              <dd className="mono">{table.current_snapshot_id ?? "—"}</dd>
            </div>
          </dl>
        </section>

        <section className="panel">
          <header className="panel__header">
            <div>
              <h2>Partition spec</h2>
              <p>Spec ID {table.default_spec_id}</p>
            </div>
            <Braces size={18} />
          </header>
          {currentSpec?.fields.length ? (
            <div className="definition-list">
              {currentSpec.fields.map((field) => (
                <div className="definition-row" key={field.field_id}>
                  <div>
                    <strong>{field.name}</strong>
                    <span>{field.source_column}</span>
                  </div>
                  <code>{field.transform}</code>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="Unpartitioned" detail="This table has no partition fields." />
          )}
        </section>

        <section className="panel">
          <header className="panel__header">
            <div>
              <h2>Sort order</h2>
              <p>Order ID {table.default_sort_order_id}</p>
            </div>
            <ArrowDownUp size={18} />
          </header>
          {currentSort?.fields.length ? (
            <div className="definition-list">
              {currentSort.fields.map((field, index) => (
                <div className="definition-row" key={`${field.source_id}-${index}`}>
                  <div>
                    <strong>{field.source_column ?? field.source_id}</strong>
                    <span>{field.null_order}</span>
                  </div>
                  <code>{field.direction}</code>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="Unsorted" detail="No explicit sort order is defined." />
          )}
        </section>

        <section className="panel overview-grid__wide">
          <header className="panel__header">
            <div>
              <h2>References</h2>
              <p>Branches and tags retained by the table</p>
            </div>
            <GitBranch size={18} />
          </header>
          {Object.keys(table.refs).length ? (
            <div className="refs-table">
              {Object.entries(table.refs).map(([name, ref]) => (
                <div className="refs-row" key={name}>
                  <span className="ref-icon"><GitBranch size={14} /></span>
                  <strong>{name}</strong>
                  <span className="type-badge">{String(ref.type ?? "ref")}</span>
                  <code>{String(ref["snapshot-id"] ?? ref.snapshot_id ?? "—")}</code>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No named references" detail="Only the current snapshot is available." />
          )}
        </section>
      </div>
    </div>
  );
}

