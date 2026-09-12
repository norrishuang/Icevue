export interface CatalogStatus {
  id: string;
  name: string;
  mode: "demo" | "rest";
  connected: boolean;
  uri: string | null;
  message: string | null;
}

export interface CatalogConfig {
  id: string;
  name: string;
  type: "demo" | "rest";
  uri: string | null;
  warehouse: string | null;
  oauth2_server_uri: string | null;
  scope: string | null;
  prefix: string | null;
  properties: Record<string, unknown>;
  has_token: boolean;
  has_credential: boolean;
  is_default: boolean;
}

export interface CatalogCollection {
  default_catalog: string;
  config_path: string;
  catalogs: CatalogConfig[];
}

export interface CatalogInput {
  id: string;
  name: string;
  type: "demo" | "rest";
  uri?: string | null;
  warehouse?: string | null;
  credential?: string | null;
  token?: string | null;
  oauth2_server_uri?: string | null;
  scope?: string | null;
  prefix?: string | null;
  properties: Record<string, unknown>;
  set_default: boolean;
  clear_token: boolean;
  clear_credential: boolean;
}

export interface CatalogTestResult {
  connected: boolean;
  message: string;
  namespace_count: number;
}

export interface TableRef {
  namespace: string;
  name: string;
}

export interface NamespaceNode {
  namespace: string;
  display_name: string;
  tables: TableRef[];
}

export interface CatalogTree {
  catalog: CatalogStatus;
  namespaces: NamespaceNode[];
}

export interface SchemaField {
  id: number;
  name: string;
  type: string;
  required: boolean;
  doc: string | null;
}

export interface SchemaVersion {
  schema_id: number;
  fields: SchemaField[];
  current: boolean;
}

export interface PartitionField {
  field_id: number;
  source_id: number;
  name: string;
  transform: string;
  source_column: string | null;
}

export interface PartitionSpec {
  spec_id: number;
  fields: PartitionField[];
  current: boolean;
}

export interface SortField {
  source_id: number;
  transform: string;
  direction: string;
  null_order: string;
  source_column: string | null;
}

export interface SortOrder {
  order_id: number;
  fields: SortField[];
  current: boolean;
}

export interface SnapshotInfo {
  snapshot_id: number;
  parent_snapshot_id: number | null;
  sequence_number: number | null;
  timestamp_ms: number;
  timestamp: string;
  operation: string | null;
  manifest_list: string | null;
  summary: Record<string, string>;
  current: boolean;
}

export interface TableDetail {
  namespace: string;
  name: string;
  identifier: string;
  location: string;
  format_version: number;
  metadata_location: string | null;
  last_updated_ms: number | null;
  last_updated: string | null;
  current_snapshot_id: number | null;
  current_schema_id: number;
  default_spec_id: number;
  default_sort_order_id: number;
  schemas: SchemaVersion[];
  partition_specs: PartitionSpec[];
  sort_orders: SortOrder[];
  snapshots: SnapshotInfo[];
  properties: Record<string, string>;
  refs: Record<string, Record<string, unknown>>;
}

export interface PartitionPage {
  rows: Record<string, unknown>[];
  columns: string[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
}

export type TabId = "overview" | "schema" | "partitions" | "snapshots" | "properties";

export interface NamespaceDetail {
  namespace: string;
  properties: Record<string, string>;
}

export interface NamespaceInput {
  namespace: string;
  properties: Record<string, string>;
}

export interface SchemaFieldInput {
  name: string;
  type: string;
  required: boolean;
  doc?: string | null;
}

export interface TableInput {
  namespace: string;
  name: string;
  fields: SchemaFieldInput[];
  partition_by: string[];
  location?: string | null;
  properties: Record<string, string>;
}
