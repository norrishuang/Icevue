"""FastAPI entry point for Icevue."""

from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from icevue import __version__
from icevue.catalog_store import CatalogService, CatalogStore
from icevue.config import Settings, get_settings
from icevue.errors import (
    CatalogConfigurationError,
    CatalogConnectionError,
    NamespaceNotFoundError,
    TableNotFoundError,
    WriteNotSupportedError,
)
from icevue.models import (
    CatalogCollection,
    CatalogInput,
    CatalogTestResult,
    CatalogTree,
    CatalogView,
    NamespaceDetail,
    NamespaceInput,
    PartitionPage,
    TableDetail,
    TableInput,
)


def create_app(settings: Settings | None = None) -> FastAPI:
    runtime_settings = settings or get_settings()
    store = CatalogStore(runtime_settings)
    app = FastAPI(
        title="Icevue API",
        description="Read-only Iceberg metadata and local catalog configuration API.",
        version=__version__,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )

    @app.exception_handler(CatalogConfigurationError)
    async def configuration_error(
        request: Request, exc: CatalogConfigurationError
    ) -> JSONResponse:
        del request
        return JSONResponse(status_code=503, content={"detail": str(exc), "code": "configuration"})

    @app.exception_handler(CatalogConnectionError)
    async def connection_error(request: Request, exc: CatalogConnectionError) -> JSONResponse:
        del request
        return JSONResponse(status_code=502, content={"detail": str(exc), "code": "catalog"})

    @app.exception_handler(TableNotFoundError)
    async def table_not_found(request: Request, exc: TableNotFoundError) -> JSONResponse:
        del request
        return JSONResponse(status_code=404, content={"detail": str(exc), "code": "not_found"})

    @app.exception_handler(NamespaceNotFoundError)
    async def namespace_not_found(request: Request, exc: NamespaceNotFoundError) -> JSONResponse:
        del request
        return JSONResponse(status_code=404, content={"detail": str(exc), "code": "not_found"})

    @app.exception_handler(WriteNotSupportedError)
    async def write_not_supported(request: Request, exc: WriteNotSupportedError) -> JSONResponse:
        del request
        return JSONResponse(status_code=405, content={"detail": str(exc), "code": "read_only"})

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        del request
        return JSONResponse(
            status_code=422,
            content={"detail": "Invalid request parameters"},
        )

    def not_found(catalog_id: str) -> HTTPException:
        return HTTPException(status_code=404, detail=f"Catalog '{catalog_id}' was not found")

    async def catalog_service(
        catalog_id: Annotated[str | None, Query(max_length=64)] = None,
    ) -> CatalogService:
        try:
            return store.service(catalog_id)
        except KeyError as exc:
            raise not_found(str(exc.args[0])) from exc

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    @app.get("/api/v1/catalogs", response_model=CatalogCollection)
    async def catalogs() -> CatalogCollection:
        return store.list()

    @app.post(
        "/api/v1/catalogs",
        response_model=CatalogView,
        status_code=status.HTTP_201_CREATED,
    )
    async def create_catalog(value: CatalogInput) -> CatalogView:
        try:
            return store.create(value)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @app.put("/api/v1/catalogs/{catalog_id}", response_model=CatalogView)
    async def update_catalog(catalog_id: str, value: CatalogInput) -> CatalogView:
        try:
            return store.update(catalog_id, value)
        except KeyError as exc:
            raise not_found(catalog_id) from exc
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @app.delete(
        "/api/v1/catalogs/{catalog_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        response_class=Response,
    )
    async def delete_catalog(catalog_id: str) -> Response:
        try:
            store.delete(catalog_id)
        except KeyError as exc:
            raise not_found(catalog_id) from exc
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.post("/api/v1/catalogs/test", response_model=CatalogTestResult)
    async def test_catalog(
        value: CatalogInput,
        existing_id: Annotated[str | None, Query(max_length=64)] = None,
    ) -> CatalogTestResult:
        try:
            return store.test(value, existing_id)
        except KeyError as exc:
            raise not_found(str(exc.args[0])) from exc

    @app.get("/api/v1/catalog", response_model=CatalogTree)
    async def catalog_tree(
        catalog: Annotated[CatalogService, Depends(catalog_service)],
    ) -> CatalogTree:
        return catalog.tree()

    @app.get("/api/v1/table", response_model=TableDetail)
    async def table_detail(
        namespace: Annotated[str, Query(min_length=1)],
        name: Annotated[str, Query(min_length=1)],
        catalog: Annotated[CatalogService, Depends(catalog_service)],
    ) -> TableDetail:
        return catalog.table(namespace, name)

    @app.get("/api/v1/namespace", response_model=NamespaceDetail)
    async def namespace_detail(
        namespace: Annotated[str, Query(min_length=1)],
        catalog: Annotated[CatalogService, Depends(catalog_service)],
    ) -> NamespaceDetail:
        return catalog.get_namespace(namespace)

    @app.post(
        "/api/v1/namespace",
        response_model=NamespaceDetail,
        status_code=status.HTTP_201_CREATED,
    )
    async def create_namespace(
        value: NamespaceInput,
        catalog: Annotated[CatalogService, Depends(catalog_service)],
    ) -> NamespaceDetail:
        return catalog.create_namespace(value.namespace, value.properties)

    @app.post(
        "/api/v1/table",
        response_model=TableDetail,
        status_code=status.HTTP_201_CREATED,
    )
    async def create_table(
        value: TableInput,
        catalog: Annotated[CatalogService, Depends(catalog_service)],
    ) -> TableDetail:
        return catalog.create_table(value)

    @app.get("/api/v1/partitions", response_model=PartitionPage)
    async def partitions(
        namespace: Annotated[str, Query(min_length=1)],
        name: Annotated[str, Query(min_length=1)],
        catalog: Annotated[CatalogService, Depends(catalog_service)],
        page: Annotated[int, Query(ge=1)] = 1,
        page_size: Annotated[int, Query(ge=1, le=runtime_settings.max_partition_page_size)] = 50,
        query: Annotated[str | None, Query(max_length=200)] = None,
    ) -> PartitionPage:
        return catalog.partitions(namespace, name, page, page_size, query)

    static_dir = runtime_settings.static_dir
    assets_dir = static_dir / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False, response_model=None)
    async def frontend(full_path: str) -> FileResponse | JSONResponse:
        del full_path
        index = Path(static_dir) / "index.html"
        if index.is_file():
            return FileResponse(index)
        return JSONResponse(
            status_code=404,
            content={
                "detail": "Frontend assets are not built. Run npm run build in frontend/."
            },
        )

    return app


app = create_app()
