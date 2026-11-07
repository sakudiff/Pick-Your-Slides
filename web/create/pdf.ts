import { LIMITS } from "../shared/model.ts";
import { mostlyPortrait, pickTitle, type TextItem } from "../shared/titles.ts";

declare const __PDFJS__: string;

export type Bookmark = { title: string; page: number };
export type Imported = { titles: string[]; thumbs: Blob[]; labels: (string | null)[] | null; portrait: boolean; bookmarks: Bookmark[] };
const THUMB_WIDTH = 320;

export async function readPdf(file: Blob, progress: (done: number, total: number) => void): Promise<Imported> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `${typeof __PDFJS__ === "string" ? __PDFJS__ : "/vendor"}/pdf.worker.min.mjs`;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const document = await task.promise;
  // Beamer overlays print as several pages that share a page label, so a deck can have more pages than slides
  const labels = await document.getPageLabels();
  const runs = labels ? new Set(labels).size : document.numPages;
  if (runs > LIMITS.slides || document.numPages > LIMITS.slides * 3) throw new Error(`This PDF has ${document.numPages} pages. A board holds up to ${LIMITS.slides}.`);
  const titles: string[] = [];
  const thumbs: Blob[] = [];
  const sizes: { width: number; height: number }[] = [];
  for (let number = 1; number <= document.numPages; number += 1) {
    const page = await document.getPage(number);
    const content = await page.getTextContent();
    const items: TextItem[] = content.items.flatMap(item => "str" in item
      ? [{ str: item.str, height: item.height, x: item.transform[4], y: item.transform[5] }] : []);
    titles.push(pickTitle(items));
    sizes.push(page.getViewport({ scale: 1 }));
    const viewport = page.getViewport({ scale: THUMB_WIDTH / page.getViewport({ scale: 1 }).width });
    const canvas = window.document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport }).promise;
    thumbs.push(await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error("The slide image could not be made.")), "image/jpeg", 0.72)));
    page.cleanup();
    progress(number, document.numPages);
  }
  const bookmarks = await topBookmarks(document);
  await task.destroy();
  return { titles, thumbs, labels, portrait: mostlyPortrait(sizes), bookmarks };
}

type PdfDocument = Awaited<ReturnType<typeof import("pdfjs-dist").getDocument>["promise"]>;

// Only the top level, which Beamer and most exporters use for sections. A bookmark that does not resolve
// to a page is skipped, since a broken outline should not stop the slides from loading.
async function topBookmarks(document: PdfDocument): Promise<Bookmark[]> {
  const outline = await document.getOutline().catch(() => null);
  const found: Bookmark[] = [];
  for (const item of outline ?? []) {
    try {
      const dest = typeof item.dest === "string" ? await document.getDestination(item.dest) : item.dest;
      const target = dest?.[0];
      const page = typeof target === "number" ? target : target ? await document.getPageIndex(target) : null;
      if (page !== null) found.push({ title: item.title, page });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
    }
  }
  return found;
}
