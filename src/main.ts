import { deleteProject, listProjects, putProject } from "./db";
import { Editor, type Pending, type PointerInput } from "./editor";
import { CATALOG } from "./fixtures";
import { niceScaleMm, parseMm } from "./geometry";
import { screenLabels } from "./labels";
import { DOOR_WIDTHS, WINDOW_WIDTHS } from "./openings";
import { planToPdfBlob } from "./pdf";
import { fixtureById, openingById, removalState, roomById, sanitizePlan } from "./plan";
import { paint } from "./render";
import { fileStem, saveFile } from "./share";
import { emptyPlan, isThickness, type DimTarget, type FixtureKind, type PlanMeta, type Project, type Tool, type View } from "./types";

const TOOLS: Tool[] = ["select", "room", "wall", "door", "cavity", "window", "fixture", "dim", "callout", "text"];
const KEYS: Record<string, Tool> = {
  v: "select",
  r: "room",
  w: "wall",
  d: "door",
  k: "cavity",
  n: "window",
  f: "fixture",
  m: "dim",
  c: "callout",
  t: "text",
};

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
const phaseHint = document.querySelector<HTMLElement>("#phase-hint")!;
const undoButton = document.querySelector<HTMLButtonElement>("#undo")!;
const redoButton = document.querySelector<HTMLButtonElement>("#redo")!;
const deleteButton = document.querySelector<HTMLButtonElement>("#delete")!;
const dimLayer = document.querySelector<HTMLElement>("#dim-layer")!;
const dimForm = document.querySelector<HTMLFormElement>("#dim-editor")!;
const dimTitle = document.querySelector<HTMLElement>("#dim-title")!;
const dimInput = document.querySelector<HTMLInputElement>("#dim-input")!;
const dimError = document.querySelector<HTMLElement>("#dim-error")!;
const formLayer = document.querySelector<HTMLElement>("#form-layer")!;
const formPanel = document.querySelector<HTMLFormElement>("#form-panel")!;
const formTitle = document.querySelector<HTMLElement>("#form-title")!;
const formFields = document.querySelector<HTMLElement>("#form-fields")!;
const formError = document.querySelector<HTMLElement>("#form-error")!;
const inspector = document.querySelector<HTMLElement>("#inspector")!;
const palette = document.querySelector<HTMLElement>("#palette")!;

const LAST_KEY = "site-sketch:last";

const PALETTE: { kind: FixtureKind; label: string; diameter?: 1540 | 2070 }[] = [
  { kind: "toilet", label: "Toilet" },
  { kind: "basin", label: "Basin" },
  { kind: "vanity", label: "Vanity" },
  { kind: "shower", label: "Shower" },
  { kind: "bath", label: "Bath" },
  { kind: "grab", label: "Grab" },
  { kind: "grab-l", label: "L grab" },
  { kind: "curtain", label: "Curtain" },
  { kind: "niche", label: "Niche" },
  { kind: "mirror", label: "Mirror" },
  { kind: "gpo", label: "GPO" },
  { kind: "switch", label: "Switch" },
  { kind: "exhaust", label: "Exhaust" },
  { kind: "light", label: "Light" },
  { kind: "turning", label: "Turn 1540", diameter: 1540 },
  { kind: "turning", label: "Turn 2070", diameter: 2070 },
];

let projects: Project[] = [];
let current: Project | null = null;
let suppressSave = false;
let saveTimer = 0;
let saveQueue: Promise<void> = Promise.resolve();
let renamingId: string | null = null;
let confirmingId: string | null = null;
let dimensionCommit: ((mm: number) => void) | null = null;
let dimensionMin = 10;
let dimensionMax = 1_000_000;
let formSave: ((values: Record<string, string>) => void) | null = null;
let formSaved = false;
let inspectorKey = "";

const editor = new Editor({
  onCommit: () => scheduleSave(),
  onView: () => {
    render();
    scheduleSave();
  },
  onPending: (pending) => {
    if (pending) openPending(pending);
  },
});

buildPalette();

document.querySelector<HTMLButtonElement>("#new-sketch")!.addEventListener("click", () => void createSketch());
document.querySelector<HTMLButtonElement>("#back")!.addEventListener("click", () => void showList());
undoButton.addEventListener("click", () => editor.undo());
redoButton.addEventListener("click", () => editor.redo());
deleteButton.addEventListener("click", () => editor.deleteSelection());
document.querySelector<HTMLButtonElement>("#fit")!.addEventListener("click", () => editor.frameContent());
document.querySelector<HTMLButtonElement>("#zoom-in")!.addEventListener("click", () => editor.zoomBy(1.25));
document.querySelector<HTMLButtonElement>("#zoom-out")!.addEventListener("click", () => editor.zoomBy(1 / 1.25));
document.querySelector<HTMLButtonElement>("#job")!.addEventListener("click", () => openJob());
document.querySelector<HTMLButtonElement>("#export-pdf")!.addEventListener("click", () => void exportPdf());
document.querySelector<HTMLButtonElement>("#export-json")!.addEventListener("click", () => void exportJson());
document.querySelector<HTMLButtonElement>("#phase-existing")!.addEventListener("click", () => editor.setSheet("existing"));
document.querySelector<HTMLButtonElement>("#phase-proposed")!.addEventListener("click", () => editor.setSheet("proposed"));

for (const button of document.querySelectorAll<HTMLButtonElement>(".tool")) {
  button.addEventListener("click", () => {
    const tool = button.dataset.tool;
    if (isTool(tool)) editor.setTool(tool);
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
formPanel.addEventListener("submit", (event) => {
  event.preventDefault();
  commitForm();
});
document.querySelector<HTMLButtonElement>("#form-cancel")!.addEventListener("click", () => closeForm());
document.querySelector<HTMLButtonElement>("#form-backdrop")!.addEventListener("click", () => closeForm());

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
  const plan = emptyPlan();
  plan.meta.date = new Date(now).toISOString().slice(0, 10);
  const project: Project = {
    id: crypto.randomUUID(),
    name: nextSketchName(projects),
    createdAt: now,
    updatedAt: now,
    plan,
    sheet: "existing",
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
  editor.load(sanitizePlan(project.plan), sanitizeView(project.view), project.sheet === "proposed" ? "proposed" : "existing");
  suppressSave = false;
  closeDimension();
  closeForm(true);
  stage.focus();
}

async function showList(): Promise<void> {
  closeDimension();
  closeForm(true);
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
  const walls = project.plan?.walls?.length ?? 0;
  const fixtures = project.plan?.fixtures?.length ?? 0;
  meta.textContent = fixtures
    ? `${formatWhen(project.updatedAt)} · ${walls} walls · ${fixtures} fixtures`
    : `${formatWhen(project.updatedAt)} · ${walls} ${walls === 1 ? "wall" : "walls"}`;
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
  const selectedId = editor.selection.kind === "none" ? null : editor.selection.id;
  paint(ctx, plan, editor.view, width, height, {
    sheet: editor.sheet,
    grid: true,
    background: true,
    labels: false,
    highlightedWalls: editor.highlightedWallIds(),
    selectedId,
  });
  renderLabels(plan);
  renderInspector();
  renderChrome();
}

function renderLabels(plan: ReturnType<Editor["displayPlan"]>): void {
  overlay.replaceChildren();
  for (const label of screenLabels(plan, editor.view, editor.sheet)) {
    if (label.x < -280 || label.y < -280 || label.x > editor.canvas.width + 280 || label.y > editor.canvas.height + 280) continue;
    const node = document.createElement(label.provisional || label.kind === "room" || label.kind === "manual" ? "div" : "button");
    node.className = `${label.kind}-label${label.provisional ? " dim-live" : ""}`;
    node.style.left = `${label.x}px`;
    node.style.top = `${label.y}px`;
    if (label.kind === "dim" || label.kind === "manual") node.style.setProperty("--rot", `${label.rotation}deg`);
    node.textContent = label.text;
    if (label.id && editor.selection.kind !== "none" && editor.selection.id === label.id) node.classList.add("label-selected");
    if (label.kind === "dim" && label.dim) {
      node.dataset.kind = label.dim.kind;
      node.dataset.mm = label.text;
      if (label.dim.kind === "wall") node.dataset.wallId = label.dim.wallId;
      else if (label.dim.kind !== "opening") node.dataset.roomId = label.dim.roomId;
    }
    if (node instanceof HTMLButtonElement && !label.provisional) {
      node.type = "button";
      node.addEventListener("click", (event) => {
        event.stopPropagation();
        if (label.kind === "dim" && label.dim) openDimension(label.dim, Number(label.text));
        else if (label.kind === "opening" && label.id) {
          const opening = openingById(editor.plan, label.id);
          if (!opening) return;
          editor.choose({ kind: "opening", id: label.id });
          openNumber("Opening width", opening.width, 100, 10000, (mm) => editor.applyDimension({ kind: "opening", openingId: label.id! }, mm));
        } else if (label.kind === "callout" && label.id) {
          const callout = editor.plan.callouts.find((item) => item.id === label.id);
          if (!callout) return;
          editor.choose({ kind: "callout", id: callout.id });
          openForm("Callout", [{ name: "text", label: "Note", value: callout.text, multiline: true }], (values) => {
            editor.setCalloutText(callout.id, values.text ?? "");
          });
        } else if (label.kind === "text" && label.id) {
          const note = editor.plan.notes.find((item) => item.id === label.id);
          if (!note) return;
          editor.choose({ kind: "text", id: note.id });
          openForm("Text", [{ name: "text", label: "Text", value: note.text, multiline: true }], (values) => {
            editor.setNoteText(note.id, values.text ?? "");
          });
        }
      });
    }
    overlay.append(node);
  }
}

function renderInspector(): void {
  const key = inspectorSignature();
  const show = editor.selection.kind !== "none";
  inspector.hidden = !show;
  if (!show) {
    inspectorKey = "";
    return;
  }
  if (key === inspectorKey) return;
  inspectorKey = key;
  inspector.replaceChildren();
  const label = document.createElement("span");
  label.className = "inspector-label";
  label.textContent = editor.hudText() || "Selected";
  inspector.append(label);
  const removal = removalState(editor.plan, editor.selection);
  if (removal) inspector.append(button(removal === "remove" ? "Keep" : "Mark remove", () => editor.toggleRemoval(), "remove-toggle"));
  if (editor.selection.kind === "room") {
    const room = roomById(editor.plan, editor.selection.id);
    if (!room) return;
    inspector.append(button("Name", () => {
      openForm("Room", [
        { name: "name", label: "Room name", value: room.name },
        { name: "ceiling", label: "Ceiling height mm", value: String(room.ceiling) },
      ], (values) => {
        const ceiling = parseMm(values.ceiling ?? "");
        editor.setRoomFields(room.id, {
          name: values.name ?? "",
          ceiling: ceiling ?? room.ceiling,
        });
      });
    }));
  }
  if (editor.selection.kind === "opening") {
    const opening = openingById(editor.plan, editor.selection.id);
    if (!opening) return;
    const widths = opening.kind === "window" ? WINDOW_WIDTHS : DOOR_WIDTHS;
    for (const width of widths) {
      const chip = button(String(width), () => editor.applyDimension({ kind: "opening", openingId: opening.id }, width));
      chip.classList.add("chip");
      chip.setAttribute("aria-pressed", String(opening.width === width));
      inspector.append(chip);
    }
    inspector.append(button(`${Math.round(opening.width)} mm`, () => {
      openNumber("Opening width", opening.width, 100, 10000, (mm) => editor.applyDimension({ kind: "opening", openingId: opening.id }, mm));
    }));
    if (opening.kind === "hinged") {
      inspector.append(button("Hinge", () => editor.flipOpening("hand")));
      inspector.append(button("Swing", () => editor.flipOpening("side")));
    } else if (opening.kind === "cavity") {
      inspector.append(button("Pocket", () => editor.flipOpening("hand")));
    }
    inspector.append(button(`Head ${Math.round(opening.head)}`, () => {
      openNumber("Head height", opening.head, 100, 8000, (mm) => editor.patchOpening(opening.id, { head: mm }));
    }));
    if (opening.kind === "window") {
      inspector.append(button(`Sill ${Math.round(opening.sill)}`, () => {
        openNumber("Sill height", opening.sill, 0, 8000, (mm) => editor.patchOpening(opening.id, { sill: mm }));
      }));
    }
  }
  if (editor.selection.kind === "fixture") {
    const fixture = fixtureById(editor.plan, editor.selection.id);
    if (!fixture) return;
    const spec = CATALOG[fixture.kind];
    inspector.append(button("Rotate", () => editor.rotateSelection()));
    if (fixture.kind === "toilet") {
      inspector.append(button(fixture.clearance ? "Clearance on" : "Clearance", () => {
        editor.setFixtureFields(fixture.id, { clearance: !fixture.clearance });
      }));
    }
    if (fixture.kind === "turning") {
      inspector.append(button("1540", () => editor.setFixtureFields(fixture.id, { diameter: 1540 })));
      inspector.append(button("2070", () => editor.setFixtureFields(fixture.id, { diameter: 2070 })));
    }
    inspector.append(button("Sizes", () => {
      const fields = [
        { name: "width", label: "Width mm", value: String(Math.round(fixture.width)) },
        { name: "depth", label: "Depth mm", value: String(Math.round(fixture.depth)) },
        { name: "affl", label: "Height AFFL mm", value: String(Math.round(fixture.affl)) },
      ];
      if (spec.heightLabel) fields.push({ name: "height", label: `${spec.heightLabel} mm`, value: String(Math.round(fixture.height)) });
      openForm(spec.label, fields, (values) => {
        editor.setFixtureFields(fixture.id, {
          width: parseMm(values.width ?? "") ?? fixture.width,
          depth: parseMm(values.depth ?? "") ?? fixture.depth,
          affl: parseMm(values.affl ?? "") ?? fixture.affl,
          height: values.height != null ? (parseMm(values.height) ?? fixture.height) : fixture.height,
        });
      });
    }));
  }
  const selected = editor.selection;
  if (selected.kind === "callout") {
    const callout = editor.plan.callouts.find((item) => item.id === selected.id);
    if (callout) {
      inspector.append(button("Edit", () => {
        openForm("Callout", [{ name: "text", label: "Note", value: callout.text, multiline: true }], (values) => {
          editor.setCalloutText(callout.id, values.text ?? "");
        });
      }));
    }
  }
  if (selected.kind === "text") {
    const note = editor.plan.notes.find((item) => item.id === selected.id);
    if (note) {
      inspector.append(button("Edit", () => {
        openForm("Text", [{ name: "text", label: "Text", value: note.text, multiline: true }], (values) => {
          editor.setNoteText(note.id, values.text ?? "");
        });
      }));
    }
  }
}

function inspectorSignature(): string {
  const selection = editor.selection;
  if (selection.kind === "opening") return JSON.stringify(openingById(editor.plan, selection.id));
  if (selection.kind === "fixture") return JSON.stringify(fixtureById(editor.plan, selection.id));
  if (selection.kind === "room") return JSON.stringify(roomById(editor.plan, selection.id));
  if (selection.kind === "wall") {
    const wall = editor.plan.walls.find((item) => item.id === selection.id);
    return JSON.stringify(wall);
  }
  return JSON.stringify(selection);
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
  stage.dataset.sheet = editor.sheet;
  stage.dataset.originX = String(editor.view.originX);
  stage.dataset.originY = String(editor.view.originY);
  stage.dataset.pxPerMm = String(editor.view.pxPerMm);
  stage.dataset.panning = editor.spacePan ? "true" : "false";
  phaseHint.textContent = editor.sheet === "proposed" ? "Proposed · new work in blue" : "Existing · red marks removal";
  undoButton.disabled = !editor.canUndo();
  redoButton.disabled = !editor.canRedo();
  deleteButton.disabled = editor.selection.kind === "none";
  document.querySelector<HTMLButtonElement>("#phase-existing")!.setAttribute("aria-pressed", String(editor.sheet === "existing"));
  document.querySelector<HTMLButtonElement>("#phase-proposed")!.setAttribute("aria-pressed", String(editor.sheet === "proposed"));
  for (const button of document.querySelectorAll<HTMLButtonElement>(".tool")) {
    button.setAttribute("aria-pressed", String(button.dataset.tool === editor.tool));
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>(".thick")) {
    button.setAttribute("aria-checked", String(Number(button.dataset.thickness) === editor.thickness));
  }
  palette.hidden = editor.tool !== "fixture";
  for (const button of palette.querySelectorAll<HTMLButtonElement>("button")) {
    const kind = button.dataset.fixture;
    const diameter = Number(button.dataset.diameter);
    const on = editor.fixtureKind === kind && (kind !== "turning" || diameter === editor.turningDiameter);
    button.setAttribute("aria-pressed", String(on));
  }
  if (current) projectName.textContent = current.name;
}

function buildPalette(): void {
  for (const item of PALETTE) {
    const control = button(item.label, () => editor.setFixtureKind(item.kind, item.diameter));
    control.dataset.fixture = item.kind;
    if (item.diameter) control.dataset.diameter = String(item.diameter);
    palette.append(control);
  }
}

function button(text: string, onClick: () => void, id?: string): HTMLButtonElement {
  const control = document.createElement("button");
  control.type = "button";
  control.textContent = text;
  if (id) control.id = id;
  control.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return control;
}

function openDimension(target: DimTarget, mm: number): void {
  const title = target.kind === "room-width" ? "Room width" : target.kind === "room-depth" ? "Room depth" : target.kind === "opening" ? "Opening width" : "Wall length";
  const min = target.kind === "opening" ? 100 : 10;
  const max = target.kind === "opening" ? 10000 : 1_000_000;
  openNumber(title, mm, min, max, (value) => editor.applyDimension(target, value));
}

function openNumber(title: string, mm: number, min: number, max: number, commit: (mm: number) => void): void {
  dimensionCommit = commit;
  dimensionMin = min;
  dimensionMax = max;
  dimTitle.textContent = title;
  dimInput.value = String(Math.round(mm));
  dimError.textContent = "";
  dimLayer.hidden = false;
  dimInput.focus();
  dimInput.select();
}

function closeDimension(): void {
  dimensionCommit = null;
  dimLayer.hidden = true;
  dimError.textContent = "";
}

function commitDimension(): void {
  if (!dimensionCommit) return;
  const value = parseMm(dimInput.value);
  if (value === null || value < dimensionMin || value > dimensionMax) {
    dimError.textContent = `Enter a size from ${dimensionMin} to ${dimensionMax} mm.`;
    dimInput.focus();
    return;
  }
  const commit = dimensionCommit;
  closeDimension();
  commit(value);
  stage.focus();
}

type FormField = { name: string; label: string; value: string; multiline?: boolean };

function openForm(title: string, fields: FormField[], save: (values: Record<string, string>) => void): void {
  formSave = save;
  formSaved = false;
  formTitle.textContent = title;
  formError.textContent = "";
  formFields.replaceChildren();
  for (const field of fields) {
    const row = document.createElement("label");
    row.className = "form-row";
    const span = document.createElement("span");
    span.textContent = field.label;
    const input = field.multiline ? document.createElement("textarea") : document.createElement("input");
    input.name = field.name;
    input.value = field.value;
    if (input instanceof HTMLInputElement && /mm|height|affl|ceiling|width|depth|sill|head/i.test(field.label)) input.inputMode = "decimal";
    row.append(span, input);
    formFields.append(row);
  }
  formLayer.hidden = false;
  const first = formFields.querySelector("input, textarea");
  if (first instanceof HTMLElement) first.focus();
}

function openPending(pending: Pending): void {
  formLayer.dataset.mode = "pending";
  if (pending.kind === "callout") {
    openForm("Callout", [{ name: "text", label: "Note", value: "", multiline: true }], (values) => editor.commitPending(values.text ?? ""));
  } else {
    openForm("Text", [{ name: "text", label: "Text", value: "", multiline: true }], (values) => editor.commitPending(values.text ?? ""));
  }
}

function openJob(): void {
  const meta = editor.plan.meta;
  formLayer.dataset.mode = "job";
  openForm("Job", [
    { name: "project", label: "Project", value: meta.project },
    { name: "client", label: "Client", value: meta.client },
    { name: "address", label: "Address", value: meta.address, multiline: true },
    { name: "drawnBy", label: "Drawn by", value: meta.drawnBy },
    { name: "date", label: "Date", value: meta.date },
    { name: "revision", label: "Revision", value: meta.revision },
    { name: "notes", label: "Notes", value: meta.notes, multiline: true },
  ], (values) => {
    const next: PlanMeta = {
      project: values.project ?? "",
      client: values.client ?? "",
      address: values.address ?? "",
      drawnBy: values.drawnBy ?? "",
      date: values.date ?? "",
      revision: values.revision ?? "",
      notes: values.notes ?? "",
    };
    editor.setPlanMeta(next);
  });
}

function closeForm(silent = false): void {
  const pending = formLayer.dataset.mode === "pending" && !formSaved && !silent;
  formLayer.hidden = true;
  formLayer.dataset.mode = "";
  formSave = null;
  if (pending) editor.cancelPending();
  formSaved = false;
}

function commitForm(): void {
  if (!formSave) return;
  const values: Record<string, string> = {};
  for (const field of formFields.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")) {
    values[field.name] = field.value;
  }
  const save = formSave;
  formSaved = true;
  closeForm();
  save(values);
  stage.focus();
}

async function exportPdf(): Promise<void> {
  if (!current) return;
  try {
    const blob = await planToPdfBlob(editor.plan);
    await saveFile(blob, `${fileStem(current.name)}.pdf`);
  } catch (error) {
    saveState.textContent = error instanceof Error ? error.message : "PDF failed";
  }
}

async function exportJson(): Promise<void> {
  if (!current) return;
  const blob = new Blob([JSON.stringify(editor.plan, null, 2)], { type: "application/json" });
  await saveFile(blob, `${fileStem(current.name)}.json`);
}

function onPointerDown(event: PointerEvent): void {
  if (!dimLayer.hidden || !formLayer.hidden) return;
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
    if (event.key === "Escape") {
      closeDimension();
      closeForm();
    }
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
    closeForm();
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    editor.deleteSelection();
    return;
  }
  const tool = KEYS[event.key.toLowerCase()];
  if (tool) editor.setTool(tool);
}

function onKeyUp(event: KeyboardEvent): void {
  if (event.code === "Space") editor.spacePan = false;
  stage.dataset.panning = "false";
}

function isTool(value: string | undefined): value is Tool {
  return !!value && TOOLS.includes(value as Tool);
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
  current.sheet = editor.sheet;
  current.updatedAt = Date.now();
  const copy = structuredClone(current);
  await putProject(copy);
  const listed = projects.find((project) => project.id === copy.id);
  if (listed) {
    listed.plan = copy.plan;
    listed.view = copy.view;
    listed.sheet = copy.sheet;
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
