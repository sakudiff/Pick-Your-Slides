import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { build } from "esbuild";

// Vendor folders carry the exact package versions, so the files can be cached forever and an upgrade changes the path.
const version = async (name: string): Promise<string> =>
  (JSON.parse(await readFile(`node_modules/${name}/package.json`, "utf8")) as { version: string }).version;
const PDFJS = `/vendor/pdfjs-${await version("pdfjs-dist")}`;
const TESSERACT = `/vendor/tesseract-${await version("tesseract.js")}-core-${await version("tesseract.js-core")}-eng-${await version("@tesseract.js-data/eng")}`;

await rm("dist", { recursive: true, force: true });
await mkdir("dist/board", { recursive: true });
await copyFile("web/create/index.html", "dist/index.html");
await copyFile("web/board/index.html", "dist/board/index.html");
await copyFile("web/shared/base.css", "dist/base.css");
// the mark, icons and link-preview image sit at the root, where browsers and link cards look for them
for (const file of ["mark.svg", "favicon.svg", "icon-32.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "og.png", "site.webmanifest"]) {
  await copyFile(`web/shared/brand/${file}`, `dist/${file}`);
}
// the display and UI face, self-hosted so no page asks a font CDN for anything
await mkdir("dist/fonts", { recursive: true });
for (const [subset, name] of [["latin", "bricolage-latin"], ["latin-ext", "bricolage-latin-ext"]]) {
  await copyFile(`node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-${subset}-wght-normal.woff2`, `dist/fonts/${name}.woff2`);
}
await copyFile("web/create/landing.css", "dist/landing.css");
await mkdir("dist/privacy", { recursive: true });
await mkdir("dist/about", { recursive: true });
await copyFile("web/about/index.html", "dist/about/index.html");
await copyFile("web/about/about.css", "dist/about/about.css");
await copyFile("web/privacy/index.html", "dist/privacy/index.html");
await copyFile("web/board/style.css", "dist/board/style.css");
// pdf.js runs its parser in a worker that must be served as its own file
await mkdir(`dist${PDFJS}`, { recursive: true });
await copyFile("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", `dist${PDFJS}/pdf.worker.min.mjs`);
// the screenshot reader runs Tesseract in a worker, so its worker, engine and English model are served from here, not a CDN
await mkdir(`dist${TESSERACT}/core`, { recursive: true });
await mkdir(`dist${TESSERACT}/lang`, { recursive: true });
await copyFile("node_modules/tesseract.js/dist/worker.min.js", `dist${TESSERACT}/worker.min.js`);
for (const core of ["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"]) {
  await copyFile(`node_modules/tesseract.js-core/${core}`, `dist${TESSERACT}/core/${core}`);
}
await copyFile("node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", `dist${TESSERACT}/lang/eng.traineddata.gz`);
await build({
  entryPoints: { create: "web/create/app.ts", demo: "web/create/demo.ts", nav: "web/shared/nav-page.ts", "board/app": "web/board/app.ts" },
  outdir: "dist", bundle: true, splitting: true, format: "esm", target: "es2022", minify: true,
  chunkNames: "chunks/[name]-[hash]",
  define: { __PDFJS__: JSON.stringify(PDFJS), __TESSERACT__: JSON.stringify(TESSERACT) },
});
// the presenter bar loads as a classic script tag on decks hosted anywhere, so it is one self-contained file
await build({ entryPoints: { embed: "web/embed/app.ts" }, outdir: "dist", bundle: true, format: "iife", target: "es2020", minify: true });
console.log("Built the create page, the board page, the presenter bar and the readers into dist/");
