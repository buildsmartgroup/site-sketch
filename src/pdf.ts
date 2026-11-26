import { PDFDocument } from "pdf-lib";
import { renderSheet } from "./sheet";
import type { Plan, Sheet } from "./types";

const A3: [number, number] = [(420 * 72) / 25.4, (297 * 72) / 25.4];

export async function planToPdfBlob(plan: Plan): Promise<Blob> {
  const pdf = await PDFDocument.create();
  pdf.setCreator("Site Sketch");
  pdf.setProducer("Buildsmart Group Site Sketch");
  pdf.setTitle(plan.meta.project.trim() || "Site sketch");
  const sheets: Sheet[] = ["existing", "proposed"];
  for (const sheet of sheets) {
    const canvas = document.createElement("canvas");
    renderSheet(canvas, plan, sheet);
    const bytes = await canvasToPng(canvas);
    const page = pdf.addPage(A3);
    const image = await pdf.embedPng(bytes);
    page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  }
  const saved = await pdf.save();
  const copy = new Uint8Array(saved.byteLength);
  copy.set(saved);
  return new Blob([copy.buffer], { type: "application/pdf" });
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error("Could not draw the sheet."));
        return;
      }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, "image/png");
  });
}
