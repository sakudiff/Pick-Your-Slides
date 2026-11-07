// Screenshots are read here in the browser, so pictures of people's names never leave the device.
import type { Worker } from "tesseract.js";

declare const __TESSERACT__: string;
const VENDOR = typeof __TESSERACT__ === "string" ? __TESSERACT__ : "/vendor/tesseract";
// wider than this, a phone screenshot only adds pixels to read, not detail
const MAX_WIDTH = 1100;

let report: (text: string) => void = () => {};
let worker: Promise<Worker> | null = null;

// One reader for the page, started as soon as someone looks likely to need it and kept for later screenshots.
export function warmReader(): Promise<Worker> {
  worker ??= (async () => {
    // the prebuilt ESM build, because bundling the CommonJS source loses its named exports
    const { default: { createWorker } } = await import("tesseract.js/dist/tesseract.esm.min.js");
    return createWorker("eng", 1, {
      workerPath: `${VENDOR}/worker.min.js`,
      corePath: `${VENDOR}/core`,
      langPath: `${VENDOR}/lang`,
      workerBlobURL: false,
      logger: message => {
        if (message.status === "recognizing text") report(`Reading… ${Math.round(message.progress * 100)}%`);
        else if (message.status.startsWith("loading")) report("Loading the text reader…");
      },
    });
  })();
  worker.catch(() => { worker = null; });
  return worker;
}

// Large screenshots are scaled down and turned grey, which reads faster and no less accurately.
async function prepared(image: Blob): Promise<Blob | HTMLCanvasElement> {
  const bitmap = await createImageBitmap(image);
  if (bitmap.width <= MAX_WIDTH) {
    bitmap.close();
    return image;
  }
  const scale = MAX_WIDTH / bitmap.width;
  const canvas = document.createElement("canvas");
  canvas.width = MAX_WIDTH;
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d")!;
  context.filter = "grayscale(1)";
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

export async function screenshotLines(images: Blob[], progress: (text: string) => void): Promise<string[]> {
  const reader = await warmReader();
  const lines: string[] = [];
  for (const [index, image] of images.entries()) {
    report = text => progress(images.length > 1 ? `Screenshot ${index + 1} of ${images.length}. ${text}` : text);
    const { data } = await reader.recognize(await prepared(image));
    lines.push(...data.text.split(/\r?\n/));
  }
  report = () => {};
  return lines;
}
