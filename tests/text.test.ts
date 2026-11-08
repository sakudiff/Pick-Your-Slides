import assert from "node:assert/strict";
import test from "node:test";
import { DOMParser } from "@xmldom/xmldom";
import { strToU8, zipSync } from "fflate";
import { injectPreview } from "../server/page.ts";
import { COLORS, unitsOf, type Meta, type Snapshot } from "../web/shared/model.ts";
import { rosterFrom, sectionsFrom } from "../web/shared/parse.ts";
import { compressRanges, messengerSummary } from "../web/shared/ranges.ts";
import { mostlyPortrait, pickTitle, pptxTitles, type XmlParser } from "../web/shared/titles.ts";

const meta: Meta = {
  title: "Case 3", slides: Array.from({ length: 8 }, () => ({ title: "" })),
  sections: [{ title: "Intro", from: 2, to: 3 }, { title: "Deal", from: 5, to: 7 }],
  roster: [{ name: "Ana", color: COLORS[0].value }, { name: "Ben", color: COLORS[1].value }],
  settings: { unit: "section", membersCanPoll: true, presentationDate: null }, deckUrl: null, thumbs: null, createdAt: "",
};

test("ranges compress consecutive slides", () => {
  assert.equal(compressRanges([5, 1, 2, 3, 9, 10]), "1-3, 5, 9-10");
  assert.equal(compressRanges([]), "");
});

test("the Messenger summary lists people in deck order and the open slides", () => {
  const snapshot: Snapshot = { id: "x", meta, revision: null, claims: { 4: "Ana", 1: "Ben", 2: "Ben", 5: "Ana" }, polls: [] };
  assert.equal(messengerSummary(snapshot, "https://pick.example/b/x"),
    "Case 3\nSlides 1-2: Ben\nSlides 4-5: Ana\nOpen: 3, 6-8\nhttps://pick.example/b/x");
});

test("a board without slides yet points the group to its polls", () => {
  const snapshot: Snapshot = { id: "x", meta: { ...meta, slides: [], sections: [], settings: { ...meta.settings, unit: "slide" } }, revision: null, claims: {}, polls: [] };
  assert.equal(messengerSummary(snapshot, "https://pick.example/b/x"), "Case 3\nPolls are open. Pick your name and vote.\nhttps://pick.example/b/x");
  assert.ok(injectPreview("<title>x</title>", snapshot, "https://pick.example").includes("Polls are open. Pick your name and vote."));
});

test("section boards rate sections and the loose slides between them", () => {
  assert.deepEqual(unitsOf(meta).map(unit => unit.id), ["s1", "x1", "s4", "x2", "s8"]);
  assert.deepEqual(unitsOf(meta)[3].slides, [5, 6, 7]);
});

test("sections and rosters parse from the lines people type", () => {
  assert.deepEqual(sectionsFrom("1-3 Introduction\n4–6: Results\n\n7 Conclusion\n8 to 9 Q&A").sections, [
    { from: 1, to: 3, title: "Introduction" }, { from: 4, to: 6, title: "Results" },
    { from: 7, to: 7, title: "Conclusion" }, { from: 8, to: 9, title: "Q&A" },
  ]);
  assert.notEqual(sectionsFrom("Introduction").error, null);
  const roster = rosterFrom("Ben\n  Ana  \nCy", [{ name: "Ana", color: COLORS[3].value }]);
  assert.deepEqual(roster.map(member => member.name), ["Ben", "Ana", "Cy"]);
  assert.equal(roster[1].color, COLORS[3].value);
  assert.equal(new Set(roster.map(member => member.color)).size, 3);
});

test("the biggest text on a PDF page becomes its title", () => {
  assert.equal(pickTitle([
    { str: "Source: notebook", height: 9, x: 40, y: 20 },
    { str: "What is", height: 32, x: 40, y: 500 },
    { str: "the deal?", height: 31, x: 160, y: 500 },
    { str: "Body text", height: 14, x: 40, y: 300 },
  ]), "What is the deal?");
  assert.equal(pickTitle([]), "");
});

test("PowerPoint titles come out in presentation order, not file order", () => {
  const ns = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const slide = (title: string, type = "title") => `<p:sld ${ns}><p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Body</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="${type}"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r><a:r><a:t>part two</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld></p:sld>`;
  const bytes = zipSync({
    "ppt/presentation.xml": strToU8(`<p:presentation ${ns}><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`),
    "ppt/_rels/presentation.xml.rels": strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Target="slides/slide1.xml"/><Relationship Id="rId3" Target="slides/slide2.xml"/></Relationships>`),
    "ppt/slides/slide1.xml": strToU8(slide("Second &amp; last")),
    "ppt/slides/slide2.xml": strToU8(slide("Opening", "ctrTitle")),
  });
  assert.deepEqual(pptxTitles(bytes, new DOMParser() as unknown as XmlParser), ["Opening part two", "Second & last part two"]);
  assert.throws(() => pptxTitles(zipSync({ "x.txt": strToU8("x") }), new DOMParser() as unknown as XmlParser));
});

test("link previews escape the board title", () => {
  const snapshot: Snapshot = { id: "x", meta: { ...meta, title: `"Bonds" <script>` }, revision: null, claims: { 1: "Ana" }, polls: [] };
  const html = injectPreview("<head><title>Pick your slides</title></head>", snapshot, "https://pick.example");
  assert.ok(html.includes("&#34;Bonds&#34; &#60;script&#62;"));
  assert.ok(html.includes('<meta property="og:image" content="https://pick.example/og.png">'));
  assert.ok(injectPreview("<title>x</title>", null, 'https://a.example/"><script>').includes("&#34;&#62;&#60;script&#62;/og.png"));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("1 of 8 slides claimed"));
});

test("names come out of a Messenger member list screenshot", async () => {
  const { namesFromOcr } = await import("../web/shared/parse.ts");
  const messenger = [
    "9:41", "< Members", "All Admins", "4 members", "@ Ana Cruz", "Admin", "Ben Santos", "Active now", "Cy Reyes",
    "Active 5m ago", "Added by Ana Cruz", "MARIA CLARA DELA PAZ", "You", "Juan Miguel O'Neil-Tan ®", "Add people",
    "2:14 PM", "Ana Cruz", "e Ben Santos · Admin", "See all", "Message", "lll", "Ana", "Group chat 2",
  ];
  assert.deepEqual(namesFromOcr(messenger), ["Ana Cruz", "Ben Santos", "Cy Reyes", "Maria Clara Dela Paz", "Juan Miguel O'Neil-Tan"]);
});

test("names come out of a Canvas group people page, skipping ones already entered", async () => {
  const { namesFromOcr } = await import("../web/shared/parse.ts");
  const canvas = [
    "People", "Group 4", "Search people", "Cruz, Ana", "Santos, Ben Student", "de la Rosa, Kim", "Section A-12",
    "Last activity Oct 30, 2026 at 9:12pm", "Total activity 12:03:44", "Unassigned Students", "Dashboard", "Reyes, Cy TA",
  ];
  assert.deepEqual(namesFromOcr(canvas, ["ana cruz", "Ben Santos"]), ["de la Rosa, Kim", "Reyes, Cy"]);
  assert.deepEqual(namesFromOcr(canvas).slice(0, 2), ["Cruz, Ana", "Santos, Ben"]);
  assert.equal(namesFromOcr(canvas, [], 2).length, 2);
  assert.deepEqual(namesFromOcr(canvas, Array.from({ length: 10 }, (_, index) => `Person ${index}`)), []);
});

test("short names use the first name, adding a last initial when it is shared", async () => {
  const { shortName } = await import("../web/shared/ui.ts");
  const roster = ["Ana Cruz", "Ana Reyes", "Ben Santos", "Cy", "Santos, Dee", "Maria Clara dela Paz"];
  assert.equal(shortName("Ben Santos", roster), "Ben");
  assert.equal(shortName("Ana Cruz", roster), "Ana C.");
  assert.equal(shortName("Ana Reyes", roster), "Ana R.");
  assert.equal(shortName("Cy", roster), "Cy");
  assert.equal(shortName("Santos, Dee", roster), "Dee");
  assert.equal(shortName("Maria Clara dela Paz", roster), "Maria");
});

test("a real Messenger dark-mode member list reads as five names", async () => {
  const { namesFromOcr } = await import("../web/shared/parse.ts");
  // Tesseract's output for a real screenshot, with the names changed and avatars read as stray letters
  const lines = ["Ana Reyes", "Joined with invite link", "Ben Cruz", "Added by Eli Navarro", "Cy Lim",
    "Added by Eli Navarro", "Dee Santos", "Joined with invite link", "a Eli Navarro", "a Group creator", ""];
  assert.deepEqual(namesFromOcr(lines), ["Ana Reyes", "Ben Cruz", "Cy Lim", "Dee Santos", "Eli Navarro"]);
  assert.deepEqual(namesFromOcr(["Left the group", "Created the group", "Someone with link", "Juan dela Cruz", "Anne van der Berg"]), ["Juan dela Cruz", "Anne van der Berg"]);
});

test("letter avatars read as initials are dropped from the front of names", async () => {
  const { namesFromOcr } = await import("../web/shared/parse.ts");
  assert.deepEqual(namesFromOcr(["A Ana Reyes", "BC Ben Cruz", "C Cy Santos", "Dee Lim", "J Cole Navarro", "Members · 4"]),
    ["Ana Reyes", "Ben Cruz", "Cy Santos", "Dee Lim", "J Cole Navarro"]);
});

test("a slide without a title placeholder takes its largest text box, then the topmost", () => {
  const ns = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const box = (text: string, y: number, size?: number, placeholder?: string) => `<p:sp><p:nvSpPr><p:nvPr>${placeholder ? `<p:ph type="${placeholder}"/>` : ""}</p:nvPr></p:nvSpPr>
    <p:spPr><a:xfrm><a:off x="0" y="${y}"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:rPr${size ? ` sz="${size}"` : ""}/><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
  const slide = (shapes: string) => `<p:sld ${ns}><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:sld>`;
  const slides = [
    slide(box("Body copy", 100, 1800) + box("About This Course", 900, 4000) + box("12", 5000, 6000, "sldNum")),
    slide(box("Lower note", 4000) + box("Agenda", 300)),
    slide(`<p:pic/>`),
  ];
  const bytes = zipSync({
    "ppt/presentation.xml": strToU8(`<p:presentation ${ns}><p:sldIdLst>${slides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`).join("")}</p:sldIdLst></p:presentation>`),
    "ppt/_rels/presentation.xml.rels": strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slides.map((_, index) => `<Relationship Id="rId${index + 1}" Target="slides/slide${index + 1}.xml"/>`).join("")}</Relationships>`),
    ...Object.fromEntries(slides.map((xml, index) => [`ppt/slides/slide${index + 1}.xml`, strToU8(xml)])),
  });
  assert.deepEqual(pptxTitles(bytes, new DOMParser() as unknown as XmlParser), ["About This Course", "Agenda", ""]);
});

test("a PDF of mostly portrait pages reads as a document", () => {
  const a4 = { width: 595, height: 842 };
  const wide = { width: 960, height: 540 };
  assert.equal(mostlyPortrait([a4, a4, wide]), true);
  assert.equal(mostlyPortrait([wide, wide, a4]), false);
  assert.equal(mostlyPortrait([a4, wide]), false);
  assert.equal(mostlyPortrait([]), false);
});
