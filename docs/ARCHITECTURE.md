# Architecture

Icevue is a read-only, single-process metadata explorer for Apache Iceberg.
It intentionally does not include a SQL query engine.

## Components

```text
Browser
  |
  | HTTP/JSON
  v
FastAPI application
  |-- Serves the compiled React application
  |-- Manages the local catalogs.yaml file
  |-- Exposes read-only Iceberg metadata endpoints
  `-- Uses PyIceberg
        |
        | Iceberg REST Catalog protocol
        v
Iceberg REST Catalog
        |
        | Metadata and manifest reads
        v
Object storage
```

The browser never receives catalog credentials. The backend creates the
PyIceberg catalog client from environment variables and translates PyIceberg
objects into a stable JSON contract for the UI.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Container health and application version |
| `GET /api/v1/catalogs` | Configured Catalog connections with secrets redacted |
| `POST /api/v1/catalogs` | Add a connection to the local YAML file |
| `PUT /api/v1/catalogs/{id}` | Update a connection in the local YAML file |
| `DELETE /api/v1/catalogs/{id}` | Delete a local connection |
| `POST /api/v1/catalogs/test` | Test a connection without saving it |
| `GET /api/v1/catalog` | Namespaces, table identifiers, and connection status |
| `GET /api/v1/table` | Schema history, specs, sort orders, snapshots, refs, and properties |
| `GET /api/v1/partitions` | Paginated partition metadata from PyIceberg inspection |
| `GET /api/docs` | OpenAPI documentation |

The Catalog configuration endpoints modify only Icevue's local YAML file.
All Apache Iceberg operations are read-only. Icevue does not expose table
create, update, append, delete, or commit endpoints.

## Metadata behavior

PyIceberg loads table metadata through the REST Catalog. Partition information
comes from `table.inspect.partitions()`, which reads Iceberg metadata and
manifest information rather than scanning table records. Large tables can
still have substantial manifest metadata, so the API limits response page size.

The first release reads the full partition inspection result before applying
filtering and response pagination. A future release can add caching and
manifest-level streaming for catalogs with very large partition counts.

## Security boundary

- Catalog credentials are stored in `catalogs.yaml`, which is written
  with mode `0600` and never returned by the API.
- Icevue has no Iceberg mutation routes.
- The container runs as an unprivileged user.
- TLS termination and user authentication should be provided by a reverse
  proxy or an ingress controller in production.
- The catalog principal should have only the object and catalog read
  permissions required by PyIceberg.
