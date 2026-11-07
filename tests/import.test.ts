import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { bookmarkSections, htmlDeckSlides, overlayRuns } from "../web/shared/titles.ts";

const doc = (html: string) => parseHTML(html).document as unknown as Document;

test("kit decks read section.slide, preferring data-title over the first heading", () => {
  const outline = htmlDeckSlides(doc(`<html><body><main>
    <section class="slide active" data-title="Case 3 · Equity origination"><h1>Ignored heading</h1></section>
    <section class="slide"><h2>Deal  structure</h2><section class="slide"><h2>nested, not a slide</h2></section></section>
    <section class="slide"><p>No heading here</p></section>
  </main><script>document.body.innerHTML = ""</script></body></html>`));
  assert.deepEqual(outline.titles, ["Case 3 · Equity origination", "Deal structure", ""]);
});

test("reveal.js vertical stacks flatten in order and become sections", () => {
  const outline = htmlDeckSlides(doc(`<div class="reveal"><div class="slides">
    <section><h1>Title</h1></section>
    <section><section><h2>Results</h2></section><section><h2>Robustness</h2></section></section>
    <section data-menu-title="Q&amp;A"><h2>Questions?</h2></section>
  </div></div>`));
  assert.deepEqual(outline.titles, ["Title", "Results", "Robustness", "Q&A"]);
  assert.deepEqual(outline.sections, [{ title: "Results", from: 2, to: 3 }]);
});

test("a deck that builds its slides in JavaScript yields no slides", () => {
  assert.deepEqual(htmlDeckSlides(doc(`<html><body><div id="root"></div><script src="app.js"></script></body></html>`)).titles, []);
  assert.deepEqual(htmlDeckSlides(doc(`<body><article><h2>One</h2></article><section><p>none</p></section><section><h3>Two</h3><section><h3>inner</h3></section></section></body>`)).titles, ["One", "Two"]);
});

test("Beamer PDFs merge overlay pages that share a page label", () => {
  assert.deepEqual(overlayRuns(["1", "2", "2", "2", "3", "4", "4"]), [[0], [1, 2, 3], [4], [5, 6]]);
  assert.deepEqual(overlayRuns(null), []);
  assert.deepEqual(overlayRuns([null, null, "", ""]), [[0], [1], [2], [3]]);
});

// pages 0 and 1, 3 and 4 are overlay steps of one slide each, so 7 pages make 5 slides
test("PDF bookmarks become sections on the merged slides", () => {
  const runs = [[0], [1, 2], [3], [4, 5], [6]];
  assert.deepEqual(bookmarkSections([{ title: "Problem", page: 1 }, { title: "Solution", page: 4 }], runs), [
    { title: "Problem", from: 2, to: 3 }, { title: "Solution", from: 4, to: 5 },
  ]);
  assert.deepEqual(bookmarkSections([{ title: "Problem", page: 2 }, { title: "Same slide", page: 1 }, { title: "Gone", page: 99 }], runs), [
    { title: "Problem", from: 2, to: 5 },
  ]);
  const pages = Array.from({ length: 7 }, (_, index) => [index]);
  assert.deepEqual(bookmarkSections([{ title: "Problem", page: 1 }, { title: "Solution", page: 4 }], pages), [
    { title: "Problem", from: 2, to: 4 }, { title: "Solution", from: 5, to: 7 },
  ]);
  assert.deepEqual(bookmarkSections([], runs), []);
});
