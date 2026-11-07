import assert from "node:assert/strict";
import test from "node:test";
import { forgetBoard, listBoards, openedAgo, rememberBoard, type KeyStore } from "../web/shared/boards.ts";

function memoryStore(initial: Record<string, string> = {}): KeyStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get length() { return data.size; },
    key: index => [...data.keys()][index] ?? null,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: key => { data.delete(key); },
  };
}

const A = "abcdefghjk";
const B = "mnpqrstvwx";
const C = "0123456789";

test("boards made before the list existed are found from the keys they left", () => {
  const store = memoryStore({
    [`pys-admin-${A}`]: "secret",
    [`pys-board-${A}`]: JSON.stringify({ meta: { title: "Product Launch Pitch" } }),
    [`pys-name-${B}`]: "Ana",
    "pys-theme": "dark",
    "pys-name-not-an-id": "x",
  });
  const boards = listBoards(store);
  assert.deepEqual(boards.map(board => [board.id, board.title, board.role]).sort(), [
    [A, "Product Launch Pitch", "organizer"], [B, "Untitled board", "member"],
  ]);
  assert.ok(store.data.has("pys-boards"));
});

test("opening a board puts it first, and the organizer secret decides the role", () => {
  const store = memoryStore();
  rememberBoard(store, A, "Pitch", 1000);
  rememberBoard(store, B, "Report", 2000);
  assert.deepEqual(listBoards(store).map(board => board.id), [B, A]);
  rememberBoard(store, A, "Pitch, renamed", 3000);
  assert.deepEqual(listBoards(store).map(board => [board.id, board.title]), [[A, "Pitch, renamed"], [B, "Report"]]);
  assert.equal(listBoards(store)[0].role, "member");
  store.setItem(`pys-admin-${A}`, "secret");
  assert.equal(listBoards(store)[0].role, "organizer");
  rememberBoard(store, "bad id", "x");
  assert.equal(listBoards(store).length, 2);
});

test("forgetting a board removes it and its keys from this device only", () => {
  const store = memoryStore({ [`pys-admin-${C}`]: "s", [`pys-name-${C}`]: "Ana", [`pys-board-${C}`]: "{}" });
  rememberBoard(store, C, "Pitch");
  rememberBoard(store, A, "Other");
  forgetBoard(store, C);
  assert.deepEqual(listBoards(store).map(board => board.id), [A]);
  for (const key of [`pys-admin-${C}`, `pys-name-${C}`, `pys-board-${C}`]) assert.equal(store.getItem(key), null);
});

test("a broken list is rebuilt instead of crashing the page", () => {
  const store = memoryStore({ "pys-boards": "{not json", [`pys-name-${A}`]: "Ana" });
  assert.deepEqual(listBoards(store).map(board => board.id), [A]);
});

test("open times read as short relative phrases", () => {
  const now = Date.parse("2026-11-06T12:00:00Z");
  assert.equal(openedAgo(0, now), "opened earlier");
  assert.equal(openedAgo(now - 20_000, now), "opened just now");
  assert.equal(openedAgo(now - 5 * 60_000, now), "opened 5 minutes ago");
  assert.equal(openedAgo(now - 3 * 3_600_000, now), "opened 3 hours ago");
  assert.equal(openedAgo(now - 86_400_000, now), "opened yesterday");
});
