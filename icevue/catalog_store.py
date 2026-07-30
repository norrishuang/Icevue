"""File-backed catalog configuration and service registry."""

from __future__ import annotations

import hashlib
import os
import tempfile
import threading
from dataclasses import replace
from pathlib import Path
from typing import Protocol

import yaml
from pydantic import ValidationError

from icevue.catalog import IcebergCatalogService
from icevue.config import Settings
from icevue.demo import DemoCatalogService
from icevue.errors import CatalogConfigurationError
from icevue.models import (
    CatalogCollection,
    CatalogDefinition,
    CatalogDocument,
    CatalogInput,
    CatalogTestResult,
    CatalogView,
)


class CatalogService(Protocol):
    def tree(self): ...

    def table(self, namespace: str, name: str): ...

    def partitions(
        self,
        namespace: str,
        name: str,
        page: int,
        page_size: int,
        query: str | None,
    ): ...


class CatalogStore:
    """Persist catalog connections and cache their PyIceberg clients."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.path = settings.catalog_config_file
        self._lock = threading.RLock()
        self._services: dict[str, tuple[str, CatalogService]] = {}
        self._ensure_file()

    def _bootstrap_document(self) -> CatalogDocument:
        if self.settings.catalog_uri:
            catalog = CatalogDefinition(
                id=self.settings.catalog_name,
                name=self.settings.catalog_name,
                type="rest",
                uri=self.settings.catalog_uri,
                warehouse=self.settings.catalog_warehouse,
                credential=self.settings.catalog_credential,
                token=self.settings.catalog_token,
                oauth2_server_uri=self.settings.catalog_oauth2_server_uri,
                scope=self.settings.catalog_scope,
                prefix=self.settings.catalog_prefix,
                properties=self.settings.catalog_properties,
            )
        else:
            catalog = CatalogDefinition(id="demo", name="Demo", type="demo")
        return CatalogDocument(default_catalog=catalog.id, catalogs=[catalog])

    def _ensure_file(self) -> None:
        with self._lock:
            if self.path.exists():
                return
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self._write(self._bootstrap_document())

    def _read(self) -> CatalogDocument:
        with self._lock:
            try:
                raw = yaml.safe_load(self.path.read_text(encoding="utf-8")) or {}
                return CatalogDocument.model_validate(raw)
            except (OSError, ValidationError, yaml.YAMLError) as exc:
                raise CatalogConfigurationError(
                    f"Unable to read catalog configuration {self.path}: {exc}"
                ) from exc

    def _write(self, document: CatalogDocument) -> None:
        payload = yaml.safe_dump(
            document.model_dump(mode="json", exclude_none=True),
            sort_keys=False,
            allow_unicode=False,
        )
        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=self.path.parent,
                prefix=".catalogs-",
                suffix=".yaml",
                delete=False,
            ) as handle:
                temporary_path = Path(handle.name)
                os.chmod(temporary_path, 0o600)
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_path, self.path)
            os.chmod(self.path, 0o600)
        except OSError as exc:
            if temporary_path and temporary_path.exists():
                temporary_path.unlink()
            raise CatalogConfigurationError(
                f"Unable to write catalog configuration {self.path}: {exc}"
            ) from exc

    @staticmethod
    def _view(catalog: CatalogDefinition, default_catalog: str) -> CatalogView:
        return CatalogView(
            id=catalog.id,
            name=catalog.name,
            type=catalog.type,
            uri=catalog.uri,
            warehouse=catalog.warehouse,
            oauth2_server_uri=catalog.oauth2_server_uri,
            scope=catalog.scope,
            prefix=catalog.prefix,
            properties=catalog.properties,
            has_token=bool(catalog.token),
            has_credential=bool(catalog.credential),
            is_default=catalog.id == default_catalog,
        )

    def list(self) -> CatalogCollection:
        document = self._read()
        return CatalogCollection(
            default_catalog=document.default_catalog,
            config_path=str(self.path),
            catalogs=[
                self._view(catalog, document.default_catalog)
                for catalog in document.catalogs
            ],
        )

    def get(self, catalog_id: str | None = None) -> CatalogDefinition:
        document = self._read()
        resolved_id = catalog_id or document.default_catalog
        for catalog in document.catalogs:
            if catalog.id == resolved_id:
                return catalog
        raise KeyError(resolved_id)

    def create(self, value: CatalogInput) -> CatalogView:
        with self._lock:
            document = self._read()
            if any(catalog.id == value.id for catalog in document.catalogs):
                raise ValueError(f"Catalog ID '{value.id}' already exists")
            catalog = CatalogDefinition.model_validate(
                value.model_dump(
                    exclude={"set_default", "clear_token", "clear_credential"}
                )
            )
            document.catalogs.append(catalog)
            if value.set_default:
                document.default_catalog = catalog.id
            self._write(document)
            self._services.pop(catalog.id, None)
            return self._view(catalog, document.default_catalog)

    def update(self, catalog_id: str, value: CatalogInput) -> CatalogView:
        with self._lock:
            document = self._read()
            for index, existing in enumerate(document.catalogs):
                if existing.id != catalog_id:
                    continue
                if value.id != catalog_id:
                    raise ValueError("Catalog ID cannot be changed")
                raw = value.model_dump(
                    exclude={"set_default", "clear_token", "clear_credential"}
                )
                if value.token is None and not value.clear_token:
                    raw["token"] = existing.token
                if value.credential is None and not value.clear_credential:
                    raw["credential"] = existing.credential
                catalog = CatalogDefinition.model_validate(raw)
                document.catalogs[index] = catalog
                if value.set_default:
                    document.default_catalog = catalog.id
                self._write(document)
                self._services.pop(catalog.id, None)
                return self._view(catalog, document.default_catalog)
        raise KeyError(catalog_id)

    def delete(self, catalog_id: str) -> None:
        with self._lock:
            document = self._read()
            if len(document.catalogs) == 1:
                raise ValueError("The last catalog cannot be deleted")
            remaining = [
                catalog for catalog in document.catalogs if catalog.id != catalog_id
            ]
            if len(remaining) == len(document.catalogs):
                raise KeyError(catalog_id)
            document.catalogs = remaining
            if document.default_catalog == catalog_id:
                document.default_catalog = remaining[0].id
            self._write(document)
            self._services.pop(catalog_id, None)

    def _build_service(self, catalog: CatalogDefinition) -> CatalogService:
        if catalog.type == "demo":
            return DemoCatalogService(catalog_id=catalog.id, name=catalog.name)
        runtime = replace(
            self.settings,
            demo_mode=False,
            catalog_name=catalog.id,
            catalog_uri=catalog.uri,
            catalog_warehouse=catalog.warehouse,
            catalog_credential=catalog.credential,
            catalog_token=catalog.token,
            catalog_oauth2_server_uri=catalog.oauth2_server_uri,
            catalog_scope=catalog.scope,
            catalog_prefix=catalog.prefix,
            catalog_properties=catalog.properties,
        )
        return IcebergCatalogService(runtime, display_name=catalog.name)

    def service(self, catalog_id: str | None = None) -> CatalogService:
        catalog = self.get(catalog_id)
        fingerprint = hashlib.sha256(
            catalog.model_dump_json().encode("utf-8")
        ).hexdigest()
        cached = self._services.get(catalog.id)
        if cached and cached[0] == fingerprint:
            return cached[1]
        service = self._build_service(catalog)
        self._services[catalog.id] = (fingerprint, service)
        return service

    def test(
        self,
        value: CatalogInput,
        existing_id: str | None = None,
    ) -> CatalogTestResult:
        raw = value.model_dump(
            exclude={"set_default", "clear_token", "clear_credential"}
        )
        if existing_id:
            existing = self.get(existing_id)
            if value.token is None and not value.clear_token:
                raw["token"] = existing.token
            if value.credential is None and not value.clear_credential:
                raw["credential"] = existing.credential
        catalog = CatalogDefinition.model_validate(raw)
        tree = self._build_service(catalog).tree()
        return CatalogTestResult(
            connected=True,
            message=f"Connected to {catalog.name}",
            namespace_count=len(tree.namespaces),
        )
