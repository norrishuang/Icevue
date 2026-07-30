import { useMemo, useState } from "react";
import { Braces, Check, Search } from "lucide-react";
import type { TableDetail } from "../types";
import { EmptyState } from "./Common";

export function SchemaTab({ table }: { table: TableDetail }) {
  const current = table.schemas.find((schema) => schema.current) ?? table.schemas[0];
  const [schemaId, setSchemaId] = useState(current?.schema_id ?? 0);
  const [query, setQuery] = useState("");
  const schema = table.schemas.find((item) => item.schema_id === schemaId) ?? current;
  const fields = useMemo(() => {
    const lowered = query.trim().toLowerCase();
    if (!lowered) return schema?.fields ?? [];
    return (schema?.fields ?? []).filter((field) =>
      `${field.name} ${field.type} ${field.doc ?? ""}`.toLowerCase().includes(lowered),
    );
  }, [query, schema]);

  if (!schema) {
    return <EmptyState title="No schema" detail="No schema metadata was returned." />;
  }

  return (
    <div className="tab-content">
      <div className="table-toolbar">
        <div className="toolbar-title">
          <Braces size={17} />
          <strong>{schema.fields.length} fields</strong>
          <span>Schema ID {schema.schema_id}</span>
        </div>
        <label className="compact-search">
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter fields"
          />
        </label>
        <label className="select-control">
          <span>Version</span>
          <select value={schemaId} onChange={(event) => setSchemaId(Number(event.target.value))}>
            {table.schemas.map((item) => (
              <option key={item.schema_id} value={item.schema_id}>
                Schema {item.schema_id}{item.current ? " · current" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="data-table-wrap">
        <table className="data-table schema-table">
          <thead>
            <tr>
              <th className="cell-id">ID</th>
              <th>Column</th>
              <th>Type</th>
              <th>Required</th>
              <th>Documentation</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => (
              <tr key={field.id}>
                <td className="cell-id">{field.id}</td>
                <td><strong>{field.name}</strong></td>
                <td><code className="type-code">{field.type}</code></td>
                <td>
                  {field.required ? (
                    <span className="required-badge"><Check size={12} /> Required</span>
                  ) : (
                    <span className="muted">Optional</span>
                  )}
                </td>
                <td className="cell-doc">{field.doc ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {fields.length === 0 && (
          <EmptyState title="No matching fields" detail={`No fields match “${query}”.`} />
        )}
      </div>
    </div>
  );
}

