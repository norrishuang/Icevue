"""Environment-based application configuration."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any


def _as_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    """Runtime settings loaded from environment variables."""

    demo_mode: bool
    catalog_name: str
    catalog_uri: str | None
    catalog_warehouse: str | None
    catalog_credential: str | None
    catalog_token: str | None
    catalog_oauth2_server_uri: str | None
    catalog_scope: str | None
    catalog_prefix: str | None
    catalog_properties: dict[str, Any]
    catalog_config_file: Path
    static_dir: Path
    max_partition_page_size: int

    def pyiceberg_properties(self) -> dict[str, Any]:
        """Build properties accepted by PyIceberg's REST catalog loader."""

        properties: dict[str, Any] = dict(self.catalog_properties)
        optional_values = {
            "uri": self.catalog_uri,
            "warehouse": self.catalog_warehouse,
            "credential": self.catalog_credential,
            "token": self.catalog_token,
            "oauth2-server-uri": self.catalog_oauth2_server_uri,
            "scope": self.catalog_scope,
            "prefix": self.catalog_prefix,
        }
        properties.update({key: value for key, value in optional_values.items() if value})
        return properties


@lru_cache
def get_settings() -> Settings:
    """Return a cached settings object."""

    raw_properties = os.getenv("ICEVUE_CATALOG_PROPERTIES", "{}")
    try:
        catalog_properties = json.loads(raw_properties)
    except json.JSONDecodeError as exc:
        raise ValueError("ICEVUE_CATALOG_PROPERTIES must be valid JSON") from exc
    if not isinstance(catalog_properties, dict):
        raise ValueError("ICEVUE_CATALOG_PROPERTIES must be a JSON object")

    project_root = Path(__file__).resolve().parent.parent
    return Settings(
        demo_mode=_as_bool(os.getenv("ICEVUE_DEMO_MODE"), default=False),
        catalog_name=os.getenv("ICEVUE_CATALOG_NAME", "iceberg"),
        catalog_uri=os.getenv("ICEVUE_CATALOG_URI"),
        catalog_warehouse=os.getenv("ICEVUE_CATALOG_WAREHOUSE"),
        catalog_credential=os.getenv("ICEVUE_CATALOG_CREDENTIAL"),
        catalog_token=os.getenv("ICEVUE_CATALOG_TOKEN"),
        catalog_oauth2_server_uri=os.getenv("ICEVUE_CATALOG_OAUTH2_SERVER_URI"),
        catalog_scope=os.getenv("ICEVUE_CATALOG_SCOPE"),
        catalog_prefix=os.getenv("ICEVUE_CATALOG_PREFIX"),
        catalog_properties=catalog_properties,
        catalog_config_file=Path(
            os.getenv(
                "ICEVUE_CATALOG_CONFIG",
                project_root / "config" / "catalogs.yaml",
            )
        ),
        static_dir=Path(os.getenv("ICEVUE_STATIC_DIR", project_root / "frontend" / "dist")),
        max_partition_page_size=int(os.getenv("ICEVUE_MAX_PARTITION_PAGE_SIZE", "250")),
    )
