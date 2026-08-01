# Contributing to Icevue

Thank you for your interest in Icevue. Contributions of all sizes are
welcome: bug reports, compatibility findings, documentation improvements,
design feedback, feature ideas, and pull requests.

You do not need to have a finished design or implementation before joining
the conversation. Opening an issue with a use case, operational pain point,
or rough idea is a useful contribution.

## Project principles

Please keep these principles in mind when proposing or implementing changes:

- Icevue is a focused metadata explorer, not a SQL engine or data platform.
- All operations against Iceberg catalogs and tables must remain read-only.
- Catalog credentials must stay on the backend and must never be returned to
  the browser or written to logs.
- The application should remain lightweight and practical to run as a single
  container.
- UI changes should keep metadata dense, readable, and easy to navigate.
- Documentation, source comments, UI text, and commit messages should be in
  English.

Ideas outside the current scope are still welcome. Describe the problem first
so the community can discuss whether it fits Icevue and what a suitable
solution might look like.

## Reporting a bug

Before opening an issue, search the existing issues to see whether the problem
has already been reported. A useful bug report includes:

- The Icevue version or commit
- Deployment method, such as local Python, Docker, or Docker Compose
- REST Catalog implementation and version, when known
- PyIceberg version
- Clear steps to reproduce the problem
- Expected and actual behavior
- Relevant logs or screenshots
- A minimal, redacted Catalog configuration when the connection is involved

Remove tokens, client secrets, AWS account details, private endpoints, table
data, and other sensitive information before posting.

For Catalog compatibility problems, please also mention whether the service is
a generic Iceberg REST Catalog, AWS Glue Data Catalog, Amazon S3 Tables, or
another implementation. Include the failing operation and complete error
message after redacting sensitive values.

## Suggesting a feature or sharing an idea

Open a GitHub issue and explain:

- The problem or workflow you want to improve
- Who experiences the problem
- How the workflow is handled today
- What information or interaction would make it better
- Any relevant Iceberg specification or Catalog behavior

Mockups and examples are helpful but not required. Early proposals are
encouraged, especially when they can help validate the direction before code
is written.

## Preparing a pull request

For substantial changes, open an issue before investing in the implementation.
This gives maintainers and other contributors a chance to align on behavior,
scope, and compatibility concerns.

1. Fork the repository and create a focused branch from `main`.
2. Install the backend and frontend development dependencies.
3. Make the smallest coherent change that solves the issue.
4. Add or update tests for behavior that can regress.
5. Update documentation when configuration, deployment, APIs, or user-facing
   behavior changes.
6. Run the project checks locally.
7. Open a pull request and link the related issue.

A good pull request description explains the problem, the chosen approach,
how it was tested, and any known limitations. Include before-and-after
screenshots for visible UI changes.

Please keep unrelated refactors out of the same pull request. Small, focused
changes are easier to review and safer to release.

## Development setup

Requirements:

- Python 3.11 or newer
- Node.js 20 or newer
- Docker, only when testing the container build

Set up and run the backend:

```bash
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
ICEVUE_DEMO_MODE=true .venv/bin/uvicorn icevue.main:app --reload
```

In another terminal, set up and run the frontend:

```bash
cd frontend
npm install
npm run dev
```

The frontend is available at `http://localhost:5173` and proxies API requests
to the backend at `http://localhost:8000`.

## Running checks

Run the same core checks used by CI:

```bash
.venv/bin/ruff check .
.venv/bin/pytest -q
cd frontend
npm run build
```

For UI work, also run:

```bash
cd frontend
npm run verify:ui
```

Build the production container when changing dependencies, deployment files,
or the frontend build:

```bash
docker build -t icevue:dev .
```

## Backend contributions

- Keep Iceberg access in the catalog service layer.
- Expose stable response models instead of leaking PyIceberg objects directly.
- Preserve the read-only API boundary. Do not add create, update, delete,
  append, overwrite, commit, rollback, or maintenance operations for Iceberg
  resources.
- Translate provider-specific failures into useful, non-sensitive API errors.
- Consider generic REST Catalog behavior before adding provider-specific
  handling.
- Add tests for API contracts, error behavior, and configuration changes.

## Frontend contributions

- Reuse the existing components, spacing, colors, and interaction patterns.
- Keep tables and metadata views usable on desktop and mobile viewports.
- Provide loading, empty, error, and retry states where applicable.
- Use accessible labels and tooltips for icon-only controls.
- Do not expose or echo Catalog secrets in the browser.
- Verify long identifiers, paths, property values, and error messages do not
  overlap or break the layout.

## Documentation contributions

Documentation fixes are welcome and can be submitted without opening an issue
first. Keep examples free of real credentials and private infrastructure
details. When documenting a Catalog integration, include:

- REST endpoint format
- Warehouse value format
- Authentication method
- Required PyIceberg properties
- Minimum read permissions
- Known limitations

## Review expectations

Maintainers may ask for changes to keep the project secure, read-only,
portable, or consistent with its current architecture. Reviews should focus on
the code and the user problem, and contributors should treat questions and
alternative suggestions as part of collaborative design.

By submitting a contribution, you agree that it will be licensed under the
project's [MIT License](LICENSE).

