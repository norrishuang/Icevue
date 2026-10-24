import { chromium } from "playwright";

const baseUrl = process.env.ICEVUE_BASE_URL ?? "http://127.0.0.1:8000";
const screenshotDir = process.env.ICEVUE_SCREENSHOT_DIR;
const browser = await chromium.launch({ headless: true });
const errors = [];
let createdCatalog = false;

const HOUR = 3_600_000;
const BASE_MS = Date.UTC(2026, 6, 1, 8, 0, 0);

function snapshot(id, offsetMs, totals, { current = false, operation = "append" } = {}) {
  const timestamp_ms = offsetMs === null ? null : BASE_MS + offsetMs;
  const summary = {};
  if (totals.records !== undefined) summary["total-records"] = totals.records;
  if (totals.files !== undefined) summary["total-data-files"] = totals.files;
  // Added counters must never be used to infer totals.
  summary["added-records"] = "999999";
  summary["added-data-files"] = "999";
  return {
    snapshot_id: id,
    parent_snapshot_id: null,
    sequence_number: null,
    timestamp_ms,
    timestamp: timestamp_ms === null ? "" : new Date(timestamp_ms).toISOString(),
    operation,
    manifest_list: null,
    summary,
    current,
  };
}

// Chronological records: 100, 150, invalid, 250, 300, negative, 400.
// Served newest-first with irregular spacing to verify the chart sorts a copy.
const unorderedChronological = [
  snapshot(7100000000000001, 0, { records: "100", files: "1" }),
  snapshot(7100000000000002, 1 * HOUR, { records: "150", files: "2" }, { operation: "overwrite" }),
  snapshot(7100000000000003, 1 * HOUR + 300_000, { records: "not-a-number", files: "3" }),
  snapshot(7100000000000004, 72 * HOUR, { records: "250", files: "4" }, { operation: "delete" }),
  snapshot(7100000000000005, 73 * HOUR, { records: "300", files: "5" }),
  snapshot(7100000000000006, 120 * HOUR, { records: "-5", files: "6" }),
  snapshot(7100000000000007, 240 * HOUR, { records: "400", files: "7" }, { current: true }),
];

const fixtureTables = {
  unordered: [
    unorderedChronological[3],
    unorderedChronological[6],
    unorderedChronological[0],
    unorderedChronological[5],
    unorderedChronological[2],
    unorderedChronological[4],
    unorderedChronological[1],
  ],
  single: [snapshot(7200000000000001, 0, { records: "42", files: "3" }, { current: true })],
  zeros: [
    snapshot(7300000000000001, 0, { records: "0", files: "5" }),
    snapshot(7300000000000002, 2 * HOUR, { records: "0", files: "5" }),
    snapshot(7300000000000003, 30 * HOUR, { records: "0", files: "5" }, { current: true }),
  ],
  missing: [
    snapshot(7400000000000001, 0, {}),
    snapshot(7400000000000002, HOUR, { records: "-1", files: "" }, { current: true }),
  ],
  equal: [
    snapshot(7500000000000001, 0, { records: "10", files: "1" }),
    snapshot(7500000000000002, 0, { records: "20", files: "2" }),
    snapshot(7500000000000003, 0, { records: "30", files: "3" }, { current: true }),
    snapshot(7500000000000004, null, { records: "40", files: "4" }),
  ],
  empty: [],
};

function fixtureTable(name, snapshots) {
  return {
    namespace: "fixtures",
    name,
    identifier: `fixtures.${name}`,
    location: `s3://fixtures/${name}`,
    format_version: 2,
    metadata_location: null,
    last_updated_ms: BASE_MS,
    last_updated: new Date(BASE_MS).toISOString(),
    current_snapshot_id: snapshots.find((item) => item.current)?.snapshot_id ?? null,
    current_schema_id: 0,
    default_spec_id: 0,
    default_sort_order_id: 0,
    schemas: [{ schema_id: 0, current: true, fields: [] }],
    partition_specs: [{ spec_id: 0, current: true, fields: [] }],
    sort_orders: [{ order_id: 0, current: true, fields: [] }],
    snapshots,
    properties: {},
    refs: {},
  };
}

async function mockFixtureCatalog(page) {
  await page.route(
    (url) => url.pathname === "/api/v1/catalog",
    (route) =>
      route.fulfill({
        json: {
          catalog: {
            id: "demo",
            name: "Fixtures",
            mode: "demo",
            connected: true,
            uri: null,
            message: null,
          },
          namespaces: [
            {
              namespace: "fixtures",
              display_name: "fixtures",
              tables: Object.keys(fixtureTables).map((name) => ({ namespace: "fixtures", name })),
            },
          ],
        },
      }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/table",
    (route) => {
      const name = new URL(route.request().url()).searchParams.get("name");
      return route.fulfill({ json: fixtureTable(name, fixtureTables[name]) });
    },
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function openFixture(page, name, { mobile = false } = {}) {
  if (mobile) {
    await page.getByTitle("Open catalog").first().click();
    await page.getByRole("navigation", { name: "Catalog tables" }).waitFor();
  }
  await page.getByRole("button", { name: new RegExp(`^${name}`) }).first().click();
  await page.getByRole("heading", { name, exact: true }).waitFor();
  await page.getByRole("button", { name: /^Snapshots/ }).click();
}

async function chartState(page, metric) {
  return page.locator(`.trend-card[data-metric="${metric}"]`).evaluate((card) => {
    const svg = card.querySelector("svg");
    const plot = card.querySelector(".trend-card__plot");
    return {
      path: card.querySelector(".trend-line")?.getAttribute("d") ?? null,
      points: [...card.querySelectorAll(".trend-point")].map((circle) => ({
        x: Number(circle.getAttribute("cx")),
        y: Number(circle.getAttribute("cy")),
        current: circle.classList.contains("trend-point--current"),
      })),
      unknown: card.querySelectorAll(".trend-unknown").length,
      xLabels: [...card.querySelectorAll(".trend-axis--x")].map((label) => label.textContent),
      yLabels: [...card.querySelectorAll("g.trend-axis text")].map((label) => label.textContent),
      empty: card.querySelector(".trend-card__empty")?.textContent ?? null,
      svgWidth: svg ? Number(svg.getAttribute("width")) : null,
      plotWidth: plot?.clientWidth ?? null,
      cardOverflow: card.scrollWidth - card.clientWidth,
      rect: card.getBoundingClientRect().toJSON(),
    };
  });
}

function pathCommands(path) {
  return { moves: (path.match(/M/g) ?? []).length, lines: (path.match(/L/g) ?? []).length };
}

async function detailText(page, metric) {
  return page.locator(`.trend-card[data-metric="${metric}"] .trend-card__detail`).innerText();
}

async function assertNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => {
    const view = document.querySelector(".view");
    return {
      document: document.documentElement.scrollWidth - window.innerWidth,
      view: view ? view.scrollWidth - view.clientWidth : 0,
    };
  });
  assert(overflow.document <= 0 && overflow.view <= 0, `${label}: horizontal overflow ${JSON.stringify(overflow)}`);
}

async function verifySnapshotCharts(page, { mobile }) {
  const label = mobile ? "mobile" : "desktop";

  await openFixture(page, "unordered", { mobile });
  const history = await page.locator(".snapshot__id code").allInnerTexts();
  assert(
    history.join() === fixtureTables.unordered.map((item) => String(item.snapshot_id)).join(),
    `${label}: snapshot history order changed: ${history}`,
  );
  const records = await chartState(page, "records");
  const files = await chartState(page, "data files");
  assert(records.points.length === 5, `${label}: expected 5 known record points, got ${records.points.length}`);
  assert(records.unknown === 2, `${label}: expected 2 unknown record markers, got ${records.unknown}`);
  const recordPath = pathCommands(records.path);
  assert(recordPath.moves === 3 && recordPath.lines === 2, `${label}: unexpected record gaps ${records.path}`);
  const bottom = Math.max(...records.points.map((point) => point.y));
  assert(records.points.filter((point) => point.y === bottom).length === 1, `${label}: unknown value drawn at zero`);
  assert(files.points.length === 7 && pathCommands(files.path).moves === 1, `${label}: files series broken`);
  for (let index = 1; index < files.points.length; index += 1) {
    assert(files.points[index].x > files.points[index - 1].x, `${label}: points not chronological`);
    assert(files.points[index].y < files.points[index - 1].y, `${label}: increasing totals not rising`);
  }
  // Irregular timestamps: one hour gap must be much narrower than the seven-day gap.
  assert(
    files.points[1].x - files.points[0].x < (files.points[6].x - files.points[5].x) / 10,
    `${label}: x-axis is not time-scaled`,
  );
  assert(files.points[6].current && !files.points[0].current, `${label}: current marker missing`);
  assert(records.yLabels.includes("0") && records.yLabels.length >= 3, `${label}: y-axis ${records.yLabels}`);
  assert(records.xLabels.length >= 2 && records.xLabels.every(Boolean), `${label}: x-axis ${records.xLabels}`);
  assert(records.svgWidth <= records.plotWidth && records.cardOverflow <= 0, `${label}: chart overflows card`);
  const note = await page.locator(".snapshot-trends__note").innerText();
  assert(/branches/.test(note) && /delete files/.test(note), `${label}: semantics note missing`);

  if (mobile) {
    assert(files.rect.top >= records.rect.bottom, `${label}: chart cards should stack`);
    const first = records.points[0];
    await page.locator('.trend-card[data-metric="records"] svg').tap({ position: { x: first.x, y: first.y } });
    const tapped = await detailText(page, "records");
    assert(/7100000000000001/.test(tapped) && /^100\b/.test(tapped), `${label}: tap detail ${tapped}`);
  } else {
    assert(Math.abs(files.rect.top - records.rect.top) < 1, `${label}: chart cards should be side by side`);
    const plot = page.locator('.trend-card[data-metric="records"] svg');
    const box = await plot.boundingBox();
    const last = records.points[4];
    await page.mouse.move(box.x + last.x, box.y + last.y);
    const hovered = await detailText(page, "records");
    assert(/^400/.test(hovered) && /Current/i.test(hovered) && /7100000000000007/.test(hovered), `${label}: hover ${hovered}`);
    await page.mouse.move(box.x + box.width / 2, box.y - 40);
  }

  const recordsPlot = page.getByRole("group", { name: /^Total records by snapshot time, 7 snapshots/ });
  await recordsPlot.evaluate((element) => element.blur());
  await recordsPlot.focus();
  let detail = await detailText(page, "records");
  assert(/7 of 7/.test(detail) && /Current/i.test(detail) && /400/.test(detail), `${label}: focus detail ${detail}`);
  await page.keyboard.press("Home");
  detail = await detailText(page, "records");
  assert(/1 of 7/.test(detail) && /^100/.test(detail) && /Jul 01, 2026/.test(detail), `${label}: Home ${detail}`);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  detail = await detailText(page, "records");
  assert(/3 of 7/.test(detail) && /^Unknown/.test(detail) && /7100000000000003/.test(detail), `${label}: gap detail ${detail}`);
  await page.keyboard.press("ArrowRight");
  detail = await detailText(page, "records");
  assert(/^250/.test(detail) && /delete/i.test(detail), `${label}: 250 detail ${detail}`);
  await page.keyboard.press("End");
  assert(/7 of 7/.test(await detailText(page, "records")), `${label}: End key`);
  await page.keyboard.press("Escape");
  assert(/arrow keys/.test(await detailText(page, "records")), `${label}: Escape key`);
  await assertNoHorizontalOverflow(page, label);

  await openFixture(page, "single", { mobile });
  const single = await chartState(page, "records");
  assert(single.points.length === 1 && pathCommands(single.path).lines === 0, `${label}: single point ${single.path}`);
  assert(single.xLabels.length === 1, `${label}: single point x-axis ${single.xLabels}`);
  assert(single.yLabels.join() === "0,20,40,60", `${label}: single y-axis ${single.yLabels}`);

  await openFixture(page, "zeros", { mobile });
  const zeros = await chartState(page, "records");
  const constant = await chartState(page, "data files");
  const baseline = 152; // Chart top margin plus plot height.
  assert(zeros.points.length === 3 && zeros.points.every((p) => p.y === baseline), `${label}: zero line`);
  assert(zeros.yLabels.join() === "0,1", `${label}: zero y-axis ${zeros.yLabels}`);
  assert(new Set(constant.points.map((p) => p.y)).size === 1, `${label}: constant line`);
  assert(constant.points[0].y < baseline && constant.yLabels.length >= 3, `${label}: constant y-axis ${constant.yLabels}`);
  await page.getByRole("group", { name: /^Total records/ }).focus();
  assert(/^0\b/.test(await detailText(page, "records")), `${label}: zero detail`);

  await openFixture(page, "missing", { mobile });
  const missing = await chartState(page, "records");
  assert(missing.empty?.includes("total records") && missing.path === null, `${label}: all-missing records`);
  assert((await chartState(page, "data files")).empty?.includes("total data files"), `${label}: all-missing files`);
  assert((await page.locator(".snapshot").count()) === 2, `${label}: history hidden for missing totals`);

  await openFixture(page, "equal", { mobile });
  const equal = await chartState(page, "records");
  assert(equal.points.length === 3 && new Set(equal.points.map((p) => p.x)).size === 1, `${label}: equal timestamps`);
  assert(/1 snapshot without a valid timestamp is not plotted/.test(await page.locator(".snapshot-trends__note").innerText()),
    `${label}: untimed note`);
  await page.getByRole("group", { name: /^Total records by snapshot time, 3 snapshots/ }).focus();
  const seen = [];
  await page.keyboard.press("Home");
  for (let index = 0; index < 3; index += 1) {
    seen.push((await detailText(page, "records")).match(/75000000000000\d\d/)?.[0]);
    await page.keyboard.press("ArrowRight");
  }
  assert(new Set(seen).size === 3, `${label}: equal timestamps not individually reachable ${seen}`);
  await assertNoHorizontalOverflow(page, `${label} equal`);

  await openFixture(page, "empty", { mobile });
  await page.getByText("No snapshots", { exact: true }).waitFor();
  assert((await page.locator(".snapshot-trends").count()) === 0, `${label}: charts shown without snapshots`);
}

try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  desktop.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  desktop.on("pageerror", (error) => errors.push(error.message));

  await desktop.goto(baseUrl, { waitUntil: "networkidle" });
  await desktop.getByRole("heading", { name: "events" }).waitFor();
  const logoLoaded = await desktop.locator(".brand-logo").evaluate(
    (image) => image.complete && image.naturalWidth > 0,
  );
  if (!logoLoaded) throw new Error("Icevue logo failed to load");
  if (screenshotDir) {
    await desktop.screenshot({
      path: `${screenshotDir}/screenshot.png`,
      fullPage: false,
    });
  }

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
    ["Snapshots", "57 → 8"],
    ["Properties", "write.parquet.compression-codec"],
    ["Overview", "Table identity"],
  ];
  for (const [tab, content] of expectedViews) {
    await desktop.getByRole("button", { name: new RegExp(`^${tab}`) }).click();
    await desktop.getByText(content, { exact: false }).first().waitFor();
    if (tab === "Snapshots") {
      const cards = await desktop.locator(".trend-card").count();
      if (cards !== 2) throw new Error(`Expected 2 snapshot trend cards, found ${cards}`);
    }
  }

  await desktop.getByTitle("Catalog settings").click();
  await desktop.getByRole("button", { name: /E2E Demo/ }).click();
  desktop.once("dialog", (dialog) => dialog.accept());
  await desktop.getByTitle("Delete catalog").click();
  await desktop.locator('option[value="e2e-demo"]').waitFor({ state: "detached" });
  await desktop.getByTitle("Close settings").click();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(baseUrl, { waitUntil: "networkidle" });
  await mobile.getByRole("heading", { name: "events" }).waitFor();
  await mobile.getByTitle("Open catalog").first().click();
  await mobile.getByRole("navigation", { name: "Catalog tables" }).waitFor();
  await mobile.getByRole("button", { name: /orders/ }).first().click();
  await mobile.getByRole("heading", { name: "orders" }).waitFor();

  for (const [viewport, mobile] of [
    [{ width: 1440, height: 900 }, false],
    [{ width: 390, height: 844 }, true],
  ]) {
    const context = await browser.newContext({ viewport, timezoneId: "UTC", hasTouch: mobile });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await mockFixtureCatalog(page);
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "unordered", exact: true }).waitFor();
    await verifySnapshotCharts(page, { mobile });
    await context.close();
  }

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
