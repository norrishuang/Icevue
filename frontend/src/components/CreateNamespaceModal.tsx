import { useState } from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";
import { createNamespace } from "../api";

interface CreateNamespaceModalProps {
  catalogId: string;
  onClose: () => void;
  onCreated: (namespace: string) => void;
}

export function CreateNamespaceModal({
  catalogId,
  onClose,
  onCreated,
}: CreateNamespaceModalProps) {
  const [name, setName] = useState("");
  const [propertiesJson, setPropertiesJson] = useState("{}");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    let properties: Record<string, string>;
    try {
      const parsed = JSON.parse(propertiesJson || "{}") as unknown;
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        throw new Error("Properties must be a JSON object");
      }
      properties = parsed as Record<string, string>;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid properties JSON");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await createNamespace(catalogId, { namespace: name.trim(), properties });
      onCreated(name.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create namespace");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="catalog-manager" role="dialog" aria-modal="true" aria-labelledby="create-ns-title">
        <header className="catalog-manager__header">
          <div>
            <h2 id="create-ns-title">New namespace</h2>
          </div>
          <button className="icon-button" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>

        <form
          className="catalog-manager__body"
          onSubmit={(e) => void submit(e)}
          style={{ display: "block", padding: "1.5rem" }}
        >
          <div className="form-grid" style={{ marginBottom: "1.25rem" }}>
            <label className="form-grid__wide">
              <span>Namespace name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my_namespace"
                required
                autoFocus
              />
            </label>
          </div>

          <div className="form-section-title">Properties (optional)</div>
          <label className="json-field">
            <span>JSON object</span>
            <textarea
              value={propertiesJson}
              onChange={(e) => setPropertiesJson(e.target.value)}
              spellCheck={false}
              rows={4}
            />
          </label>

          {error && (
            <div className="form-message form-message--error" style={{ marginTop: "1rem" }}>
              <AlertCircle size={15} />
              <span>{error}</span>
            </div>
          )}

          <footer className="catalog-form__actions" style={{ marginTop: "1.5rem" }}>
            <button className="button" type="button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="button button--primary" type="submit" disabled={busy}>
              <CheckCircle2 size={15} />
              Create namespace
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
