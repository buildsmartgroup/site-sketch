/**
 * Drive the production build at /site-sketch/ in an iPad-sized browser.
 * Pen pointer events draw; touch pointer events must not. Confirms dimensions,
 * typed edits, IndexedDB across reload, and offline load via the service worker.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:4173/site-sketch/";
const shots = "/opt/cursor/artifacts/screenshots";
mkdirSync(shots, { recursive: true });

const preview = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "4173", "--strictPort"], {
  stdio: "inherit",
});

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

  const metas = await page.evaluate(() => ({
    capable: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.getAttribute("content"),
    title: document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute("content"),
    viewport: document.querySelector('meta[name="viewport"]')?.getAttribute("content"),
  }));
  assert(metas.capable === "yes", `apple-mobile-web-app-capable missing (${metas.capable})`);
  assert(metas.title === "Site Sketch", "apple title missing");
  assert(metas.viewport?.includes("viewport-fit=cover"), "viewport-fit missing");

  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]')?.href;
    if (!href) return null;
    const response = await fetch(href);
    return response.json();
  });
  assert(manifest, "manifest link missing");
  assert(String(manifest.start_url).includes("/site-sketch/"), `start_url ${manifest.start_url}`);
  assert(String(manifest.scope).includes("/site-sketch/"), `scope ${manifest.scope}`);

  await page.screenshot({ path: `${shots}/01-sketch-list.png` });
  await page.getByRole("button", { name: "New sketch" }).click();
  await page.waitForSelector("#screen-editor:not([hidden]) canvas");
  await page.waitForFunction(() => document.querySelector("#snap-readout")?.textContent?.includes("10"));
  await page.screenshot({ path: `${shots}/02-empty-editor.png` });

  const start = await worldToClient(page, { x: -280, y: -160 });
  const end = await worldToClient(page, { x: 280, y: 160 });
  await pen(page, start, end, { up: false });
  await page.waitForFunction(() => {
    const text = document.querySelector("#live-readout")?.textContent ?? "";
    return text.includes("560") && text.includes("320");
  });
  await pen(page, start, end, { down: false });
  await page.waitForFunction(() => document.querySelector("#plan-summary")?.textContent?.includes("560 by 320"));

  await page.locator('[data-kind="room-width"]').first().click();
  await page.waitForSelector("#dim-layer:not([hidden])");
  await page.screenshot({ path: `${shots}/03-dimension-editor.png` });
  await page.locator("#dim-input").fill("1400");
  await page.locator("#dim-ok").click();
  await page.waitForFunction(() => document.querySelector("#plan-summary")?.textContent?.includes("1400 by 320"));
  let plan = await readPlan(page);
  let size = interior(plan);
  assert(Math.round(size.width) === 1400, `width ${size.width}`);
  assert(Math.round(size.depth) === 320, `depth ${size.depth}`);
  assert(Math.round(size.thickness) === 90, `room thickness ${size.thickness}`);

  const wallA = await worldToClient(page, { x: -280, y: -520 });
  const wallB = await worldToClient(page, { x: 170, y: -520 });
  await page.locator('[data-tool="wall"]').click();
  await pen(page, wallA, wallB);
  await page.waitForFunction(() => document.querySelector("#plan-summary")?.textContent?.includes("length 450"));
  await page.getByRole("button", { name: "Fit" }).click();
  await page.locator('[data-kind="wall"]').click();
  await page.locator("#dim-input").fill("700");
  await page.locator("#dim-ok").click();
  await page.locator('[data-thickness="110"]').click();
  await page.waitForFunction(() => {
    const text = document.querySelector("#plan-summary")?.textContent ?? "";
    return text.includes("length 700") && text.includes("thickness 110");
  });
  plan = await readPlan(page);
  const wall = freeWalls(plan)[0];
  assert(wall, "free wall missing");
  assert(Math.round(Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y)) === 700, "wall length");
  assert(wall.thickness === 110, "wall thickness");
  assert(Math.abs(wall.a.y - wall.b.y) < 0.01, "wall should stay horizontal");
  size = interior(plan);
  assert(Math.round(size.width) === 1400 && Math.round(size.depth) === 320, "room changed while editing the wall");

  await page.getByRole("button", { name: "Fit" }).click();
  await waitSaved(page);
  await page.screenshot({ path: `${shots}/04-room-and-wall.png` });

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("#plan-summary")?.textContent?.includes("1400 by 320"));
  plan = await readPlan(page);
  assert(Math.round(interior(plan).width) === 1400, "width lost on reload");
  assert(freeWalls(plan)[0].thickness === 110, "wall lost on reload");
  await page.screenshot({ path: `${shots}/05-after-reload.png` });

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  if (!controlled) {
    await page.reload({ waitUntil: "networkidle" });
    await page.evaluate(async () => navigator.serviceWorker.ready);
  }
  assert(await page.evaluate(() => !!navigator.serviceWorker.controller), "service worker is not controlling the page");
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const urls = [];
    for (const key of keys) {
      const cache = await caches.open(key);
      for (const request of await cache.keys()) urls.push(request.url);
    }
    return urls;
  });
  assert(cached.some((url) => url.includes("/site-sketch/") && url.endsWith(".js")), `no precached script: ${cached.join(" ")}`);
  assert(cached.some((url) => url.includes("index.html")), "index.html was not precached");

  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#project-name");
  await page.waitForFunction(() => (document.querySelector("#plan-summary")?.textContent ?? "").includes("1400 by 320"));
  await page.screenshot({ path: `${shots}/06-offline.png` });

  await page.locator('[data-kind="room-depth"]').first().click();
  await page.locator("#dim-input").fill("480");
  await page.locator("#dim-ok").click();
  await waitSaved(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (document.querySelector("#plan-summary")?.textContent ?? "").includes("1400 by 480"));
  plan = await readPlan(page);
  assert(Math.round(interior(plan).depth) === 480, "offline edit did not persist");

  const before = await page.evaluate(() => ({
    walls: JSON.parse(document.querySelector("#plan-summary").dataset.plan).walls.length,
    originX: Number(document.querySelector("#stage").dataset.originX),
  }));
  const panFrom = await worldToClient(page, { x: 0, y: 0 });
  await touchPan(page, panFrom, { x: panFrom.x + 80, y: panFrom.y + 30 });
  const after = await page.evaluate(() => ({
    walls: JSON.parse(document.querySelector("#plan-summary").dataset.plan).walls.length,
    originX: Number(document.querySelector("#stage").dataset.originX),
  }));
  assert(after.walls === before.walls, "a finger created geometry");
  assert(Math.abs(after.originX - before.originX) > 1, "a finger did not pan");

  await page.getByRole("button", { name: "Sketches" }).click();
  await page.getByRole("button", { name: "Rename" }).click();
  await page.locator('.rename-row input').fill("Ensuite");
  await page.locator('.rename-row button[type="submit"]').click();
  await page.waitForFunction(() => document.body.textContent?.includes("Ensuite"));
  await page.screenshot({ path: `${shots}/07-renamed-list.png` });

  console.log("M1 browser checks passed.");
  console.log(`Screenshots in ${shots}`);
} finally {
  await browser?.close();
  preview.kill("SIGTERM");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitFor(url) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Preview is still booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No response from ${url}`);
}

async function waitSaved(page) {
  await page.waitForFunction(() => document.querySelector("#save-state")?.textContent === "Saved");
}

async function readPlan(page) {
  return page.evaluate(() => JSON.parse(document.querySelector("#plan-summary").dataset.plan));
}

function interior(plan) {
  const room = plan.rooms[0];
  const byId = Object.fromEntries(plan.walls.map((wall) => [wall.id, wall]));
  const [bottom, right, top, left] = room.wallIds.map((id) => byId[id]);
  return {
    width: right.a.x - left.a.x - (left.thickness + right.thickness) / 2,
    depth: top.a.y - bottom.a.y - (top.thickness + bottom.thickness) / 2,
    thickness: left.thickness,
  };
}

function freeWalls(plan) {
  const used = new Set(plan.rooms.flatMap((room) => room.wallIds));
  return plan.walls.filter((wall) => !used.has(wall.id));
}

async function worldToClient(page, world) {
  return page.evaluate((point) => {
    const stage = document.querySelector("#stage");
    const rect = stage.getBoundingClientRect();
    const px = Number(stage.dataset.pxPerMm);
    const originX = Number(stage.dataset.originX);
    const originY = Number(stage.dataset.originY);
    return {
      x: rect.left + (point.x - originX) * px,
      y: rect.top + (originY - point.y) * px,
    };
  }, world);
}

async function pen(page, from, to, options = {}) {
  const down = options.down !== false;
  const up = options.up !== false;
  await page.evaluate(
    ({ from, to, down, up }) => {
      const canvas = document.querySelector("canvas");
      const fire = (type, x, y, buttons) => {
        canvas.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerType: "pen",
            pointerId: 3,
            clientX: x,
            clientY: y,
            button: 0,
            buttons,
            pressure: 0.5,
            isPrimary: true,
          }),
        );
      };
      if (down) fire("pointerdown", from.x, from.y, 1);
      const steps = 8;
      for (let i = 1; i <= steps; i += 1) {
        fire("pointermove", from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps, 1);
      }
      if (up) fire("pointerup", to.x, to.y, 0);
    },
    { from, to, down, up },
  );
}

async function touchPan(page, from, to) {
  await page.evaluate(
    ({ from, to }) => {
      const canvas = document.querySelector("canvas");
      const fire = (type, x, y, buttons) => {
        canvas.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerType: "touch",
            pointerId: 11,
            clientX: x,
            clientY: y,
            button: 0,
            buttons,
            isPrimary: true,
          }),
        );
      };
      fire("pointerdown", from.x, from.y, 1);
      fire("pointermove", to.x, to.y, 1);
      fire("pointerup", to.x, to.y, 0);
    },
    { from, to },
  );
}
