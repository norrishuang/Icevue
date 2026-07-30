import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Database,
  KeyRound,
  Plus,
  Save,
  Server,
  TestTubeDiagonal,
  Trash2,
  X,
} from "lucide-react";
import {
  createCatalog,
  deleteCatalog,
  testCatalog,
  updateCatalog,
} from "../api";
import type {
  CatalogCollection,
  CatalogConfig,
  CatalogInput,
} from "../types";

interface CatalogManagerProps {
  open: boolean;
  collection: CatalogCollection;
  onClose: () => void;
  onChanged: (preferredCatalogId?: string) => Promise<void>;
}

interface Draft {
  id: string;
  name: string;
  type: "demo" | "rest";
  uri: string;
  warehouse: string;
  credential: string;
  token: string;
  oauth2ServerUri: string;
  scope: string;
  prefix: string;
  properties: string;
  setDefault: boolean;
  clearToken: boolean;
  clearCredential: boolean;
}

const emptyDraft: Draft = {
  id: "",
  name: "",
  type: "rest",
  uri: "",
  warehouse: "",
  credential: "",
  token: "",
  oauth2ServerUri: "",
  scope: "",
  prefix: "",
  properties: "{}",
  setDefault: false,
  clearToken: false,
  clearCredential: false,
};

function toDraft(catalog: CatalogConfig): Draft {
  return {
    id: catalog.id,
    name: catalog.name,
    type: catalog.type,
    uri: catalog.uri ?? "",
    warehouse: catalog.warehouse ?? "",
    credential: "",
    token: "",
    oauth2ServerUri: catalog.oauth2_server_uri ?? "",
    scope: catalog.scope ?? "",
    prefix: catalog.prefix ?? "",
    properties: JSON.stringify(catalog.properties, null, 2),
    setDefault: catalog.is_default,
    clearToken: false,
    clearCredential: false,
  };
}

function nullable(value: string): string | null {
  return value.trim() || null;
}

export function CatalogManager({
  open,
  collection,
  onClose,
  onChanged,
}: CatalogManagerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(
    collection.catalogs[0]?.id ?? null,
  );
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(
    null,
  );

  const selected = useMemo(
    () => collection.catalogs.find((catalog) => catalog.id === selectedId) ?? null,
    [collection.catalogs, selectedId],
  );

  useEffect(() => {
    if (!open) return;
    if (creating) return;
    const next = selected ?? collection.catalogs[0] ?? null;
    if (next) {
      setSelectedId(next.id);
      setDraft(toDraft(next));
    }
  }, [creating, open, selected]);

  if (!open) return null;

  function selectCatalog(catalog: CatalogConfig) {
    setCreating(false);
    setSelectedId(catalog.id);
    setDraft(toDraft(catalog));
    setMessage(null);
  }

  function startCreate() {
    setCreating(true);
    setSelectedId(null);
    setDraft(emptyDraft);
    setMessage(null);
  }

  function patch<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setMessage(null);
  }

  function payload(): CatalogInput {
    let properties: Record<string, unknown>;
    try {
      const parsed = JSON.parse(draft.properties || "{}") as unknown;
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        throw new Error("Properties must be a JSON object");
      }
      properties = parsed as Record<string, unknown>;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "Properties are invalid");
    }
    return {
      id: draft.id.trim(),
      name: draft.name.trim(),
      type: draft.type,
      uri: draft.type === "rest" ? nullable(draft.uri) : null,
      warehouse: draft.type === "rest" ? nullable(draft.warehouse) : null,
      credential: draft.type === "rest" ? nullable(draft.credential) : null,
      token: draft.type === "rest" ? nullable(draft.token) : null,
      oauth2_server_uri:
        draft.type === "rest" ? nullable(draft.oauth2ServerUri) : null,
      scope: draft.type === "rest" ? nullable(draft.scope) : null,
      prefix: draft.type === "rest" ? nullable(draft.prefix) : null,
      properties: draft.type === "rest" ? properties : {},
      set_default: draft.setDefault,
      clear_token: draft.clearToken,
      clear_credential: draft.clearCredential,
    };
  }

  async function runTest() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await testCatalog(payload(), creating ? undefined : selectedId ?? undefined);
      setMessage({
        type: "success",
        text: `${result.message}. ${result.namespace_count} namespaces found.`,
      });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Connection test failed",
      });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const value = payload();
      const saved = creating
        ? await createCatalog(value)
        : await updateCatalog(selectedId ?? value.id, value);
      await onChanged(saved.id);
      setCreating(false);
      setSelectedId(saved.id);
      setDraft(toDraft(saved));
      setMessage({ type: "success", text: "Catalog configuration saved." });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Unable to save catalog",
      });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!selectedId || !window.confirm(`Delete catalog “${selected?.name}”?`)) return;
    setBusy(true);
    setMessage(null);
    try {
      await deleteCatalog(selectedId);
      setSelectedId(null);
      await onChanged();
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Unable to delete catalog",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="catalog-manager" role="dialog" aria-modal="true" aria-labelledby="catalog-manager-title">
        <header className="catalog-manager__header">
          <div>
            <h2 id="catalog-manager-title">Catalog connections</h2>
            <p>{collection.config_path}</p>
          </div>
          <button className="icon-button" onClick={onClose} title="Close settings">
            <X size={18} />
          </button>
        </header>

        <div className="catalog-manager__body">
          <aside className="catalog-manager__list">
            <div className="catalog-manager__list-title">
              <span>Configured</span>
              <button className="icon-button" onClick={startCreate} title="Add catalog">
                <Plus size={17} />
              </button>
            </div>
            {collection.catalogs.map((catalog) => (
              <button
                key={catalog.id}
                className={`catalog-config-link ${!creating && selectedId === catalog.id ? "catalog-config-link--active" : ""}`}
                onClick={() => selectCatalog(catalog)}
              >
                <span className="catalog-config-link__icon">
                  {catalog.type === "demo" ? <Database size={15} /> : <Server size={15} />}
                </span>
                <span>
                  <strong>{catalog.name}</strong>
                  <small>{catalog.id}</small>
                </span>
                {catalog.is_default && <i>Default</i>}
              </button>
            ))}
          </aside>

          <form
            className="catalog-form"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="catalog-form__heading">
              <div>
                <h3>{creating ? "New catalog" : draft.name}</h3>
                <p>Icevue connection settings only. Table access remains read-only.</p>
              </div>
              {!creating && (
                <button
                  className="icon-button icon-button--danger"
                  type="button"
                  onClick={() => void remove()}
                  disabled={busy}
                  title="Delete catalog"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>

            <div className="form-grid">
              <label>
                <span>Catalog ID</span>
                <input
                  value={draft.id}
                  onChange={(event) => patch("id", event.target.value)}
                  disabled={!creating}
                  placeholder="production"
                  required
                  pattern={"[a-zA-Z0-9][a-zA-Z0-9_\\-]{0,63}"}
                />
              </label>
              <label>
                <span>Display name</span>
                <input
                  value={draft.name}
                  onChange={(event) => patch("name", event.target.value)}
                  placeholder="Production"
                  required
                />
              </label>
            </div>

            <fieldset className="mode-control">
              <legend>Type</legend>
              <button
                type="button"
                className={draft.type === "rest" ? "mode-control--active" : ""}
                onClick={() => patch("type", "rest")}
              >
                <Server size={14} /> REST
              </button>
              <button
                type="button"
                className={draft.type === "demo" ? "mode-control--active" : ""}
                onClick={() => patch("type", "demo")}
              >
                <Database size={14} /> Demo
              </button>
            </fieldset>

            {draft.type === "rest" && (
              <>
                <div className="form-section-title">Endpoint</div>
                <div className="form-grid">
                  <label className="form-grid__wide">
                    <span>REST Catalog URI</span>
                    <input
                      value={draft.uri}
                      onChange={(event) => patch("uri", event.target.value)}
                      placeholder="http://iceberg-rest:8181"
                      required
                    />
                  </label>
                  <label className="form-grid__wide">
                    <span>Warehouse</span>
                    <input
                      value={draft.warehouse}
                      onChange={(event) => patch("warehouse", event.target.value)}
                      placeholder="s3://warehouse/"
                    />
                  </label>
                  <label>
                    <span>Prefix</span>
                    <input
                      value={draft.prefix}
                      onChange={(event) => patch("prefix", event.target.value)}
                      placeholder="Optional"
                    />
                  </label>
                  <label>
                    <span>OAuth2 scope</span>
                    <input
                      value={draft.scope}
                      onChange={(event) => patch("scope", event.target.value)}
                      placeholder="catalog"
                    />
                  </label>
                </div>

                <div className="form-section-title"><KeyRound size={13} /> Authentication</div>
                <div className="form-grid">
                  <label className="form-grid__wide">
                    <span>OAuth2 server URI</span>
                    <input
                      value={draft.oauth2ServerUri}
                      onChange={(event) => patch("oauth2ServerUri", event.target.value)}
                      placeholder="https://identity.example.com/oauth2/token"
                    />
                  </label>
                  <label>
                    <span>Bearer token</span>
                    <input
                      type="password"
                      value={draft.token}
                      onChange={(event) => patch("token", event.target.value)}
                      placeholder={selected?.has_token ? "Stored · leave blank to keep" : "Optional"}
                    />
                    {selected?.has_token && (
                      <span className="secret-option">
                        <input
                          type="checkbox"
                          checked={draft.clearToken}
                          onChange={(event) => patch("clearToken", event.target.checked)}
                        />
                        Clear stored token
                      </span>
                    )}
                  </label>
                  <label>
                    <span>Client credential</span>
                    <input
                      type="password"
                      value={draft.credential}
                      onChange={(event) => patch("credential", event.target.value)}
                      placeholder={selected?.has_credential ? "Stored · leave blank to keep" : "client-id:secret"}
                    />
                    {selected?.has_credential && (
                      <span className="secret-option">
                        <input
                          type="checkbox"
                          checked={draft.clearCredential}
                          onChange={(event) => patch("clearCredential", event.target.checked)}
                        />
                        Clear stored credential
                      </span>
                    )}
                  </label>
                </div>

                <div className="form-section-title">PyIceberg properties</div>
                <label className="json-field">
                  <span>JSON object</span>
                  <textarea
                    value={draft.properties}
                    onChange={(event) => patch("properties", event.target.value)}
                    spellCheck={false}
                    rows={5}
                  />
                </label>
              </>
            )}

            <label className="default-option">
              <input
                type="checkbox"
                checked={draft.setDefault}
                disabled={selected?.is_default}
                onChange={(event) => patch("setDefault", event.target.checked)}
              />
              <span>
                <strong>Default catalog</strong>
                <small>Use this connection when no catalog is explicitly selected.</small>
              </span>
            </label>

            {message && (
              <div className={`form-message form-message--${message.type}`}>
                {message.type === "success" ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
                <span>{message.text}</span>
              </div>
            )}

            <footer className="catalog-form__actions">
              <button className="button" type="button" onClick={() => void runTest()} disabled={busy}>
                <TestTubeDiagonal size={15} />
                Test connection
              </button>
              <button className="button button--primary" type="submit" disabled={busy}>
                <Save size={15} />
                Save
              </button>
            </footer>
          </form>
        </div>
      </section>
    </div>
  );
}
