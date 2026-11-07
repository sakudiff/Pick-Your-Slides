import assert from "node:assert/strict";
import test from "node:test";
import { COLORS, unitsOf, type Meta, type Unit } from "../web/shared/model.ts";
import { evenSplit } from "../web/shared/split.ts";

const slides = (count: number): Unit[] => Array.from({ length: count }, (_, index) => ({ id: `s${index + 1}`, label: "", title: "", slides: [index + 1] }));
const counts = (claims: Record<string, string>, roster: string[]) => roster.map(name => Object.values(claims).filter(owner => owner === name).length);
const runs = (claims: Record<string, string>, name: string) => {
  const mine = Object.keys(claims).map(Number).filter(slide => claims[slide] === name).sort((a, b) => a - b);
  return mine.filter((slide, index) => index === 0 || mine[index - 1] !== slide - 1).length;
};

test("an empty board splits into even, unbroken runs in roster order", () => {
  const result = evenSplit(slides(8), ["Ana", "Ben", "Cy"], {});
  assert.deepEqual(counts(result.claims, ["Ana", "Ben", "Cy"]), [3, 3, 2]);
  assert.deepEqual(result.added, { Ana: [1, 2, 3], Ben: [4, 5, 6], Cy: [7, 8] });
});

test("existing claims are kept and the open slides go to whoever has fewest", () => {
  const result = evenSplit(slides(8), ["Ana", "Ben", "Cy"], { 1: "Ana", 2: "Ana" });
  assert.equal(result.claims[1], "Ana");
  assert.equal(result.claims[2], "Ana");
  assert.deepEqual(counts(result.claims, ["Ana", "Ben", "Cy"]), [2, 3, 3]);
  assert.deepEqual(result.added.Ana, []);
  for (const name of ["Ben", "Cy"]) assert.equal(runs(result.claims, name), 1);
});

test("someone already over their share gets nothing more and the rest level out", () => {
  const result = evenSplit(slides(6), ["Ana", "Ben", "Cy"], { 1: "Ana", 2: "Ana", 3: "Ana", 4: "Ana" });
  assert.deepEqual(counts(result.claims, ["Ana", "Ben", "Cy"]), [4, 1, 1]);
  assert.deepEqual(result.added, { Ana: [], Ben: [5], Cy: [6] });
});

test("more people than slides leaves the later people with none", () => {
  const result = evenSplit(slides(2), ["Ana", "Ben", "Cy"], {});
  assert.deepEqual(counts(result.claims, ["Ana", "Ben", "Cy"]), [1, 1, 0]);
});

test("a fully claimed board changes nothing", () => {
  const claims = { 1: "Ana", 2: "Ben" };
  assert.deepEqual(evenSplit(slides(2), ["Ana", "Ben"], claims).claims, claims);
});

test("section boards hand out whole sections, never part of one", () => {
  const meta: Meta = {
    title: "Pitch", slides: Array.from({ length: 8 }, () => ({ title: "" })),
    sections: [{ title: "Intro", from: 1, to: 2 }, { title: "Body", from: 3, to: 6 }, { title: "End", from: 7, to: 8 }],
    roster: [{ name: "Ana", color: COLORS[0].value }, { name: "Ben", color: COLORS[1].value }],
    settings: { unit: "section", membersCanPoll: true, presentationDate: null }, deckUrl: null, thumbs: null, createdAt: "",
  };
  // Ben holds slide 4, so he gets the rest of Body, and Ana levels up with Intro and End
  const result = evenSplit(unitsOf(meta), ["Ana", "Ben"], { 4: "Ben" });
  assert.deepEqual(result.added, { Ana: [1, 2, 7, 8], Ben: [3, 5, 6] });
  assert.deepEqual([3, 4, 5, 6].map(slide => result.claims[slide]), ["Ben", "Ben", "Ben", "Ben"]);
});
