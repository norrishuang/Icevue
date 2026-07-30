import { useMemo, useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import type { TableDetail } from "../types";
import { CopyValue, EmptyState } from "./Common";

export function PropertiesTab({ table }: { table: TableDetail }) {
  const [query, setQuery] = useState("");
  const properties = useMemo(() => {
    const lowered = query.trim().toLowerCase();
    return Object.entries(table.properties)
      .sort(([left], [right]) => left.localeCompare(right))
      .filter(([key, value]) => `${key} ${value}`.toLowerCase().includes(lowered));
  }, [query, table.properties]);

  return (
    <div className="tab-content">
      <div className="table-toolbar">
        <div className="toolbar-title">
          <SlidersHorizontal size={17} />
          <strong>{Object.keys(table.properties).length} properties</strong>
        </div>
        <label className="compact-search compact-search--wide">
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter properties"
          />
        </label>
      </div>
      <div className="property-list">
        {properties.map(([key, value]) => (
          <div className="property-row" key={key}>
            <code>{key}</code>
            <CopyValue value={value} label={key} />
          </div>
        ))}
      </div>
      {properties.length === 0 && (
        <EmptyState title="No matching properties" detail={`No properties match “${query}”.`} />
      )}
    </div>
  );
}

