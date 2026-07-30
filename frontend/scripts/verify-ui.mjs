import { chromium } from "playwright";

const baseUrl = process.env.ICEVUE_BASE_URL ?? "http://127.0.0.1:8000";
const screenshotDir = process.env.ICEVUE_SCREENSHOT_DIR;
const browser = await chromium.launch({ headless: true });
const errors = [];
let createdCatalog = false;

try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  desktop.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  desktop.on("pageerror", (error) => errors.push(error.message));

  await desktop.goto(baseUrl, { waitUntil: "networkidle" });
  await desktop.getByRole("heading", { name: "events" }).waitFor();

  await desktop.getByTitle("Catalog settings").click();
  await desktop.getByRole("dialog", { name: "Catalog connections" }).waitFor();
  await desktop.getByTitle("Add catalog").click();
  await desktop.getByLabel("Catalog ID").fill("e2e-demo");
  await desktop.getByLabel("Display name").fill("E2E Demo");
  await desktop.getByRole("button", { name: "Demo", exact: true }).click();
  await desktop.getByRole("button", { name: "Test connection" }).click();
  await desktop.getByText("Connected to E2E Demo").waitFor();
  await desktop.getByRole("button", { name: "Save" }).click();
  createdCatalog = true;
  await desktop.getByText("Catalog configuration saved.").waitFor();
  if (screenshotDir) {
    await desktop.screenshot({
      path: `${screenshotDir}/catalog-settings.png`,
      fullPage: false,
    });
  }
  await desktop.getByTitle("Close settings").click();
  await desktop.getByLabel("Select catalog").selectOption("e2e-demo");
  await desktop.getByRole("heading", { name: "events" }).waitFor();
  await desktop.getByLabel("Select catalog").selectOption("demo");
  await desktop.getByRole("heading", { name: "events" }).waitFor();

  const expectedViews = [
    ["Schema", "event_id"],
    ["Partitions", "90 partitions"],
    ["Snapshots", "Current"],
    ["Properties", "write.parquet.compression-codec"],
    ["Overview", "Table identity"],
  ];
  for (const [tab, content] of expectedViews) {
    await desktop.getByRole("button", { name: new RegExp(`^${tab}`) }).click();
    await desktop.getByText(content, { exact: false }).first().waitFor();
  }

  await desktop.getByTitle("Catalog settings").click();
  await desktop.getByRole("button", { name: /E2E Demo/ }).click();
  desktop.once("dialog", (dialog) => dialog.accept());
  await desktop.getByTitle("Delete catalog").click();
  await desktop.locator('option[value="e2e-demo"]').waitFor({ state: "detached" });
  await desktop.getByTitle("Close settings").click();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(baseUrl, { waitUntil: "networkidle" });
  await mobile.getByTitle("Open catalog").first().click();
  await mobile.getByRole("navigation", { name: "Catalog tables" }).waitFor();
  await mobile.getByRole("button", { name: /orders/ }).first().click();
  await mobile.getByRole("heading", { name: "orders" }).waitFor();

  if (errors.length) {
    throw new Error(`Browser console errors:\n${errors.join("\n")}`);
  }
  console.log("UI verification passed for desktop and mobile viewports.");
} finally {
  if (createdCatalog) {
    await fetch(`${baseUrl}/api/v1/catalogs/e2e-demo`, { method: "DELETE" }).catch(() => {});
  }
  await browser.close();
}
