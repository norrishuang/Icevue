"""Public API response models."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class CatalogDefinition(BaseModel):
    """A catalog connection persisted in the Icevue configuration file."""

    id: str = Field(pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$")
    name: str = Field(min_length=1, max_length=100)
    type: Literal["demo", "rest"] = "rest"
    uri: str | None = None
    warehouse: str | None = None
    credential: str | None = None
    token: str | None = None
    oauth2_server_uri: str | None = None
    scope: str | None = None
    prefix: str | None = None
    properties: dict[str, Any] = Field(default_factory=dict)

    @field_validator(
        "uri",
        "warehouse",
        "credential",
        "token",
        "oauth2_server_uri",
        "scope",
        "prefix",
        mode="before",
    )
    @classmethod
    def empty_string_to_none(cls, value: Any) -> Any:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @model_validator(mode="after")
    def validate_rest_uri(self) -> CatalogDefinition:
        if self.type == "rest" and not self.uri:
            raise ValueError("URI is required for a REST catalog")
        return self


class CatalogDocument(BaseModel):
    version: int = 1
    default_catalog: str
    catalogs: list[CatalogDefinition]

    @model_validator(mode="after")
    def validate_document(self) -> CatalogDocument:
        identifiers = [catalog.id for catalog in self.catalogs]
        if not identifiers:
            raise ValueError("At least one catalog must be configured")
        if len(set(identifiers)) != len(identifiers):
            raise ValueError("Catalog IDs must be unique")
        if self.default_catalog not in identifiers:
            raise ValueError("The default catalog must reference a configured catalog")
        return self


class CatalogInput(CatalogDefinition):
    set_default: bool = False
    clear_token: bool = False
    clear_credential: bool = False


class CatalogView(BaseModel):
    id: str
    name: str
    type: Literal["demo", "rest"]
    uri: str | None = None
    warehouse: str | None = None
    oauth2_server_uri: str | None = None
    scope: str | None = None
    prefix: str | None = None
    properties: dict[str, Any] = Field(default_factory=dict)
    has_token: bool = False
    has_credential: bool = False
    is_default: bool = False


class CatalogCollection(BaseModel):
    default_catalog: str
    config_path: str
    catalogs: list[CatalogView]


class CatalogTestResult(BaseModel):
    connected: bool
    message: str
    namespace_count: int = 0


class CatalogStatus(BaseModel):
    id: str
    name: str
    mode: str
    connected: bool
    uri: str | None = None
    message: str | None = None


class TableRef(BaseModel):
    namespace: str
    name: str


class NamespaceNode(BaseModel):
    namespace: str
    display_name: str
    tables: list[TableRef] = Field(default_factory=list)


class CatalogTree(BaseModel):
    catalog: CatalogStatus
    namespaces: list[NamespaceNode]


class SchemaField(BaseModel):
    id: int
    name: str
    type: str
    required: bool
    doc: str | None = None


class SchemaVersion(BaseModel):
    schema_id: int
    fields: list[SchemaField]
    current: bool = False


class PartitionField(BaseModel):
    field_id: int
    source_id: int
    name: str
    transform: str
    source_column: str | None = None


class PartitionSpec(BaseModel):
    spec_id: int
    fields: list[PartitionField]
    current: bool = False


class SortField(BaseModel):
    source_id: int
    transform: str
    direction: str
    null_order: str
    source_column: str | None = None


class SortOrder(BaseModel):
    order_id: int
    fields: list[SortField]
    current: bool = False


class SnapshotInfo(BaseModel):
    snapshot_id: int
    parent_snapshot_id: int | None = None
    sequence_number: int | None = None
    timestamp_ms: int
    timestamp: str
    operation: str | None = None
    manifest_list: str | None = None
    summary: dict[str, str] = Field(default_factory=dict)
    current: bool = False


class TableDetail(BaseModel):
    namespace: str
    name: str
    identifier: str
    location: str
    format_version: int
    metadata_location: str | None = None
    last_updated_ms: int | None = None
    last_updated: str | None = None
    current_snapshot_id: int | None = None
    current_schema_id: int
    default_spec_id: int
    default_sort_order_id: int
    schemas: list[SchemaVersion]
    partition_specs: list[PartitionSpec]
    sort_orders: list[SortOrder]
    snapshots: list[SnapshotInfo]
    properties: dict[str, str]
    refs: dict[str, dict[str, Any]] = Field(default_factory=dict)


class PartitionPage(BaseModel):
    rows: list[dict[str, Any]]
    columns: list[str]
    page: int
    page_size: int
    total: int
    has_more: bool
