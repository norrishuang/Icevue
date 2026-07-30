import asyncio
from dataclasses import replace
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

import httpx
import pytest
import yaml
from fastapi import FastAPI

from icevue.catalog import IcebergCatalogService
from icevue.config import get_settings
from icevue.main import create_app


def send(
    app: FastAPI,
    method: str,
    path: str,
    params: dict[str, Any] | None = None,
    json: dict[str, Any] | None = None,
) -> httpx.Response:
    async def send() -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            return await client.request(method, path, params=params, json=json)

    return asyncio.run(send())


def request(path: str, params: dict[str, Any] | None = None) -> httpx.Response:
    with TemporaryDirectory() as directory:
        settings = replace(
            get_settings(),
            demo_mode=True,
            catalog_uri=None,
            catalog_config_file=Path(directory) / "catalogs.yaml",
        )
        return send(create_app(settings), "GET", path, params=params)


def test_health() -> None:
    response = request("/api/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_catalog_tree_contains_namespaces_and_tables() -> None:
    response = request("/api/v1/catalog")

    assert response.status_code == 200
    payload = response.json()
    assert payload["catalog"]["mode"] == "demo"
    assert payload["namespaces"][0]["namespace"] == "analytics"
    assert payload["namespaces"][0]["tables"][0]["name"] == "events"


def test_table_detail_contains_rich_metadata() -> None:
    response = request(
        "/api/v1/table",
        params={"namespace": "analytics", "name": "events"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["format_version"] == 2
    assert payload["schemas"][-1]["current"] is True
    assert payload["partition_specs"][0]["fields"][0]["transform"] == "day"
    assert payload["snapshots"][-1]["current"] is True
    assert payload["properties"]["write.parquet.compression-codec"] == "zstd"


def test_partition_pagination_and_filtering() -> None:
    response = request(
        "/api/v1/partitions",
        params={
            "namespace": "analytics",
            "name": "events",
            "page": 2,
            "page_size": 10,
            "query": "purchase",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 30
    assert len(payload["rows"]) == 10
    assert all(row["event_type"] == "purchase" for row in payload["rows"])


def test_partition_page_size_is_limited() -> None:
    response = request(
        "/api/v1/partitions",
        params={
            "namespace": "analytics",
            "name": "events",
            "page_size": 251,
        },
    )

    assert response.status_code == 422


def test_catalog_tree_recursively_lists_nested_namespaces() -> None:
    class NestedCatalog:
        def list_namespaces(self, namespace: tuple[str, ...] = ()) -> list[tuple[str, ...]]:
            children = {
                (): [("commerce",)],
                ("commerce",): [("raw",)],
                ("commerce", "raw"): [],
            }
            return children[namespace]

        def list_tables(self, namespace: tuple[str, ...]) -> list[tuple[str, ...]]:
            if namespace == ("commerce", "raw"):
                return [("commerce", "raw", "order_events")]
            return []

    service = IcebergCatalogService.__new__(IcebergCatalogService)
    service.settings = replace(
        get_settings(),
        demo_mode=False,
        catalog_name="nested",
        catalog_uri="http://catalog.example",
    )
    service.catalog = NestedCatalog()

    tree = service.tree()

    assert [node.namespace for node in tree.namespaces] == ["commerce", "commerce.raw"]
    assert tree.namespaces[1].tables[0].name == "order_events"


@pytest.mark.parametrize("signing_name", ["glue", "s3tables"])
def test_aws_catalog_does_not_probe_nested_namespaces(
    monkeypatch: pytest.MonkeyPatch,
    signing_name: str,
) -> None:
    class FlatCatalog:
        def list_namespaces(
            self, namespace: tuple[str, ...] = ()
        ) -> list[tuple[str, ...]]:
            if namespace:
                raise AssertionError("AWS catalogs must not receive a parent namespace")
            return [("analytics",), ("commerce",)]

        def list_tables(self, namespace: tuple[str, ...]) -> list[tuple[str, ...]]:
            return [(*namespace, "events")]

    monkeypatch.setattr("icevue.catalog.load_catalog", lambda *args, **kwargs: FlatCatalog())
    if signing_name == "glue":
        monkeypatch.setattr(
            "icevue.catalog.boto3.client",
            lambda *args, **kwargs: GlueClient(
                [
                    {
                        "Name": "events",
                        "Parameters": {
                            "table_type": "ICEBERG",
                            "metadata_location": "s3://warehouse/events/metadata.json",
                        },
                    }
                ]
            ),
        )
    settings = replace(
        get_settings(),
        demo_mode=False,
        catalog_name=signing_name,
        catalog_uri=f"https://{signing_name}.us-east-1.amazonaws.com/iceberg",
        catalog_properties={"rest.signing-name": signing_name},
    )
    service = IcebergCatalogService(settings)

    tree = service.tree()

    assert [node.namespace for node in tree.namespaces] == ["analytics", "commerce"]
    assert [node.tables[0].name for node in tree.namespaces] == ["events", "events"]


class GluePaginator:
    def __init__(self, tables: list[dict[str, Any]]):
        self.tables = tables

    def paginate(self, **kwargs: Any) -> list[dict[str, Any]]:
        del kwargs
        return [{"TableList": self.tables}]


class GlueClient:
    def __init__(self, tables: list[dict[str, Any]]):
        self.tables = tables

    def get_paginator(self, operation: str) -> GluePaginator:
        assert operation == "get_tables"
        return GluePaginator(self.tables)


def test_glue_catalog_filters_non_iceberg_tables(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class GlueRestCatalog:
        def list_namespaces(self) -> list[tuple[str, ...]]:
            return [("mixed",)]

    tables = [
        {
            "Name": "iceberg_events",
            "Parameters": {
                "table_type": "ICEBERG",
                "metadata_location": "s3://warehouse/events/metadata.json",
            },
        },
        {"Name": "parquet_events", "Parameters": {"classification": "parquet"}},
        {"Name": "delta_events", "Parameters": {"table_type": "delta"}},
    ]
    monkeypatch.setattr(
        "icevue.catalog.load_catalog", lambda *args, **kwargs: GlueRestCatalog()
    )
    monkeypatch.setattr(
        "icevue.catalog.boto3.client", lambda *args, **kwargs: GlueClient(tables)
    )
    settings = replace(
        get_settings(),
        demo_mode=False,
        catalog_name="glue",
        catalog_uri="https://glue.us-east-1.amazonaws.com/iceberg",
        catalog_warehouse="123456789012",
        catalog_properties={
            "rest.signing-name": "glue",
            "rest.signing-region": "us-east-1",
        },
    )

    tree = IcebergCatalogService(settings).tree()

    assert [table.name for table in tree.namespaces[0].tables] == ["iceberg_events"]


def test_catalog_configuration_crud_persists_and_redacts_secrets() -> None:
    with TemporaryDirectory() as directory:
        config_path = Path(directory) / "catalogs.yaml"
        settings = replace(
            get_settings(),
            demo_mode=True,
            catalog_uri=None,
            catalog_config_file=config_path,
        )
        app = create_app(settings)

        initial = send(app, "GET", "/api/v1/catalogs")
        assert initial.status_code == 200
        assert initial.json()["default_catalog"] == "demo"

        create = send(
            app,
            "POST",
            "/api/v1/catalogs",
            json={
                "id": "production",
                "name": "Production",
                "type": "rest",
                "uri": "http://catalog.example",
                "warehouse": "s3://warehouse/",
                "token": "secret-token",
                "properties": {"s3.region": "us-east-1"},
                "set_default": True,
            },
        )
        assert create.status_code == 201
        assert create.json()["has_token"] is True
        assert "token" not in create.json()

        listing = send(app, "GET", "/api/v1/catalogs").json()
        assert listing["default_catalog"] == "production"
        production = next(item for item in listing["catalogs"] if item["id"] == "production")
        assert production["has_token"] is True
        assert "token" not in production

        update = send(
            app,
            "PUT",
            "/api/v1/catalogs/production",
            json={
                "id": "production",
                "name": "Primary",
                "type": "rest",
                "uri": "http://catalog.example",
                "properties": {},
            },
        )
        assert update.status_code == 200
        assert update.json()["name"] == "Primary"
        assert update.json()["has_token"] is True

        document = yaml.safe_load(config_path.read_text(encoding="utf-8"))
        stored = next(item for item in document["catalogs"] if item["id"] == "production")
        assert stored["token"] == "secret-token"
        assert config_path.stat().st_mode & 0o777 == 0o600

        delete = send(app, "DELETE", "/api/v1/catalogs/production")
        assert delete.status_code == 204
        assert send(app, "GET", "/api/v1/catalogs").json()["default_catalog"] == "demo"


def test_demo_catalog_connection_test() -> None:
    with TemporaryDirectory() as directory:
        settings = replace(
            get_settings(),
            demo_mode=True,
            catalog_uri=None,
            catalog_config_file=Path(directory) / "catalogs.yaml",
        )
        app = create_app(settings)
        response = send(
            app,
            "POST",
            "/api/v1/catalogs/test",
            json={
                "id": "sample",
                "name": "Sample",
                "type": "demo",
                "properties": {},
            },
        )

        assert response.status_code == 200
        assert response.json()["connected"] is True
        assert response.json()["namespace_count"] == 3
