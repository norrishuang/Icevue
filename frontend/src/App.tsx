import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Braces,
  Camera,
  CircleGauge,
  Layers3,
  Menu,
  PanelLeftOpen,
  RefreshCw,
  Settings,
  SlidersHorizontal,
  Table2,
} from "lucide-react";
import { getCatalog, getCatalogs, getTable } from "./api";
import { CatalogManager } from "./components/CatalogManager";
import { CatalogSidebar } from "./components/CatalogSidebar";
import { BrandMark } from "./components/BrandMark";
import { ErrorState, LoadingState } from "./components/Common";
import { OverviewTab } from "./components/OverviewTab";
import { PartitionsTab } from "./components/PartitionsTab";
import { PropertiesTab } from "./components/PropertiesTab";
import { SchemaTab } from "./components/SchemaTab";
import { SnapshotsTab } from "./components/SnapshotsTab";
import { formatDate } from "./format";
import type {
  CatalogCollection,
  CatalogTree,
  TabId,
  TableDetail,
  TableRef,
} from "./types";

const tabs = [
  { id: "overview" as const, label: "Overview", icon: CircleGauge },
  { id: "schema" as const, label: "Schema", icon: Braces },
  { id: "partitions" as const, label: "Partitions", icon: Layers3 },
  { id: "snapshots" as const, label: "Snapshots", icon: Camera },
  { id: "properties" as const, label: "Properties", icon: SlidersHorizontal },
];

function firstTable(catalog: CatalogTree): TableRef | null {
  for (const namespace of catalog.namespaces) {
    if (namespace.tables[0]) return namespace.tables[0];
  }
  return null;
}

export default function App() {
  const [catalogs, setCatalogs] = useState<CatalogCollection | null>(null);
  const [activeCatalogId, setActiveCatalogId] = useState("");
  const [catalog, setCatalog] = useState<CatalogTree | null>(null);
  const [selected, setSelected] = useState<TableRef | null>(null);
  const [table, setTable] = useState<TableDetail | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [catalogListError, setCatalogListError] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [tableError, setTableError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [catalogReload, setCatalogReload] = useState(0);
  const [tableReload, setTableReload] = useState(0);

  const activateCatalog = useCallback((catalogId: string) => {
    window.localStorage.setItem("icevue.catalog", catalogId);
    setActiveCatalogId(catalogId);
    setCatalog(null);
    setSelected(null);
    setTable(null);
    setCatalogError("");
    setTableError("");
    setActiveTab("overview");
  }, []);

  const syncCatalogs = useCallback(
    async (preferredCatalogId?: string) => {
      const result = await getCatalogs();
      setCatalogs(result);
      const remembered = window.localStorage.getItem("icevue.catalog");
      const candidates = [
        preferredCatalogId,
        activeCatalogId,
        remembered,
        result.default_catalog,
      ];
      const next =
        candidates.find(
          (candidate) =>
            candidate && result.catalogs.some((catalogItem) => catalogItem.id === candidate),
        ) ?? result.catalogs[0]?.id;
      if (next && next !== activeCatalogId) activateCatalog(next);
      return result;
    },
    [activateCatalog, activeCatalogId],
  );

  useEffect(() => {
    setCatalogListError("");
    void syncCatalogs().catch((reason: unknown) => {
      setCatalogListError(
        reason instanceof Error ? reason.message : "Unable to load catalog configuration",
      );
    });
  }, []); // Catalog configuration is explicitly refreshed after mutations.

  const loadCatalog = useCallback(() => {
    setRefreshing(true);
    setCatalogError("");
    setCatalogReload((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!activeCatalogId) return;
    const controller = new AbortController();
    setCatalog(null);
    setSelected(null);
    setCatalogError("");
    getCatalog(activeCatalogId, controller.signal)
      .then((result) => {
        setCatalog(result);
        setSelected(firstTable(result));
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setCatalogError(reason instanceof Error ? reason.message : "Unable to load catalog");
      })
      .finally(() => setRefreshing(false));
    return () => controller.abort();
  }, [activeCatalogId, catalogReload]);

  useEffect(() => {
    if (!selected || !activeCatalogId) return;
    const controller = new AbortController();
    setTable(null);
    setTableError("");
    getTable(activeCatalogId, selected, controller.signal)
      .then(setTable)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setTableError(reason instanceof Error ? reason.message : "Unable to load table");
      });
    return () => controller.abort();
  }, [activeCatalogId, selected, tableReload]);

  const currentSpec = useMemo(
    () => table?.partition_specs.find((spec) => spec.current),
    [table],
  );

  if (!catalogs && !catalogListError) {
    return (
      <main className="boot-screen">
        <BrandMark className="boot-logo" />
        <LoadingState label="Reading catalog configuration" />
      </main>
    );
  }

  if (!catalogs && catalogListError) {
    return (
      <main className="boot-screen">
        <BrandMark className="boot-logo" />
        <ErrorState
          title="Configuration unavailable"
          message={catalogListError}
          onRetry={() => void syncCatalogs()}
        />
      </main>
    );
  }

  if (!catalogs) return null;

  if (!catalog && catalogError) {
    return (
      <main className="boot-screen">
        <BrandMark className="boot-logo" />
        <ErrorState title="Catalog unavailable" message={catalogError} onRetry={loadCatalog} />
        <button className="button boot-settings" onClick={() => setManagerOpen(true)}>
          <Settings size={15} />
          Catalog settings
        </button>
        <CatalogManager
          open={managerOpen}
          collection={catalogs}
          onClose={() => setManagerOpen(false)}
          onChanged={async (preferred) => {
            await syncCatalogs();
            if (preferred === activeCatalogId) {
              setCatalogReload((value) => value + 1);
            }
          }}
        />
      </main>
    );
  }

  if (!catalog) {
    return (
      <main className="boot-screen">
        <BrandMark className="boot-logo" />
        <LoadingState label="Connecting to catalog" />
      </main>
    );
  }

  return (
    <div className="app-shell">
      <CatalogSidebar
        catalog={catalog}
        catalogs={catalogs}
        activeCatalogId={activeCatalogId}
        selected={selected}
        open={sidebarOpen}
        refreshing={refreshing}
        onClose={() => setSidebarOpen(false)}
        onRefresh={loadCatalog}
        onCatalogChange={activateCatalog}
        onManageCatalogs={() => setManagerOpen(true)}
        onSelect={(next) => {
          setSelected(next);
          setActiveTab("overview");
        }}
      />
      <main className="workspace">
        <header className="workspace-header">
          <button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)} title="Open catalog">
            <Menu size={19} />
          </button>
          <button className="icon-button desktop-menu" onClick={() => setSidebarOpen(true)} title="Open catalog">
            <PanelLeftOpen size={18} />
          </button>
          <div className="breadcrumb">
            <span>{catalog.catalog.name}</span>
            {selected && (
              <>
                <i>/</i>
                <span>{selected.namespace}</span>
                <i>/</i>
                <strong>{selected.name}</strong>
              </>
            )}
          </div>
          <div className="read-only">
            <span />
            Read only
          </div>
          <button
            className="icon-button"
            onClick={() => setTableReload((value) => value + 1)}
            disabled={!selected}
            title="Refresh table"
          >
            <RefreshCw size={16} />
          </button>
        </header>

        {!selected ? (
          <ErrorState title="Catalog is empty" message="No Iceberg tables were found." />
        ) : tableError ? (
          <ErrorState
            title="Table unavailable"
            message={tableError}
            onRetry={() => setTableReload((value) => value + 1)}
          />
        ) : !table ? (
          <LoadingState label={`Loading ${selected.namespace}.${selected.name}`} />
        ) : (
          <>
            <section className="table-heading">
              <div className="table-heading__icon"><Table2 size={22} /></div>
              <div className="table-heading__title">
                <div>
                  <h1>{table.name}</h1>
                  <span className="version-badge">Iceberg v{table.format_version}</span>
                </div>
                <p>
                  {table.namespace}
                  <span>Updated {formatDate(table.last_updated)}</span>
                </p>
              </div>
              <dl className="heading-facts">
                <div><dt>Schema</dt><dd>{table.current_schema_id}</dd></div>
                <div><dt>Spec</dt><dd>{table.default_spec_id}</dd></div>
                <div><dt>Snapshots</dt><dd>{table.snapshots.length}</dd></div>
              </dl>
            </section>

            <nav className="tabs" aria-label="Table metadata views">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const count =
                  tab.id === "schema"
                    ? table.schemas.find((schema) => schema.current)?.fields.length
                    : tab.id === "snapshots"
                      ? table.snapshots.length
                      : tab.id === "properties"
                        ? Object.keys(table.properties).length
                        : undefined;
                return (
                  <button
                    key={tab.id}
                    className={activeTab === tab.id ? "tab--active" : ""}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    <Icon size={15} />
                    {tab.label}
                    {count !== undefined && <span>{count}</span>}
                  </button>
                );
              })}
            </nav>

            <section className="view">
              {activeTab === "overview" && <OverviewTab table={table} />}
              {activeTab === "schema" && <SchemaTab table={table} />}
              {activeTab === "partitions" && (
                <PartitionsTab
                  catalogId={activeCatalogId}
                  table={selected}
                  partitioned={Boolean(currentSpec?.fields.length)}
                />
              )}
              {activeTab === "snapshots" && <SnapshotsTab table={table} />}
              {activeTab === "properties" && <PropertiesTab table={table} />}
            </section>
          </>
        )}
      </main>
      <CatalogManager
        open={managerOpen}
        collection={catalogs}
        onClose={() => setManagerOpen(false)}
        onChanged={async (preferred) => {
          await syncCatalogs();
          if (preferred === activeCatalogId) {
            setCatalogReload((value) => value + 1);
          }
        }}
      />
    </div>
  );
}
