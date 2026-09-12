import type {
  CatalogCollection,
  CatalogConfig,
  CatalogInput,
  CatalogTestResult,
  CatalogTree,
  NamespaceDetail,
  NamespaceInput,
  PartitionPage,
  TableDetail,
  TableInput,
  TableRef,
} from "./types";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

interface RequestOptions {
  signal?: AbortSignal;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
}

async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(url, {
    signal: options.signal,
    method: options.method ?? "GET",
    headers: {
      Accept: "application/json",
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const body = (await response.json()) as { detail?: string };
      message = body.detail ?? message;
    } catch {
      // Keep the status-based fallback for non-JSON errors.
    }
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function tableQuery(catalogId: string, table: TableRef): string {
  const params = new URLSearchParams({
    catalog_id: catalogId,
    namespace: table.namespace,
    name: table.name,
  });
  return params.toString();
}

export function getCatalogs(signal?: AbortSignal): Promise<CatalogCollection> {
  return request<CatalogCollection>("/api/v1/catalogs", { signal });
}

export function createCatalog(value: CatalogInput): Promise<CatalogConfig> {
  return request<CatalogConfig>("/api/v1/catalogs", { method: "POST", body: value });
}

export function updateCatalog(id: string, value: CatalogInput): Promise<CatalogConfig> {
  return request<CatalogConfig>(`/api/v1/catalogs/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: value,
  });
}

export function deleteCatalog(id: string): Promise<void> {
  return request<void>(`/api/v1/catalogs/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function testCatalog(
  value: CatalogInput,
  existingId?: string,
): Promise<CatalogTestResult> {
  const query = existingId
    ? `?existing_id=${encodeURIComponent(existingId)}`
    : "";
  return request<CatalogTestResult>(`/api/v1/catalogs/test${query}`, {
    method: "POST",
    body: value,
  });
}

export function getCatalog(catalogId: string, signal?: AbortSignal): Promise<CatalogTree> {
  const query = new URLSearchParams({ catalog_id: catalogId });
  return request<CatalogTree>(`/api/v1/catalog?${query}`, { signal });
}

export function getTable(
  catalogId: string,
  table: TableRef,
  signal?: AbortSignal,
): Promise<TableDetail> {
  return request<TableDetail>(`/api/v1/table?${tableQuery(catalogId, table)}`, {
    signal,
  });
}

export function getNamespace(
  catalogId: string,
  namespace: string,
  signal?: AbortSignal,
): Promise<NamespaceDetail> {
  const params = new URLSearchParams({ catalog_id: catalogId, namespace });
  return request<NamespaceDetail>(`/api/v1/namespace?${params}`, { signal });
}

export function createNamespace(
  catalogId: string,
  value: NamespaceInput,
): Promise<NamespaceDetail> {
  const params = new URLSearchParams({ catalog_id: catalogId });
  return request<NamespaceDetail>(`/api/v1/namespace?${params}`, {
    method: "POST",
    body: value,
  });
}

export function createTable(
  catalogId: string,
  value: TableInput,
): Promise<TableDetail> {
  const params = new URLSearchParams({ catalog_id: catalogId });
  return request<TableDetail>(`/api/v1/table?${params}`, {
    method: "POST",
    body: value,
  });
}

export function getPartitions(
  catalogId: string,
  table: TableRef,
  page: number,
  pageSize: number,
  query: string,
  signal?: AbortSignal,
): Promise<PartitionPage> {
  const params = new URLSearchParams({
    catalog_id: catalogId,
    namespace: table.namespace,
    name: table.name,
    page: String(page),
    page_size: String(pageSize),
  });
  if (query.trim()) params.set("query", query.trim());
  return request<PartitionPage>(`/api/v1/partitions?${params}`, { signal });
}
