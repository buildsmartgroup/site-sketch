import { deleteProject, listProjects, putProject } from "./db";
import { layoutDimensions } from "./dimensions";
import { Editor, type PointerInput } from "./editor";
import { niceScaleMm, parseMm } from "./geometry";
import { paint } from "./render";
import { sanitizePlan } from "./plan";
import { emptyPlan, isThickness, type DimTarget, type Project, type Tool, type View } from "./types";

const screenList = document.querySelector<HTMLElement>("#screen-list")!;
const screenEditor = document.querySelector<HTMLElement>("#screen-editor")!;
const projectList = document.querySelector<HTMLUListElement>("#project-list")!;
const emptyState = document.querySelector<HTMLElement>("#empty-state")!;
const storageError = document.querySelector<HTMLElement>("#storage-error")!;
const projectName = document.querySelector<HTMLElement>("#project-name")!;
const stage = document.querySelector<HTMLElement>("#stage")!;
const canvas = document.querySelector<HTMLCanvasElement>("#plan")!;
const overlay = document.querySelector<HTMLElement>("#overlay")!;
const liveReadout = document.querySelector<HTMLElement>("#live-readout")!;
const snapReadout = document.querySelector<HTMLElement>("#snap-readout")!;
const hud = document.querySelector<HTMLElement>("#hud")!;
const scaleBar = document.querySelector<HTMLElement>("#scale-bar")!;
const scaleLabel = document.querySelector<HTMLElement>("#scale-label")!;
const saveState = document.querySelector<HTMLElement>("#save-state")!;
const planSummary = document.querySelector<HTMLElement>("#plan-summary")!;
const undoButton = document.querySelector<HTMLButtonElement>("#undo")!;
const redoButton = document.querySelector<HTMLButtonElement>("#redo")!;
const deleteButton = document.querySelector<HTMLButtonElement>("#delete")!;
const dimLayer = document.querySelector<HTMLElement>("#dim-layer")!;
const dimForm = document.querySelector<HTMLFormElement>("#dim-editor")!;
const dimTitle = document.querySelector<HTMLElement>("#dim-title")!;
const dimInput = document.querySelector<HTMLInputElement>("#dim-input")!;
const dimError = document.querySelector<HTMLElement>("#dim-error")!;

const LAST_KEY = "site-sketch:last";

let projects: Project[] = [];
let current: Project | null = null;
let suppressSave = false;
let saveTimer = 0;
let saveQueue: Promise<void> = Promise.resolve();
let renamingId: string | null = null;
let confirmingId: string | null = null;
let dimensionTarget: DimTarget | null = null;

const editor = new Editor({
  onCommit: () => scheduleSave(),
  onView: () => {
    render();
    scheduleSave();
  },
});

document.querySelector<HTMLButtonElement>("#new-sketch")!.addEventListener("click", () => {
  void createSketch();
});
document.querySelector<HTMLButtonElement>("#back")!.addEventListener("click", () => {
  void showList();
});
undoButton.addEventListener("click", () => editor.undo());
redoButton.addEventListener("click", () => editor.redo());
deleteButton.addEventListener("click", () => editor.deleteSelection());
document.querySelector<HTMLButtonElement>("#fit")!.addEventListener("click", () => editor.frameContent());
document.querySelector<HTMLButtonElement>("#zoom-in")!.addEventListener("click", () => editor.zoomBy(1.25));
document.querySelector<HTMLButtonElement>("#zoom-out")!.addEventListener("click", () => editor.zoomBy(1 / 1.25));

for (const button of document.querySelectorAll<HTMLButtonElement>(".tool")) {
  button.addEventListener("click", () => {
    const tool = button.dataset.tool;
    if (tool === "select" || tool === "room" || tool === "wall") editor.setTool(tool);
  });
}
for (const button of document.querySelectorAll<HTMLButtonElement>(".thick")) {
  button.addEventListener("click", () => {
    const thickness = Number(button.dataset.thickness);
    if (isThickness(thickness)) editor.setThickness(thickness);
  });
}

canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointercancel", onPointerUp);
canvas.addEventListener("wheel", onWheel, { passive: false });
stage.addEventListener("contextmenu", (event) => event.preventDefault());
for (const type of ["gesturestart", "gesturechange", "gestureend"] as const) {
  document.addEventListener(type, (event) => event.preventDefault(), { passive: false });
}

dimForm.addEventListener("submit", (event) => {
  event.preventDefault();
  commitDimension();
});
document.querySelector<HTMLButtonElement>("#dim-cancel")!.addEventListener("click", closeDimension);
document.querySelector<HTMLButtonElement>("#dim-backdrop")!.addEventListener("click", closeDimension);

window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", onKeyUp);
window.addEventListener("resize", measureAndRender);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") void flushSave();
});
new ResizeObserver(() => measureAndRender()).observe(stage);

void boot();

async function boot(): Promise<void> {
  try {
    projects = await listProjects();
    storageError.hidden = true;
  } catch (error) {
    storageError.hidden = false;
    storageError.textContent = error instanceof Error ? error.message : "Sketches could not be opened on this device.";
  }
  const lastId = localStorage.getItem(LAST_KEY);
  const last = projects.find((project) => project.id === lastId);
  if (last) await openProject(last);
  else renderList();
}

async function createSketch(): Promise<void> {
  const now = Date.now();
  const project: Project = {
    id: crypto.randomUUID(),
    name: nextSketchName(projects),
    createdAt: now,
    updatedAt: now,
    plan: emptyPlan(),
  };
  projects.unshift(project);
  try {
    await putProject(structuredClone(project));
  } catch (error) {
    projects.shift();
    storageError.hidden = false;
    storageError.textContent = error instanceof Error ? error.message : "The sketch could not be saved on this device.";
    return;
  }
  await openProject(project);
}

async function openProject(project: Project): Promise<void> {
  localStorage.setItem(LAST_KEY, project.id);
  suppressSave = true;
  current = project;
  projectName.textContent = project.name;
  screenList.hidden = true;
  screenEditor.hidden = false;
  await nextFrame();
  measure();
  editor.load(sanitizePlan(project.plan), sanitizeView(project.view));
  suppressSave = false;
  closeDimension();
  stage.focus();
}

async function showList(): Promise<void> {
  closeDimension();
  await flushSave();
  localStorage.removeItem(LAST_KEY);
  current = null;
  screenEditor.hidden = true;
  screenList.hidden = false;
  renderList();
}

function renderList(): void {
  projectList.replaceChildren();
  emptyState.hidden = projects.length > 0;
  for (const project of projects) projectList.append(renderRow(project));
}

function renderRow(project: Project): HTMLLIElement {
  const row = document.createElement("li");
  row.className = "project";
  if (renamingId === project.id) {
    const form = document.createElement("form");
    form.className = "rename-row";
    const input = document.createElement("input");
    input.value = project.name;
    input.maxLength = 80;
    input.ariaLabel = "Sketch name";
    input.required = true;
    const save = document.createElement("button");
    save.type = "submit";
    save.textContent = "Save";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => {
      renamingId = null;
      renderList();
    });
    form.append(input, save, cancel);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      void renameProject(project, name);
    });
    row.append(form);
    queueMicrotask(() => {
      input.focus();
      input.select();
    });
    return row;
  }

  const open = document.createElement("button");
  open.type = "button";
  open.className = "project-open";
  const name = document.createElement("span");
  name.className = "project-name";
  name.textContent = project.name;
  const meta = document.createElement("span");
  meta.className = "project-meta";
  const walls = project.plan.walls.length;
  meta.textContent = `${formatWhen(project.updatedAt)} · ${walls} ${walls === 1 ? "wall" : "walls"}`;
  open.append(name, meta);
  open.addEventListener("click", () => void openProject(project));

  const actions = document.createElement("div");
  actions.className = confirmingId === project.id ? "confirm-actions" : "project-actions";
  if (confirmingId === project.id) {
    const yes = document.createElement("button");
    yes.type = "button";
    yes.className = "danger";
    yes.textContent = "Delete";
    yes.addEventListener("click", () => void removeProject(project.id));
    const no = document.createElement("button");
    no.type = "button";
    no.textContent = "Keep";
    no.addEventListener("click", () => {
      confirmingId = null;
      renderList();
    });
    actions.append(yes, no);
  } else {
    const rename = document.createElement("button");
    rename.type = "button";
    rename.textContent = "Rename";
    rename.addEventListener("click", () => {
      renamingId = project.id;
      confirmingId = null;
      renderList();
    });
    const destroy = document.createElement("button");
    destroy.type = "button";
    destroy.className = "danger";
    destroy.textContent = "Delete";
    destroy.addEventListener("click", () => {
      confirmingId = project.id;
      renamingId = null;
      renderList();
    });
    actions.append(rename, destroy);
  }
  row.append(open, actions);
  return row;
}

async function renameProject(project: Project, name: string): Promise<void> {
  project.name = name;
  project.updatedAt = Date.now();
  if (current?.id === project.id) {
    current.name = name;
    projectName.textContent = name;
  }
  renamingId = null;
  await putProject(structuredClone(project));
  renderList();
}

async function removeProject(id: string): Promise<void> {
  await deleteProject(id);
  projects = projects.filter((project) => project.id !== id);
  if (current?.id === id) current = null;
  confirmingId = null;
  renderList();
}

function measure(): void {
  const rect = stage.getBoundingClientRect();
  editor.setCanvasSize(rect.width, rect.height);
}

function measureAndRender(): void {
  if (screenEditor.hidden) return;
  measure();
  render();
}

function render(): void {
  const width = editor.canvas.width;
  const height = editor.canvas.height;
  const dpr = window.devicePixelRatio || 1;
  const bufferW = Math.max(1, Math.round(width * dpr));
  const bufferH = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== bufferW || canvas.height !== bufferH) {
    canvas.width = bufferW;
    canvas.height = bufferH;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx || width < 1 || height < 1) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const plan = editor.displayPlan();
  paint(ctx, plan, editor.view, width, height, editor.highlightedWallIds());
  renderLabels(plan);
  renderChrome();
}

function renderLabels(plan: ReturnType<Editor["displayPlan"]>): void {
  const { labels } = layoutDimensions(plan, editor.view);
  overlay.replaceChildren();
  for (const label of labels) {
    if (label.x < -240 || label.y < -240 || label.x > editor.canvas.width + 240 || label.y > editor.canvas.height + 240) {
      continue;
    }
    const node = document.createElement(label.provisional ? "div" : "button");
    node.className = label.provisional ? "dim-live" : "dim-btn";
    node.style.left = `${label.x}px`;
    node.style.top = `${label.y}px`;
    node.style.setProperty("--rot", `${label.rotation}deg`);
    const text = document.createElement("span");
    text.textContent = label.text;
    node.append(text);
    if (!label.provisional && node instanceof HTMLButtonElement) {
      node.type = "button";
      node.dataset.kind = label.target.kind;
      node.dataset.mm = String(Math.round(label.mm));
      if (label.target.kind === "wall") node.dataset.wallId = label.target.wallId;
      else node.dataset.roomId = label.target.roomId;
      const noun = label.target.kind === "room-width" ? "Room width" : label.target.kind === "room-depth" ? "Room depth" : "Wall length";
      node.setAttribute("aria-label", `${noun} ${label.text} millimetres`);
      node.addEventListener("click", (event) => {
        event.stopPropagation();
        openDimension(label.target, label.mm);
      });
    }
    overlay.append(node);
  }
}

function renderChrome(): void {
  const snap = editor.snapMm();
  snapReadout.textContent = `Snap ${snap} mm`;
  const hudText = editor.hudText();
  hud.textContent = hudText;
  liveReadout.hidden = !editor.hasDraft();
  liveReadout.textContent = hudText;
  const scaleMm = niceScaleMm(editor.view.pxPerMm);
  scaleBar.style.width = `${Math.max(24, scaleMm * editor.view.pxPerMm)}px`;
  scaleLabel.textContent = `${scaleMm} mm`;
  planSummary.textContent = editor.summary();
  planSummary.dataset.plan = JSON.stringify(editor.plan);
  stage.dataset.tool = editor.tool;
  stage.dataset.originX = String(editor.view.originX);
  stage.dataset.originY = String(editor.view.originY);
  stage.dataset.pxPerMm = String(editor.view.pxPerMm);
  stage.dataset.panning = editor.spacePan ? "true" : "false";
  undoButton.disabled = !editor.canUndo();
  redoButton.disabled = !editor.canRedo();
  deleteButton.disabled = editor.selection.kind === "none";
  for (const button of document.querySelectorAll<HTMLButtonElement>(".tool")) {
    button.setAttribute("aria-pressed", String(button.dataset.tool === editor.tool));
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>(".thick")) {
    button.setAttribute("aria-checked", String(Number(button.dataset.thickness) === editor.thickness));
  }
  if (current) projectName.textContent = current.name;
}

function openDimension(target: DimTarget, mm: number): void {
  dimensionTarget = target;
  dimTitle.textContent = target.kind === "room-width" ? "Room width" : target.kind === "room-depth" ? "Room depth" : "Wall length";
  dimInput.value = String(Math.round(mm));
  dimError.textContent = "";
  dimLayer.hidden = false;
  dimInput.focus();
  dimInput.select();
}

function closeDimension(): void {
  dimensionTarget = null;
  dimLayer.hidden = true;
  dimError.textContent = "";
}

function commitDimension(): void {
  if (!dimensionTarget) return;
  const value = parseMm(dimInput.value);
  if (value === null || value < 10 || value > 1_000_000) {
    dimError.textContent = "Enter a size from 10 to 1000000 mm.";
    dimInput.focus();
    return;
  }
  const target = dimensionTarget;
  closeDimension();
  editor.applyDimension(target, value);
  stage.focus();
}

function onPointerDown(event: PointerEvent): void {
  if (dimLayer.hidden === false) return;
  event.preventDefault();
  try {
    canvas.setPointerCapture(event.pointerId);
  } catch {
    // Dispatched test events have no browser pointer to capture.
  }
  editor.pointerDown(toPointer(event));
}

function onPointerMove(event: PointerEvent): void {
  editor.pointerMove(toPointer(event));
}

function onPointerUp(event: PointerEvent): void {
  editor.pointerUp(toPointer(event));
  void flushSave();
}

function onWheel(event: WheelEvent): void {
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const dy = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * 800 : event.deltaY;
  editor.wheel(event.clientX - rect.left, event.clientY - rect.top, dy);
}

function toPointer(event: PointerEvent): PointerInput {
  const rect = canvas.getBoundingClientRect();
  return {
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    button: event.button,
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    altKey: event.altKey,
  };
}

function onKeyDown(event: KeyboardEvent): void {
  if (isTyping(event.target)) {
    if (event.key === "Escape") closeDimension();
    return;
  }
  if (event.key === " " && event.target === document.body) event.preventDefault();
  if (event.code === "Space") editor.spacePan = true;
  const meta = event.metaKey || event.ctrlKey;
  if (meta && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) editor.redo();
    else editor.undo();
    return;
  }
  if (meta && event.key.toLowerCase() === "y") {
    event.preventDefault();
    editor.redo();
    return;
  }
  if (event.key === "Escape") {
    closeDimension();
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    editor.deleteSelection();
    return;
  }
  const tool = toolForKey(event.key);
  if (tool) editor.setTool(tool);
}

function onKeyUp(event: KeyboardEvent): void {
  if (event.code === "Space") editor.spacePan = false;
  stage.dataset.panning = "false";
}

function toolForKey(key: string): Tool | null {
  const lower = key.toLowerCase();
  if (lower === "v") return "select";
  if (lower === "r") return "room";
  if (lower === "w") return "wall";
  return null;
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
}

function scheduleSave(): void {
  if (!current || suppressSave) return;
  saveState.textContent = "Saving…";
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveQueue = saveQueue.then(writeCurrent).catch(() => {
      saveState.textContent = "Not saved";
    });
  }, 200);
}

function flushSave(): Promise<void> {
  window.clearTimeout(saveTimer);
  if (!current || suppressSave) return saveQueue;
  saveState.textContent = "Saving…";
  saveQueue = saveQueue.then(writeCurrent).catch(() => {
    saveState.textContent = "Not saved";
  });
  return saveQueue;
}

async function writeCurrent(): Promise<void> {
  if (!current) return;
  current.plan = editor.plan;
  current.view = { ...editor.view };
  current.updatedAt = Date.now();
  const copy = structuredClone(current);
  await putProject(copy);
  const listed = projects.find((project) => project.id === copy.id);
  if (listed) {
    listed.plan = copy.plan;
    listed.view = copy.view;
    listed.updatedAt = copy.updatedAt;
    listed.name = copy.name;
  }
  saveState.textContent = "Saved";
}

function sanitizeView(view: View | undefined): View | null {
  if (!view) return null;
  if (!Number.isFinite(view.originX) || !Number.isFinite(view.originY) || !(view.pxPerMm > 0)) return null;
  return { originX: view.originX, originY: view.originY, pxPerMm: view.pxPerMm };
}

function nextSketchName(existing: Project[]): string {
  const names = new Set(existing.map((project) => project.name));
  let index = 1;
  while (names.has(`Sketch ${index}`)) index += 1;
  return `Sketch ${index}`;
}

function formatWhen(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
