/**
 * Drive the production build at /site-sketch/ on an iPad-sized screen.
 * Draws an example bathroom with pen and touch events, exports PDF and JSON,
 * and checks the two sheets. Uses placeholder job details only.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const PORT = 4174;
const BASE = `http://127.0.0.1:${PORT}/site-sketch/`;
const shots = "/opt/cursor/artifacts/m2";
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
    acceptDownloads: true,
    userAgent:
      "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "New sketch" }).click();
  await page.waitForSelector("#screen-editor:not([hidden]) canvas");
  await page.screenshot({ path: `${shots}/01-empty.png` });

  const start = await worldToClient(page, { x: -200, y: -150 });
  const end = await worldToClient(page, { x: 400, y: 250 });
  await pen(page, start, end);
  await page.locator('[data-kind="room-depth"]').first().click();
  await page.locator("#dim-input").fill("2100");
  await page.locator("#dim-ok").click();
  await page.locator('[data-kind="room-width"]').first().click();
  await page.locator("#dim-input").fill("2400");
  await page.locator("#dim-ok").click();
  await page.getByRole("button", { name: "Fit" }).click();
  await page.waitForFunction(() => (document.querySelector("#plan-summary")?.textContent ?? "").includes("2400 by 2100"));

  let plan = await readPlan(page);
  let box = metrics(plan);
  await page.locator('[data-tool="select"]').click();
  await pen(page, await worldToClient(page, { x: box.x + box.width / 2, y: box.y + box.depth / 2 }), await worldToClient(page, { x: box.x + box.width / 2, y: box.y + box.depth / 2 }));
  await page.getByRole("button", { name: "Name" }).click();
  await page.locator('#form-fields input[name="name"]').fill("Bathroom");
  await page.locator('#form-fields input[name="ceiling"]').fill("2400");
  await page.locator("#form-ok").click();
  await page.waitForFunction(() => (document.querySelector("#plan-summary")?.textContent ?? "").includes("BATHROOM"));

  plan = await readPlan(page);
  box = metrics(plan);
  const bottomMid = midpoint(box.bottom);
  await page.locator('[data-tool="door"]').click();
  await pen(page, await worldToClient(page, bottomMid), await worldToClient(page, bottomMid));
  await page.waitForFunction(() => JSON.parse(document.querySelector("#plan-summary").dataset.plan).openings.length === 1);

  const leftFace = { x: box.x + 50, y: box.y + box.depth * 0.65 };
  await page.locator('[data-tool="fixture"]').click();
  await page.waitForSelector("#palette:not([hidden])");
  await page.getByRole("button", { name: "Toilet", exact: true }).click();
  await pen(page, await worldToClient(page, leftFace), await worldToClient(page, leftFace));
  const basinAt = { x: box.x + box.width - 450, y: box.y + 50 };
  await page.getByRole("button", { name: "Basin", exact: true }).click();
  await pen(page, await worldToClient(page, basinAt), await worldToClient(page, basinAt));
  await page.waitForFunction(() => JSON.parse(document.querySelector("#plan-summary").dataset.plan).fixtures.length === 2);

  plan = await readPlan(page);
  box = metrics(plan);
  const topTap = towardCenter(midpoint(box.top), box, 25);
  await page.locator('[data-tool="select"]').click();
  await pen(page, await worldToClient(page, topTap), await worldToClient(page, topTap));
  await page.locator("#remove-toggle").click();
  plan = await readPlan(page);
  const top = plan.walls.find((wall) => wall.id === plan.rooms[0].wallIds[2]);
  assert(top.removal === "remove", "top wall was not marked for removal");

  const toilet = plan.fixtures.find((fixture) => fixture.kind === "toilet");
  assert(toilet, "toilet missing");
  const toiletTap = towardCenter(toilet, box, 120);
  await pen(page, await worldToClient(page, toiletTap), await worldToClient(page, toiletTap));
  await page.locator("#remove-toggle").click();
  plan = await readPlan(page);
  assert(plan.fixtures.find((fixture) => fixture.kind === "toilet").removal === "remove", "toilet was not marked for removal");
  await page.screenshot({ path: `${shots}/02-existing.png` });

  await page.locator("#phase-proposed").click();
  await page.waitForFunction(() => document.querySelector("#stage").dataset.sheet === "proposed");
  plan = await readPlan(page);
  box = metrics(plan);
  const rightMid = midpoint(box.right);
  await page.locator('[data-tool="cavity"]').click();
  await pen(page, await worldToClient(page, rightMid), await worldToClient(page, rightMid));
  const showerAt = { x: box.x + box.width * 0.62, y: box.y + box.depth * 0.62 };
  await page.locator('[data-tool="fixture"]').click();
  await page.waitForSelector("#palette:not([hidden])");
  await page.getByRole("button", { name: "Shower", exact: true }).click();
  await pen(page, await worldToClient(page, showerAt), await worldToClient(page, showerAt));
  const grabAt = { x: box.x + box.width - 40, y: box.y + box.depth * 0.35 };
  await page.getByRole("button", { name: "Grab", exact: true }).click();
  await pen(page, await worldToClient(page, grabAt), await worldToClient(page, grabAt));

  await page.locator('[data-tool="callout"]').click();
  await pen(page, await worldToClient(page, showerAt), await worldToClient(page, { x: showerAt.x + 700, y: showerAt.y + 400 }));
  await page.waitForSelector("#form-layer:not([hidden])");
  await page.locator("#form-fields textarea").fill("New hobless shower");
  await page.locator("#form-ok").click();

  await page.locator("#job").click();
  await page.locator('#form-fields input[name="project"]').fill("Example bathroom");
  await page.locator('#form-fields input[name="client"]').fill("Example Client");
  await page.locator('#form-fields textarea[name="address"]').fill("1 Sample Street");
  await page.locator('#form-fields input[name="drawnBy"]').fill("Sam");
  await page.locator('#form-fields input[name="date"]').fill("2026-11-26");
  await page.locator('#form-fields input[name="revision"]').fill("A");
  await page.locator("#form-ok").click();
  await page.getByRole("button", { name: "Fit" }).click();
  await page.screenshot({ path: `${shots}/03-proposed.png` });

  const jsonDownload = page.waitForEvent("download");
  await page.locator("#export-json").click();
  const jsonFile = await jsonDownload;
  const jsonPath = `${shots}/example-bathroom.json`;
  await jsonFile.saveAs(jsonPath);
  const exported = JSON.parse(readFileSync(jsonPath, "utf8"));
  assert(exported.version === 2 && exported.units === "mm", "JSON is not a version 2 millimetre plan");
  assert(exported.walls.some((wall) => wall.removal === "remove" && wall.origin === "existing"), "JSON missing a removed wall");
  assert(exported.openings.some((opening) => opening.kind === "hinged" && opening.head === 2040), "JSON missing the hinged door head");
  assert(exported.openings.some((opening) => opening.kind === "cavity" && opening.origin === "new" && opening.pocket > 0), "JSON missing the new cavity slider");
  assert(exported.fixtures.some((fixture) => fixture.kind === "toilet" && fixture.affl === 460 && fixture.removal === "remove"), "JSON missing toilet height");
  assert(exported.fixtures.some((fixture) => fixture.kind === "basin" && fixture.width === 720 && fixture.affl === 850), "JSON missing the 720 basin");
  assert(exported.fixtures.some((fixture) => fixture.kind === "shower" && fixture.origin === "new" && fixture.width === 1200), "JSON missing the new shower");
  assert(exported.fixtures.some((fixture) => fixture.kind === "grab" && fixture.affl === 800), "JSON missing the grab rail height");
  assert(exported.rooms[0].name === "BATHROOM" && exported.rooms[0].ceiling === 2400, "JSON room label");
  assert(exported.callouts.some((callout) => callout.text.includes("HOBLESS") && callout.sheet === "proposed"), "JSON callout");
  assert(exported.meta.client === "Example Client" && exported.meta.address === "1 Sample Street", "JSON job fields");

  const pdfDownload = page.waitForEvent("download");
  await page.locator("#export-pdf").click();
  const pdfFile = await pdfDownload;
  const pdfPath = `${shots}/example-bathroom.pdf`;
  await pdfFile.saveAs(pdfPath);
  const pdfBytes = readFileSync(pdfPath);
  assert(pdfBytes.subarray(0, 5).toString() === "%PDF-", "export is not a PDF");
  const info = await exec("pdfinfo", [pdfPath]);
  assert(/Pages:\s+2/.test(info.stdout), `expected 2 PDF pages\n${info.stdout}`);

  await rasterize(pdfPath, shots);
  const existingColors = await countColors(page, `${shots}/pdf-1.png`);
  const proposedColors = await countColors(page, `${shots}/pdf-2.png`);
  assert(existingColors.red > 30, `existing sheet has little red (${existingColors.red})`);
  assert(existingColors.black > 40, `existing sheet has little black wall (${existingColors.black})`);
  assert(proposedColors.blue > 30, `proposed sheet has little new-work blue (${proposedColors.blue})`);
  assert(proposedColors.red * 4 < existingColors.red, `proposed sheet still shows demolition red (${proposedColors.red} vs ${existingColors.red})`);
  console.log("PDF pixels", { existing: existingColors, proposed: proposedColors });

  await page.evaluate(async () => navigator.serviceWorker.ready);
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
    await page.reload({ waitUntil: "networkidle" });
    await page.evaluate(async () => navigator.serviceWorker.ready);
  }
  assert(await page.evaluate(() => !!navigator.serviceWorker.controller), "service worker is not controlling the page");
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (document.querySelector("#plan-summary")?.textContent ?? "").includes("BATHROOM"));
  const offlineJson = page.waitForEvent("download");
  await page.locator("#export-json").click();
  const offlineFile = await offlineJson;
  await offlineFile.saveAs(`${shots}/offline-export.json`);
  const offlinePlan = JSON.parse(readFileSync(`${shots}/offline-export.json`, "utf8"));
  assert(offlinePlan.fixtures.some((fixture) => fixture.kind === "shower"), "offline export lost the shower");
  await page.screenshot({ path: `${shots}/04-offline.png` });

  console.log("M2 browser checks passed.");
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
    bottom,
    right,
    top,
    left,
  };
}

function midpoint(wall) {
  return { x: (wall.a.x + wall.b.x) / 2, y: (wall.a.y + wall.b.y) / 2 };
}

function towardCenter(point, box, distanceMm) {
  const center = { x: box.x + box.width / 2, y: box.y + box.depth / 2 };
  const dx = center.x - point.x;
  const dy = center.y - point.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: point.x + (dx / len) * distanceMm, y: point.y + (dy / len) * distanceMm };
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

async function pen(page, from, to) {
  await page.evaluate(
    ({ from, to }) => {
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
      fire("pointerdown", from.x, from.y, 1);
      const steps = 6;
      for (let i = 1; i <= steps; i += 1) {
        fire("pointermove", from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps, 1);
      }
      fire("pointerup", to.x, to.y, 0);
    },
    { from, to },
  );
}

async function exec(command, args) {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  return promisify(execFile)(command, args);
}

async function rasterize(pdfPath, directory) {
  await exec("pdftoppm", ["-png", "-r", "72", pdfPath, `${directory}/pdf`]);
}

async function countColors(page, pngPath) {
  const b64 = readFileSync(pngPath).toString("base64");
  return page.evaluate(async (encoded) => {
    const image = new Image();
    image.src = `data:image/png;base64,${encoded}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0;
    let blue = 0;
    let black = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r > 160 && g < 60 && b < 80) red += 1;
      else if (b > 150 && r < 130 && g > 60 && g < 200 && b > r + 40) blue += 1;
      else if (r < 45 && g < 45 && b < 45) black += 1;
    }
    return { red, blue, black, width: canvas.width, height: canvas.height };
  }, b64);
}
