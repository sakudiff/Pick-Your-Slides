import { unzipSync, strFromU8 } from "fflate";
import { deckSlides } from "./deck.ts";
import { LIMITS, normalizeText } from "./model.ts";

export type TextItem = { str: string; height: number; x: number; y: number };
export type XmlParser = { parseFromString(xml: string, type: "application/xml"): Document };

const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function clip(text: string): string {
  return normalizeText(text).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, LIMITS.title).trim();
}

// The largest text on a page is almost always its heading, in Canva and PowerPoint exports alike.
export function pickTitle(items: TextItem[]): string {
  const words = items.filter(item => item.str.trim() !== "" && item.height > 0);
  if (words.length === 0) return "";
  const largest = Math.max(...words.map(item => item.height));
  const heading = words.filter(item => item.height >= largest * 0.9)
    .sort((a, b) => b.y - a.y || a.x - b.x);
  return clip(heading.map(item => item.str).join(" "));
}

function elements(node: Document | Element, name: string): Element[] {
  return [...node.getElementsByTagName("*") as unknown as Iterable<Element>].filter(element => element.localName === name);
}

// Slide order comes from presentation.xml, not from file names, because slides can be reordered.
export function pptxTitles(bytes: Uint8Array, parser: XmlParser): string[] {
  const files = unzipSync(bytes, { filter: file => file.name.startsWith("ppt/") });
  const read = (name: string): Document => {
    const file = files[name];
    if (!file) throw new Error(`The file is missing ${name}. Is it a PowerPoint file?`);
    return parser.parseFromString(strFromU8(file), "application/xml");
  };
  const targets = new Map(elements(read("ppt/_rels/presentation.xml.rels"), "Relationship")
    .map(relation => [relation.getAttribute("Id"), relation.getAttribute("Target")]));
  const slides = elements(read("ppt/presentation.xml"), "sldId").map(slide => targets.get(slide.getAttributeNS(REL_NS, "id")));
  if (slides.length === 0) throw new Error("This presentation has no slides.");
  return slides.map(target => {
    if (!target) return "";
    const slide = read(`ppt/${target.replace(/^\/?ppt\//, "").replace(/^\.\.\//, "")}`);
    const shapes = elements(slide, "sp");
    const title = shapes.find(shape => elements(shape, "ph")
      .some(placeholder => ["title", "ctrTitle"].includes(placeholder.getAttribute("type") ?? "")));
    return clip(shapeText(title ?? headingBox(shapes)));
  });
}

function shapeText(shape: Element | undefined): string {
  return shape ? elements(shape, "t").map(text => text.textContent ?? "").join(" ") : "";
}

// Many decks type the heading into a plain text box, so the largest text box wins, and the topmost breaks a tie.
// Other placeholders hold body text, dates and slide numbers, never the heading.
function headingBox(shapes: Element[]): Element | undefined {
  const boxes = shapes.filter(shape => elements(shape, "ph").length === 0 && shapeText(shape).trim() !== "");
  const size = (shape: Element) => Math.max(0, ...elements(shape, "rPr").map(run => Number(run.getAttribute("sz")) || 0));
  const top = (shape: Element) => Number(elements(shape, "off")[0]?.getAttribute("y")) || 0;
  return boxes.sort((a, b) => size(b) - size(a) || top(a) - top(b))[0];
}

// Slides are landscape, and reports and papers are portrait A4 or Letter.
export function mostlyPortrait(pages: { width: number; height: number }[]): boolean {
  return pages.filter(page => page.height > page.width).length * 2 > pages.length;
}

export type DeckSection = { title: string; from: number; to: number };
export type DeckOutline = { titles: string[]; sections: DeckSection[] };

function textOf(element: Element | null | undefined): string {
  return element ? clip(element.textContent ?? "") : "";
}

function headingOf(element: Element): string {
  return clip(element.getAttribute("data-title") ?? element.getAttribute("data-menu-title") ?? "")
    || textOf(element.querySelector("h1, h2, h3"))
    || clip(element.getAttribute("aria-label") ?? "");
}

// Sections built from a stack or a \section, kept only when they hold slides.
function sectionRuns(runs: { title: string; from: number; count: number }[]): DeckSection[] {
  return runs.filter(run => run.count > 0)
    .map(run => ({ title: run.title || `Slides ${run.from}–${run.from + run.count - 1}`, from: run.from, to: run.from + run.count - 1 }))
    .slice(0, LIMITS.sections);
}

function limited(titles: string[], kind: string): string[] {
  if (titles.length > LIMITS.slides) throw new Error(`This ${kind} has ${titles.length} slides. A board holds up to ${LIMITS.slides}.`);
  return titles;
}

// Reads slides out of a static HTML deck without running its scripts.
export function htmlDeckSlides(doc: Document): DeckOutline {
  const { slides, stacks } = deckSlides(doc);
  const titles = limited(slides.map(headingOf), "deck");
  const runs = stacks.map(stack => ({ title: titles[stack.first], from: stack.first + 1, count: stack.count }));
  return { titles, sections: sectionRuns(runs) };
}

// Beamer gives every overlay step of a frame the same page label, so equal neighbours are one slide.
export function overlayRuns(labels: (string | null)[] | null): number[][] {
  const runs: number[][] = [];
  (labels ?? []).forEach((label, index) => {
    const previous = runs.at(-1);
    if (previous && label !== null && label !== "" && labels![previous[0]] === label) previous.push(index);
    else runs.push([index]);
  });
  return runs;
}

// A PDF's top-level bookmarks are its sections in Beamer, Keynote and many exports. Pages are 0-based and
// physical, so each one is mapped to the slide that holds it after overlay pages merge.
export function bookmarkSections(entries: { title: string; page: number }[], runs: number[][]): DeckSection[] {
  const slideOf = new Map(runs.flatMap((pages, slide) => pages.map(page => [page, slide] as const)));
  const starts: { title: string; slide: number }[] = [];
  for (const entry of entries) {
    const slide = slideOf.get(entry.page);
    if (slide === undefined || starts.some(start => start.slide >= slide)) continue;
    starts.push({ title: clip(entry.title), slide });
  }
  return sectionRuns(starts.map((start, index) => ({
    title: start.title, from: start.slide + 1, count: (starts[index + 1]?.slide ?? runs.length) - start.slide,
  })));
}
