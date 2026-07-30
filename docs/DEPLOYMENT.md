# Deployment

## Docker Compose

```bash
docker compose up --build -d
```

Open `http://localhost:8000`. The OpenAPI page is available at
`http://localhost:8000/api/docs`. Use the Catalog settings button in the UI
to add connections. Docker Compose persists the YAML file in the
`icevue-config` named volume.

Inspect or back up the configuration:

```bash
docker compose exec icevue cat /app/config/catalogs.yaml
docker run --rm -v icevue_icevue-config:/config alpine \
  tar -czf /config/icevue-config-backup.tar.gz -C /config catalogs.yaml
```

## Docker

```bash
docker build -t icevue:0.1.0 .
docker run --rm -p 8000:8000 \
  -v icevue-config:/app/config \
  icevue:0.1.0
```

On Linux, use a reachable DNS name or add
`--add-host=host.docker.internal:host-gateway` when the catalog runs on the
Docker host.

## Host file mount

To keep the configuration directly in the project directory, prepare a
writable directory and run the container with the host user:

```bash
mkdir -p config
cp -n config/catalogs.example.yaml config/catalogs.yaml
docker run --rm -p 8000:8000 \
  --user "$(id -u):$(id -g)" \
  -e ICEVUE_CATALOG_CONFIG=/app/config/catalogs.yaml \
  -v "$PWD/config:/app/config" \
  icevue:0.1.0
```

## Authentication

Credentials can be entered in the UI. The equivalent YAML for a static token:

```yaml
token: ey...
```

For OAuth2 client credentials:

```yaml
credential: client-id:client-secret
oauth2_server_uri: https://identity.example.com/oauth2/token
scope: catalog
```

Additional PyIceberg settings can be passed as JSON:

```yaml
properties:
  s3.region: us-east-1
  s3.endpoint: http://minio:9000
```

The exact settings depend on the REST Catalog and object store. IAM role or
workload identity credentials are preferred over long-lived access keys.

## Amazon S3 Tables

Create a REST Catalog connection with:

```yaml
id: s3tables
name: Amazon S3 Tables
type: rest
uri: https://s3tables.us-east-1.amazonaws.com/iceberg
warehouse: arn:aws:s3tables:us-east-1:123456789012:bucket/my-table-bucket
properties:
  rest.sigv4-enabled: "true"
  rest.signing-name: s3tables
  rest.signing-region: us-east-1
```

Leave the Icevue Prefix, bearer token, OAuth2, and client credential fields
empty. SigV4 uses the standard AWS credential chain. In AWS, attach a
read-only IAM role to the EC2 instance, ECS task, or EKS workload. For local
Docker, pass the standard `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and
optional `AWS_SESSION_TOKEN` variables, or mount an AWS profile into
`/home/icevue/.aws`.

## AWS Glue Data Catalog

Create a REST Catalog connection with:

```yaml
id: glue-prod
name: AWS Glue Production
type: rest
uri: https://glue.us-east-1.amazonaws.com/iceberg
warehouse: "123456789012"
properties:
  rest.sigv4-enabled: "true"
  rest.signing-name: glue
  rest.signing-region: us-east-1
```

Use the AWS account ID as the warehouse value. Keep the endpoint region and
`rest.signing-region` consistent with the Glue Data Catalog region. Leave the
Icevue Prefix, bearer token, OAuth2, and client credential fields empty.

Icevue keeps Glue databases visible but lists only tables whose Glue metadata
identifies them as Iceberg. Parquet, Delta, Hudi, and other table formats are
excluded. Databases that disappear during discovery or resolve to missing
resource links do not prevent the rest of the Catalog from loading.

The runtime IAM identity needs Glue metadata permissions such as:

```text
glue:GetDatabase
glue:GetDatabases
glue:GetTable
glue:GetTables
glue:GetTableVersion
glue:GetTableVersions
```

Reading Iceberg metadata, manifests, and partition information also requires
`s3:ListBucket` and `s3:GetObject` on the table storage locations. Tables
governed by AWS Lake Formation require the corresponding `DESCRIBE` and
`SELECT` grants.

## Production checklist

1. Use a read-only Catalog identity.
2. Protect the configuration volume because it may contain credentials.
3. Put Icevue behind an authenticated HTTPS reverse proxy.
4. Avoid writing secrets to image layers or source-controlled files.
5. Restrict network access from the container to the Catalog, identity
   provider, and object storage endpoints it requires.
6. Monitor `/api/health` and container logs.

## Local development

Backend:

```bash
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
ICEVUE_DEMO_MODE=true .venv/bin/uvicorn icevue.main:app --reload
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Vite listens on port `5173` and proxies `/api` to the backend on port `8000`.
