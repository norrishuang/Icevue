import { useState } from "react";
import { AlertCircle, CheckCircle2, Plus, Trash2, X } from "lucide-react";
import { createTable } from "../api";
import type { SchemaFieldInput } from "../types";

interface CreateTableModalProps {
  catalogId: string;
  namespace: string;
  onClose: () => void;
  onCreated: (namespace: string, name: string) => void;
}

interface FieldDraft {
  name: string;
  type: string;
  required: boolean;
  doc: string;
}

const COMMON_TYPES = [
  "string", "long", "integer", "double", "float", "boolean",
  "date", "timestamp", "timestamptz", "binary", "uuid",
];

function emptyField(): FieldDraft {
  return { name: "", type: "string", required: false, doc: "" };
}

export function CreateTableModal({
  catalogId,
  namespace,
  onClose,
  onCreated,
}: CreateTableModalProps) {
  const [tableName, setTableName] = useState("");
  const [fields, setFields] = useState<FieldDraft[]>([emptyField()]);
  const [partitionBy, setPartitionBy] = useState("");
  const [location, setLocation] = useState("");
  const [propertiesJson, setPropertiesJson] = useState("{}");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function addField() {
    setFields((prev) => [...prev, emptyField()]);
  }

  function removeField(index: number) {
    setFields((prev) => prev.filter((_, i) => i !== index));
  }

  function patchField<K extends keyof FieldDraft>(index: number, key: K, value: FieldDraft[K]) {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, [key]: value } : f)));
  }

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

    const schemaFields: SchemaFieldInput[] = fields
      .filter((f) => f.name.trim())
      .map((f) => ({
        name: f.name.trim(),
        type: f.type.trim() || "string",
        required: f.required,
        doc: f.doc.trim() || null,
      }));

    if (schemaFields.length === 0) {
      setError("At least one field is required");
      return;
    }

    const partition_by = partitionBy
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    setBusy(true);
    setError("");
    try {
      await createTable(catalogId, {
        namespace,
        name: tableName.trim(),
        fields: schemaFields,
        partition_by,
        location: location.trim() || null,
        properties,
      });
      onCreated(namespace, tableName.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create table");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="catalog-manager"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-table-title"
        style={{ maxWidth: "680px" }}
      >
        <header className="catalog-manager__header">
          <div>
            <h2 id="create-table-title">New table</h2>
            <p>{namespace}</p>
          </div>
          <button className="icon-button" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>

        <form
          className="catalog-manager__body"
          onSubmit={(e) => void submit(e)}
          style={{ display: "block", padding: "1.5rem", overflowY: "auto", maxHeight: "70vh" }}
        >
          <div className="form-grid" style={{ marginBottom: "1.5rem" }}>
            <label className="form-grid__wide">
              <span>Table name</span>
              <input
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                placeholder="my_table"
                required
                autoFocus
              />
            </label>
          </div>

          <div className="form-section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Schema fields</span>
            <button type="button" className="icon-button" onClick={addField} title="Add field">
              <Plus size={15} />
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1.25rem" }}>
            {fields.map((field, index) => (
              <div
                key={index}
                style={{ display: "grid", gridTemplateColumns: "1fr 120px auto auto auto", gap: "0.5rem", alignItems: "center" }}
              >
                <input
                  value={field.name}
                  onChange={(e) => patchField(index, "name", e.target.value)}
                  placeholder="field_name"
                  required
                />
                <select
                  value={COMMON_TYPES.includes(field.type) ? field.type : "custom"}
                  onChange={(e) => {
                    if (e.target.value !== "custom") patchField(index, "type", e.target.value);
                  }}
                >
                  {COMMON_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                  <option value="custom">custom…</option>
                </select>
                {!COMMON_TYPES.includes(field.type) && (
                  <input
                    value={field.type}
                    onChange={(e) => patchField(index, "type", e.target.value)}
                    placeholder="decimal(18,2)"
                    style={{ gridColumn: "span 1" }}
                  />
                )}
                <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(e) => patchField(index, "required", e.target.checked)}
                  />
                  req
                </label>
                <input
                  value={field.doc}
                  onChange={(e) => patchField(index, "doc", e.target.value)}
                  placeholder="description (optional)"
                />
                <button
                  type="button"
                  className="icon-button icon-button--danger"
                  onClick={() => removeField(index)}
                  disabled={fields.length === 1}
                  title="Remove field"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          <div className="form-section-title">Partitioning (optional)</div>
          <div className="form-grid" style={{ marginBottom: "1.25rem" }}>
            <label className="form-grid__wide">
              <span>Partition by (comma-separated field names)</span>
              <input
                value={partitionBy}
                onChange={(e) => setPartitionBy(e.target.value)}
                placeholder="event_date, region"
              />
            </label>
            <label className="form-grid__wide">
              <span>Location (optional)</span>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="s3://warehouse/namespace/table"
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
              rows={3}
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
              Create table
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
