/**
 * iPad-sized pen test for the toilet-side grab rail and recessed niches.
 * Example geometry only.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const PORT = 4176;
const BASE = `http://127.0.0.1:${PORT}/site-sketch/`;
const shots = "/opt/cursor/artifacts/grab-niche/after";
mkdirSync(shots, { recursive: true });

const preview = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
  { stdio: "inherit" },
);

let browser;
try {
  await waitFor(BASE);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1194, height: 834 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    userAgent:
      "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "New sketch" }).click();
  await page.waitForSelector("#screen-editor:not([hidden]) canvas");
  await page.locator("#phase-proposed").click();

  await pen(page, await worldToClient(page, { x: -200, y: -150 }), await worldToClient(page, { x: 500, y: 300 }));
  await page.locator('[data-kind="room-depth"]').first().click();
  await page.locator("#dim-input").fill("2100");
  await page.locator("#dim-ok").click();
  await page.locator('[data-kind="room-width"]').first().click();
  await page.locator("#dim-input").fill("2400");
  await page.locator("#dim-ok").click();
  await page.getByRole("button", { name: "Fit" }).click();

  let plan = await readPlan(page);
  let box = metrics(plan);
  await page.locator('[data-tool="fixture"]').click();
  await page.waitForSelector("#palette:not([hidden])");
  await page.getByRole("button", { name: "Toilet", exact: true }).click();
  await pen(page, await worldToClient(page, { x: box.x + box.width - 500, y: box.y + 40 }));

  plan = await readPlan(page);
  box = metrics(plan);
  const toilet = plan.fixtures.find((item) => item.kind === "toilet");
  assert(toilet, "toilet missing");
  await page.getByRole("button", { name: "Grab", exact: true }).click();
  const grabAt = { x: box.x + box.width - 30, y: toilet.y + 180 };
  const from = await worldToClient(page, grabAt);
  const moved = await worldToClient(page, { x: grabAt.x, y: grabAt.y + 220 });
  await pointer(page, "pointerdown", from);
  await pointer(page, "pointermove", moved);
  await page.screenshot({ path: `${shots}/01-grab-dragging.png` });
  await pointer(page, "pointerup", moved);

  plan = await readPlan(page);
  const grab = plan.fixtures.find((item) => item.kind === "grab");
  assert(grab, "grab missing");
  assert(grab.width === 600 && grab.depth === 82 && grab.affl === 800, `grab size ${grab.width}×${grab.depth} affl ${grab.affl}`);
  assert(Math.abs(grab.x - (box.x + box.width)) < 2, `grab not on the toilet side wall (${grab.x})`);
  await page.locator('[data-tool="select"]').click();
  const dragFrom = await worldToClient(page, { x: grab.x - 20, y: grab.y });
  const dragTo = await worldToClient(page, { x: grab.x - 20, y: grab.y + 300 });
  await pointer(page, "pointerdown", dragFrom);
  await pointer(page, "pointermove", dragTo);
  const during = await readPlan(page);
  const moving = during.fixtures.find((item) => item.kind === "grab");
  assert(moving.width === 600 && moving.depth === 82, "grab changed size while dragging");
  await page.screenshot({ path: `${shots}/02-grab-beside-toilet.png` });
  await pointer(page, "pointerup", dragTo);

  plan = await readPlan(page);
  box = metrics(plan);
  await page.locator('[data-tool="fixture"]').click();
  await page.getByRole("button", { name: "Niche", exact: true }).click();
  const spots = [
    { name: "bottom", at: { x: box.x + 700, y: box.y + 25 }, axis: "y", room: box.y, far: box.y - 90 },
    { name: "right", at: { x: box.x + box.width - 25, y: box.y + box.depth * 0.55 }, axis: "x", room: box.x + box.width, far: box.x + box.width + 90 },
    { name: "top", at: { x: box.x + 900, y: box.y + box.depth - 25 }, axis: "y", room: box.y + box.depth, far: box.y + box.depth + 90 },
    { name: "left", at: { x: box.x + 25, y: box.y + box.depth * 0.4 }, axis: "x", room: box.x, far: box.x - 90 },
  ];
  for (const spot of spots) await pen(page, await worldToClient(page, spot.at));
  await page.screenshot({ path: `${shots}/03-niches.png` });
  plan = await readPlan(page);
  const niches = plan.fixtures.filter((item) => item.kind === "niche");
  assert(niches.length === 4, `expected 4 niches, got ${niches.length}`);
  for (const spot of spots) {
    const other = spot.axis === "y" ? "x" : "y";
    const niche = niches.find((item) => Math.abs(item[spot.axis] - spot.room) < 2 && Math.abs(item[other] - spot.at[other]) < 500);
    assert(niche, `niche missing on ${spot.name}`);
    assert(Math.abs(niche[spot.axis] - spot.room) < 2, `${spot.name} opening is not on the room face`);
    const span = extents(niche).map((point) => point[spot.axis]);
    const low = Math.min(...span);
    const high = Math.max(...span);
    assert(Math.abs(low - Math.min(spot.room, spot.far)) < 2, `${spot.name} leaves the cavity (${low})`);
    assert(Math.abs(high - Math.max(spot.room, spot.far)) < 2, `${spot.name} leaves the cavity (${high})`);
  }
  console.log("Grab rail and niche checks passed.");
} finally {
  await browser?.close();
  preview.kill("SIGTERM");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function extents(fixture) {
  const rad = (fixture.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const half = fixture.width / 2;
  return [
    [ -half, 0 ],
    [ half, 0 ],
    [ half, fixture.depth ],
    [ -half, fixture.depth ],
  ].map(([x, y]) => ({
    x: fixture.x + x * cos - y * sin,
    y: fixture.y + x * sin + y * cos,
  }));
}

function waitFor(url) {
  const deadline = Date.now() + 20000;
  return (async () => {
    while (Date.now() < deadline) {
      try {
        const response = await fetch(url);
        if (response.ok) return;
      } catch {
        // still booting
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`No response from ${url}`);
  })();
}

async function readPlan(page) {
  return page.evaluate(() => JSON.parse(document.querySelector("#plan-summary").dataset.plan));
}

function metrics(plan) {
  const room = plan.rooms[0];
  const byId = Object.fromEntries(plan.walls.map((wall) => [wall.id, wall]));
  const [bottom, right, top, left] = room.wallIds.map((id) => byId[id]);
  const x = left.a.x + left.thickness / 2;
  const y = bottom.a.y + bottom.thickness / 2;
  return {
    x,
    y,
    width: right.a.x - left.a.x - (left.thickness + right.thickness) / 2,
    depth: top.a.y - bottom.a.y - (top.thickness + bottom.thickness) / 2,
  };
}

async function worldToClient(page, world) {
  return page.evaluate((point) => {
    const stage = document.querySelector("#stage");
    const rect = stage.getBoundingClientRect();
    const px = Number(stage.dataset.pxPerMm);
    return {
      x: rect.left + (point.x - Number(stage.dataset.originX)) * px,
      y: rect.top + (Number(stage.dataset.originY) - point.y) * px,
    };
  }, world);
}

async function pen(page, from, to = from) {
  await pointer(page, "pointerdown", from);
  await pointer(page, "pointermove", to);
  await pointer(page, "pointerup", to);
}

async function pointer(page, type, at) {
  await page.evaluate(({ type, at }) => {
    document.querySelector("canvas").dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerType: "pen",
      pointerId: 4,
      clientX: at.x,
      clientY: at.y,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      pressure: 0.5,
      isPrimary: true,
    }));
  }, { type, at });
}
