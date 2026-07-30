export function formatNumber(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return new Intl.NumberFormat("en-US").format(numeric);
}

export function formatCompact(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(numeric);
}

export function formatBytes(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  let bytes = Number(value);
  if (!Number.isFinite(bytes)) return String(value);
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let unit = 0;
  while (Math.abs(bytes) >= 1024 && unit < units.length - 1) {
    bytes /= 1024;
    unit += 1;
  }
  return `${bytes.toLocaleString("en-US", { maximumFractionDigits: 1 })} ${units[unit]}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function humanize(value: string): string {
  return value
    .replaceAll("_in_bytes", "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatCell(column: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  if (column.includes("size_in_bytes") || column.endsWith("_bytes")) {
    return formatBytes(value as string | number);
  }
  if (column.includes("count") || column.includes("number")) {
    return formatNumber(value as string | number);
  }
  return String(value);
}

