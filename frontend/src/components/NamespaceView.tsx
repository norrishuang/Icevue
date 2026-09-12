import { Database, Plus } from "lucide-react";
import type { NamespaceDetail } from "../types";

interface NamespaceViewProps {
  detail: NamespaceDetail;
  onCreateTable: (namespace: string) => void;
}

export function NamespaceView({ detail, onCreateTable }: NamespaceViewProps) {
  const propertyEntries = Object.entries(detail.properties);

  return (
    <div className="namespace-detail">
      <section className="table-heading">
        <div className="table-heading__icon">
          <Database size={22} />
        </div>
        <div className="table-heading__title">
          <div>
            <h1>{detail.namespace.split(".").pop()}</h1>
          </div>
          <p>{detail.namespace}</p>
        </div>
        <div className="heading-facts">
          <button
            className="button button--primary"
            onClick={() => onCreateTable(detail.namespace)}
          >
            <Plus size={14} />
            New table
          </button>
        </div>
      </section>

      <div className="namespace-detail__body">
        <div className="namespace-detail__section">
          <h2>Properties</h2>
          {propertyEntries.length === 0 ? (
            <p className="namespace-detail__empty">No properties set.</p>
          ) : (
            <div className="property-list">
              {propertyEntries.map(([key, value]) => (
                <div className="property-row" key={key}>
                  <code>{key}</code>
                  <span>{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
