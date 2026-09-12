import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CatalogSidebar } from "./CatalogSidebar";
import type { CatalogCollection, CatalogTree } from "../types";

const catalog: CatalogTree = {
  catalog: {
    id: "demo",
    name: "Demo Catalog",
    mode: "demo",
    connected: true,
    uri: null,
    message: null,
  },
  namespaces: [],
};

const catalogs: CatalogCollection = {
  default_catalog: "demo",
  config_path: "/etc/icevue.json",
  catalogs: [
    {
      id: "demo",
      name: "Demo Catalog",
      type: "demo",
      uri: null,
      warehouse: null,
      oauth2_server_uri: null,
      scope: null,
      prefix: null,
      properties: {},
      has_token: false,
      has_credential: false,
      is_default: true,
    },
  ],
};

function renderSidebar(
  theme: "light" | "dark" = "light",
  onThemeToggle = vi.fn(),
) {
  render(
    <CatalogSidebar
      catalog={catalog}
      catalogs={catalogs}
      activeCatalogId="demo"
      selected={null}
      open={false}
      refreshing={false}
      theme={theme}
      onSelect={vi.fn()}
      onClose={vi.fn()}
      onRefresh={vi.fn()}
      onCatalogChange={vi.fn()}
      onManageCatalogs={vi.fn()}
      onThemeToggle={onThemeToggle}
    />,
  );
  return { onThemeToggle };
}

describe("CatalogSidebar — theme toggle button", () => {
  it("shows the 'Switch to dark mode' button when theme is light", () => {
    renderSidebar("light");
    expect(screen.getByTitle("Switch to dark mode")).toBeInTheDocument();
  });

  it("does not show the 'Switch to light mode' button when theme is light", () => {
    renderSidebar("light");
    expect(screen.queryByTitle("Switch to light mode")).not.toBeInTheDocument();
  });

  it("shows the 'Switch to light mode' button when theme is dark", () => {
    renderSidebar("dark");
    expect(screen.getByTitle("Switch to light mode")).toBeInTheDocument();
  });

  it("does not show the 'Switch to dark mode' button when theme is dark", () => {
    renderSidebar("dark");
    expect(screen.queryByTitle("Switch to dark mode")).not.toBeInTheDocument();
  });

  it("calls onThemeToggle once when clicked in light mode", async () => {
    const user = userEvent.setup();
    const { onThemeToggle } = renderSidebar("light");
    await user.click(screen.getByTitle("Switch to dark mode"));
    expect(onThemeToggle).toHaveBeenCalledOnce();
  });

  it("calls onThemeToggle once when clicked in dark mode", async () => {
    const user = userEvent.setup();
    const { onThemeToggle } = renderSidebar("dark");
    await user.click(screen.getByTitle("Switch to light mode"));
    expect(onThemeToggle).toHaveBeenCalledOnce();
  });
});

describe("CatalogSidebar — namespace tree", () => {
  it("shows empty filter state when no namespaces exist", () => {
    renderSidebar();
    expect(screen.getByText("Namespaces")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("renders a namespace and its tables", () => {
    const catalogWithTables: CatalogTree = {
      ...catalog,
      namespaces: [
        {
          namespace: "production",
          display_name: "production",
          tables: [{ namespace: "production", name: "orders" }],
        },
      ],
    };
    render(
      <CatalogSidebar
        catalog={catalogWithTables}
        catalogs={catalogs}
        activeCatalogId="demo"
        selected={null}
        open={false}
        refreshing={false}
        theme="light"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onCatalogChange={vi.fn()}
        onManageCatalogs={vi.fn()}
        onThemeToggle={vi.fn()}
      />,
    );
    expect(screen.getByText("production")).toBeInTheDocument();
    expect(screen.getByText("orders")).toBeInTheDocument();
  });
});
