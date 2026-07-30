import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Layers3, Search } from "lucide-react";
import { getPartitions } from "../api";
import { formatCell, humanize } from "../format";
import type { PartitionPage, TableRef } from "../types";
import { EmptyState, ErrorState, LoadingState } from "./Common";

interface PartitionsTabProps {
  catalogId: string;
  table: TableRef;
  partitioned: boolean;
}

export function PartitionsTab({ catalogId, table, partitioned }: PartitionsTabProps) {
  const [data, setData] = useState<PartitionPage | null>(null);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const pageSize = 30;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setDebouncedQuery(query);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!partitioned) return;
    const controller = new AbortController();
    setError("");
    getPartitions(catalogId, table, page, pageSize, debouncedQuery, controller.signal)
      .then(setData)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Unable to load partitions");
      });
    return () => controller.abort();
  }, [catalogId, debouncedQuery, page, partitioned, reloadKey, table]);

  if (!partitioned) {
    return (
      <EmptyState
        icon={<Layers3 size={25} />}
        title="Unpartitioned table"
        detail="The active partition spec does not define any fields."
      />
    );
  }
  if (error) {
    return (
      <ErrorState
        title="Partitions unavailable"
        message={error}
        onRetry={() => setReloadKey((value) => value + 1)}
      />
    );
  }
  if (!data) return <LoadingState label="Reading partition metadata" />;

  const from = data.total === 0 ? 0 : (data.page - 1) * data.page_size + 1;
  const to = Math.min(data.page * data.page_size, data.total);

  return (
    <div className="tab-content">
      <div className="table-toolbar">
        <div className="toolbar-title">
          <Layers3 size={17} />
          <strong>{data.total.toLocaleString()} partitions</strong>
          <span>Current snapshot</span>
        </div>
        <label className="compact-search compact-search--wide">
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter partition values"
          />
        </label>
      </div>
      <div className="data-table-wrap">
        <table className="data-table partition-table">
          <thead>
            <tr>
              {data.columns.map((column) => <th key={column}>{humanize(column)}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, index) => (
              <tr key={`${page}-${index}`}>
                {data.columns.map((column) => (
                  <td key={column} className={column.includes("partition") ? "mono" : ""}>
                    {formatCell(column, row[column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {data.rows.length === 0 && (
          <EmptyState title="No partitions found" detail="Try a different filter value." />
        )}
      </div>
      <footer className="pagination">
        <span>Showing {from}–{to} of {data.total.toLocaleString()}</span>
        <div>
          <button
            className="icon-button"
            disabled={page <= 1}
            onClick={() => setPage((value) => value - 1)}
            title="Previous page"
          >
            <ChevronLeft size={17} />
          </button>
          <span>Page {data.page}</span>
          <button
            className="icon-button"
            disabled={!data.has_more}
            onClick={() => setPage((value) => value + 1)}
            title="Next page"
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </footer>
    </div>
  );
}
