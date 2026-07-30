import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Database,
  PanelLeftClose,
  RefreshCw,
  Search,
  Settings,
  Table2,
  X,
} from "lucide-react";
import type { CatalogCollection, CatalogTree, TableRef } from "../types";
import { BrandMark } from "./BrandMark";

interface CatalogSidebarProps {
  catalog: CatalogTree;
  catalogs: CatalogCollection;
  activeCatalogId: string;
  selected: TableRef | null;
  open: boolean;
  refreshing: boolean;
  onSelect: (table: TableRef) => void;
  onClose: () => void;
  onRefresh: () => void;
  onCatalogChange: (catalogId: string) => void;
  onManageCatalogs: () => void;
}

function sameTable(left: TableRef | null, right: TableRef): boolean {
  return left?.namespace === right.namespace && left.name === right.name;
}

export function CatalogSidebar({
  catalog,
  catalogs,
  activeCatalogId,
  selected,
  open,
  refreshing,
  onSelect,
  onClose,
  onRefresh,
  onCatalogChange,
  onManageCatalogs,
}: CatalogSidebarProps) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const namespaces = useMemo(() => {
    const lowered = query.trim().toLowerCase();
    if (!lowered) return catalog.namespaces;
    return catalog.namespaces
      .map((namespace) => ({
        ...namespace,
        tables: namespace.tables.filter((table) =>
          `${table.namespace}.${table.name}`.toLowerCase().includes(lowered),
        ),
      }))
      .filter(
        (namespace) =>
          namespace.namespace.toLowerCase().includes(lowered) || namespace.tables.length > 0,
      );
  }, [catalog.namespaces, query]);

  function toggleNamespace(namespace: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(namespace)) next.delete(namespace);
      else next.add(namespace);
      return next;
    });
  }

  return (
    <>
      {open && <button className="sidebar-scrim" onClick={onClose} aria-label="Close catalog" />}
      <aside className={`sidebar ${open ? "sidebar--open" : ""}`}>
        <header className="sidebar__header">
          <div className="brand">
            <BrandMark />
            <div>
              <strong>Icevue</strong>
              <span>Metadata explorer</span>
            </div>
          </div>
          <button className="icon-button sidebar__close" onClick={onClose} title="Close catalog">
            <PanelLeftClose size={18} />
          </button>
        </header>

        <div className="catalog-status">
          <div className="catalog-status__icon">
            <Database size={16} />
          </div>
          <div className="catalog-status__copy">
            <span>Catalog</span>
            <select
              className="catalog-switcher"
              value={activeCatalogId}
              onChange={(event) => onCatalogChange(event.target.value)}
              aria-label="Select catalog"
            >
              {catalogs.catalogs.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </div>
          <span className="status-dot" title="Connected" />
          <button
            className="icon-button"
            onClick={onManageCatalogs}
            title="Catalog settings"
          >
            <Settings size={15} />
          </button>
          <button
            className="icon-button"
            onClick={onRefresh}
            disabled={refreshing}
            title="Refresh catalog"
          >
            <RefreshCw size={15} className={refreshing ? "spin" : ""} />
          </button>
        </div>

        <div className="sidebar__search">
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter tables"
            aria-label="Filter tables"
          />
          {query && (
            <button onClick={() => setQuery("")} title="Clear filter" aria-label="Clear filter">
              <X size={14} />
            </button>
          )}
        </div>

        <div className="tree-label">
          <span>Namespaces</span>
          <span>{catalog.namespaces.length}</span>
        </div>

        <nav className="catalog-tree" aria-label="Catalog tables">
          {namespaces.map((namespace) => {
            const isCollapsed = collapsed.has(namespace.namespace);
            return (
              <section className="namespace" key={namespace.namespace}>
                <button
                  className="namespace__trigger"
                  onClick={() => toggleNamespace(namespace.namespace)}
                >
                  {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  <Database size={14} />
                  <span title={namespace.namespace}>{namespace.namespace}</span>
                  <small>{namespace.tables.length}</small>
                </button>
                {!isCollapsed && (
                  <div className="namespace__tables">
                    {namespace.tables.map((table) => (
                      <button
                        key={`${table.namespace}.${table.name}`}
                        className={`table-link ${sameTable(selected, table) ? "table-link--active" : ""}`}
                        onClick={() => {
                          onSelect(table);
                          onClose();
                        }}
                      >
                        <Table2 size={14} />
                        <span>{table.name}</span>
                      </button>
                    ))}
                    {namespace.tables.length === 0 && (
                      <span className="namespace__empty">No matching tables</span>
                    )}
                  </div>
                )}
              </section>
            );
          })}
          {namespaces.length === 0 && (
            <div className="empty-filter">
              <Search size={18} />
              <span>No tables match “{query}”</span>
            </div>
          )}
        </nav>

        <footer className="sidebar__footer">
          <span className={`mode-badge mode-badge--${catalog.catalog.mode}`}>
            {catalog.catalog.mode}
          </span>
          <span title={catalog.catalog.uri ?? catalog.catalog.message ?? ""}>
            {catalog.catalog.uri ?? catalog.catalog.message}
          </span>
        </footer>
      </aside>
    </>
  );
}
