import assert from "node:assert/strict";
import test from "node:test";
import { handleBoard, handleCreate, purge } from "../server/board.ts";
import { COLORS, type BoardInput, type Snapshot } from "../web/shared/model.ts";
import { memoryKV } from "./memory-kv.ts";

const ORIGIN = "https://pick.example";
const DAY = 86_400_000;

function boardInput(overrides: Partial<BoardInput> = {}): BoardInput {
  return {
    title: "Case 2 · Bond Offering",
    slides: Array.from({ length: 6 }, (_, index) => ({ title: `Slide title ${index + 1}` })),
    sections: [{ title: "Opening", from: 1, to: 2 }, { title: "Analysis", from: 3, to: 6 }],
    roster: [{ name: "Ana", color: COLORS[0].value }, { name: "Ben", color: COLORS[1].value }, { name: "Cy", color: COLORS[2].value }],
    settings: { unit: "slide", membersCanPoll: true, presentationDate: null },
    deckUrl: null,
    ...overrides,
  };
}

function post(path: string, body: unknown, token: string | null = null): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json", Origin: ORIGIN };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

async function setup(kv = memoryKV(), overrides: Partial<BoardInput> = {}, thumbs = false) {
  const response = await handleCreate(post("/api/boards", { board: boardInput(overrides), thumbs }), kv);
  assert.equal(response.status, 201);
  const { id, token } = await response.json() as { id: string; token: string };
  const send = async (change: unknown, auth: string | null = null) => {
    const reply = await handleBoard(post(`/api/boards/${id}`, change, auth), kv);
    return { status: reply.status, body: await reply.json() as Snapshot & { error?: string } };
  };
  const read = async () => (await (await handleBoard(new Request(`${ORIGIN}/api/boards/${id}`), kv)).json()) as Snapshot;
  return { kv, id, token, send, read };
}

test("a created board is readable without its organizer secret", async () => {
  const { kv, id } = await setup();
  const response = await handleBoard(new Request(`${ORIGIN}/api/boards/${id}`), kv);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json() as Snapshot & Record<string, unknown>;
  assert.equal(body.meta.slides.length, 6);
  assert.equal("adminHash" in body.meta, false);
  assert.deepEqual(body.claims, {});
});

test("members claim and release their own slides only", async () => {
  const { send, read } = await setup();
  assert.equal((await send({ kind: "claim", slide: 1, name: "Ana" })).status, 200);
  assert.equal((await send({ kind: "claim", slide: 1, name: "Ben" })).status, 409);
  const stolen = await send({ kind: "release", slide: 1, name: "Ben" });
  assert.equal(stolen.status, 409);
  assert.deepEqual(stolen.body.claims, { "1": "Ana" });
  assert.equal((await send({ kind: "release", slide: 1, name: "Ana" })).status, 200);
  assert.deepEqual((await read()).claims, {});
});

test("simultaneous claims on different slides both land, on the same slide one wins", async () => {
  const { send, read } = await setup();
  const different = await Promise.all([
    send({ kind: "claim", slide: 1, name: "Ana" }), send({ kind: "claim", slide: 2, name: "Ben" }), send({ kind: "claim", slide: 3, name: "Cy" }),
  ]);
  assert.deepEqual(different.map(reply => reply.status), [200, 200, 200]);
  assert.deepEqual((await read()).claims, { "1": "Ana", "2": "Ben", "3": "Cy" });
  const same = await Promise.all([send({ kind: "claim", slide: 4, name: "Ana" }), send({ kind: "claim", slide: 4, name: "Ben" })]);
  assert.deepEqual(same.map(reply => reply.status).sort(), [200, 409]);
  assert.ok(["Ana", "Ben"].includes((await read()).claims["4"]));
});

test("only the organizer clears claims, applies splits and edits the board", async () => {
  const { send, token } = await setup();
  await send({ kind: "claim", slide: 2, name: "Ana" });
  assert.equal((await send({ kind: "clear", slide: 2 })).status, 403);
  assert.equal((await send({ kind: "clear", slide: 2 }, "wrong-token")).status, 403);
  assert.equal((await send({ kind: "apply", claims: { "1": "Ben" } })).status, 403);
  const cleared = await send({ kind: "clear", slide: 2 }, token);
  assert.equal(cleared.status, 200);
  assert.deepEqual(cleared.body.claims, {});
  const applied = await send({ kind: "apply", claims: { "1": "Ben", "2": "Ben", "3": "Cy" } }, token);
  assert.deepEqual(applied.body.claims, { "1": "Ben", "2": "Ben", "3": "Cy" });
  assert.equal((await send({ kind: "apply", claims: { "9": "Ben" } }, token)).status, 400);
});

test("editing the board refuses stale revisions and drops claims that no longer fit", async () => {
  const { send, read, token } = await setup();
  await send({ kind: "claim", slide: 6, name: "Ana" });
  await send({ kind: "claim", slide: 1, name: "Ben" });
  const { revision } = await read();
  const shorter = boardInput({ slides: boardInput().slides.slice(0, 4), sections: [], roster: [boardInput().roster[0], boardInput().roster[2]] });
  const saved = await send({ kind: "meta", board: shorter, revision, thumbs: null }, token);
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.claims, {});
  assert.equal(saved.body.meta.slides.length, 4);
  const stale = await send({ kind: "meta", board: boardInput(), revision, thumbs: null }, token);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.meta.slides.length, 4);
});

test("ratings are gone, so a prefs change is refused", async () => {
  const { send } = await setup();
  const refused = await send({ kind: "prefs", name: "Ana", ratings: { s1: 2 } });
  assert.equal(refused.status, 400);
  assert.equal("prefs" in refused.body, false);
});

const q = (question: string, options: string[], multi = false) => ({ question, options, multi });

test("polls take single and multiple votes, and close", async () => {
  const { send, token } = await setup();
  const started = await send({ kind: "poll", name: "Ana", title: "", questions: [q("When do we practice?", ["Mon", "Tue", "Wed"])] });
  assert.equal(started.status, 200);
  assert.equal(started.body.polls[0].title, "When do we practice?");
  const poll = started.body.polls[0].id;
  await Promise.all([send({ kind: "vote", poll, name: "Ana", question: 0, choices: [0] }), send({ kind: "vote", poll, name: "Ben", question: 0, choices: [1] })]);
  assert.equal((await send({ kind: "vote", poll, name: "Cy", question: 0, choices: [0, 1] })).status, 400);
  assert.equal((await send({ kind: "vote", poll, name: "Cy", question: 0, choices: [5] })).status, 400);
  assert.equal((await send({ kind: "vote", poll, name: "Cy", question: 1, choices: [0] })).status, 400);
  const voted = await send({ kind: "vote", poll, name: "Ana", question: 0, choices: [] });
  assert.deepEqual(voted.body.polls[0].votes, { Ben: [[1]] });
  assert.equal((await send({ kind: "closePoll", poll, closed: true })).status, 403);
  await send({ kind: "closePoll", poll, closed: true }, token);
  assert.equal((await send({ kind: "vote", poll, name: "Cy", question: 0, choices: [2] })).status, 409);
  const multi = await send({ kind: "poll", name: "Ben", title: "Templates", questions: [q("Which templates?", ["A", "B"], true)] });
  const second = multi.body.polls[1].id;
  assert.deepEqual((await send({ kind: "vote", poll: second, name: "Cy", question: 0, choices: [0, 1, 1] })).body.polls[1].votes, { Cy: [[0, 1]] });
  assert.equal((await send({ kind: "deletePoll", poll: second }, token)).body.polls.length, 1);
});

test("one poll can ask several questions, each answered on its own", async () => {
  const { send } = await setup();
  const started = await send({ kind: "poll", name: "Ana", title: "Before Friday", questions: [
    q("When do we practise?", ["Mon", "Tue"]), q("Which template?", ["Clean", "Bold", "Retro"], true), q("Who presents first?", ["Ana", "Ben"]),
  ] });
  assert.equal(started.status, 200);
  const poll = started.body.polls[0];
  assert.equal(poll.title, "Before Friday");
  assert.equal(poll.questions.length, 3);
  await send({ kind: "vote", poll: poll.id, name: "Ben", question: 1, choices: [0, 2] });
  const after = await send({ kind: "vote", poll: poll.id, name: "Ben", question: 0, choices: [1] });
  assert.deepEqual(after.body.polls[0].votes, { Ben: [[1], [0, 2], []] });
  const cleared = await send({ kind: "vote", poll: poll.id, name: "Ben", question: 0, choices: [] });
  assert.deepEqual(cleared.body.polls[0].votes, { Ben: [[], [0, 2], []] });
  const gone = await send({ kind: "vote", poll: poll.id, name: "Ben", question: 1, choices: [] });
  assert.deepEqual(gone.body.polls[0].votes, {});
});

test("poll limits hold: questions, options and title length", async () => {
  const { send } = await setup();
  const six = Array.from({ length: 6 }, (_, index) => q(`Q${index}?`, ["A", "B"]));
  assert.equal((await send({ kind: "poll", name: "Ana", title: "", questions: six })).status, 400);
  assert.equal((await send({ kind: "poll", name: "Ana", title: "", questions: [] })).status, 400);
  assert.equal((await send({ kind: "poll", name: "Ana", title: "", questions: [q("One option?", ["A"])] })).status, 400);
  assert.equal((await send({ kind: "poll", name: "Ana", title: "x".repeat(121), questions: [q("Ok?", ["A", "B"])] })).status, 400);
  // the old single-question request shape is no longer accepted
  assert.equal((await send({ kind: "poll", name: "Ana", question: "Old?", options: ["A", "B"], multi: false })).status, 400);
});

test("polls stored before several questions existed still show and take votes", async () => {
  const { kv, id, send } = await setup();
  await kv.putJSON(`${id}/polls/legacy0001`, {
    id: "legacy0001", question: "When?", options: ["Mon", "Tue"], multi: false, closed: false,
    createdBy: "Ana", createdAt: "2026-11-01T00:00:00.000Z", votes: { Ana: [1], Zed: [0] },
  }, { onlyIfNew: true });
  const before = await send({ kind: "claim", slide: 1, name: "Ana" });
  const legacy = before.body.polls.find(poll => poll.id === "legacy0001")!;
  assert.equal(legacy.title, "When?");
  assert.deepEqual(legacy.questions, [{ question: "When?", options: ["Mon", "Tue"], multi: false }]);
  assert.deepEqual(legacy.votes, { Ana: [[1]] });
  const voted = await send({ kind: "vote", poll: "legacy0001", name: "Ben", question: 0, choices: [0] });
  assert.deepEqual(voted.body.polls.find(poll => poll.id === "legacy0001")!.votes, { Ana: [[1]], Ben: [[0]] });
  const stored = (await kv.getJSON(`${id}/polls/legacy0001`))!.data as { questions?: unknown };
  assert.ok(Array.isArray(stored.questions), "a vote rewrites the old poll in the new shape");
});

test("a board can reserve polls for the organizer", async () => {
  const { send, token } = await setup(memoryKV(), { settings: { unit: "slide", membersCanPoll: false, presentationDate: null } });
  const poll = { kind: "poll", name: "Ana", title: "", questions: [q("Topic?", ["A", "B"])] };
  assert.equal((await send(poll)).status, 403);
  assert.equal((await send(poll, token)).status, 200);
});

test("requests outside the contract are refused", async () => {
  const { kv, id, send } = await setup();
  assert.equal((await handleCreate(post("/api/boards", { board: boardInput({ slides: [] }) }), kv)).status, 400);
  assert.equal((await handleCreate(post("/api/boards", { board: boardInput({ roster: [{ name: "Ana", color: "red" }] }) }), kv)).status, 400);
  assert.equal((await handleCreate(post("/api/boards", { board: boardInput({ sections: [{ title: "x", from: 3, to: 9 }] }) }), kv)).status, 400);
  assert.equal((await handleCreate(new Request(`${ORIGIN}/api/boards`), kv)).status, 405);
  for (const change of [{ kind: "claim", slide: 0, name: "Ana" }, { kind: "claim", slide: 1.5, name: "Ana" }, { kind: "claim", slide: 1, name: "Zed" }, { kind: "nope" }]) {
    assert.equal((await send(change)).status, 400);
  }
  const broken = new Request(`${ORIGIN}/api/boards/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{broken" });
  assert.equal((await handleBoard(broken, kv)).status, 400);
  const text = new Request(`${ORIGIN}/api/boards/${id}`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" });
  assert.equal((await handleBoard(text, kv)).status, 415);
  const foreign = post(`/api/boards/${id}`, { kind: "claim", slide: 1, name: "Ana" });
  foreign.headers.set("Origin", "https://other.example");
  assert.equal((await handleBoard(foreign, kv)).status, 403);
  assert.equal((await handleBoard(post(`/api/boards/${id}`, { text: "x".repeat(70_000) }), kv)).status, 413);
  assert.equal((await handleBoard(new Request(`${ORIGIN}/api/boards/zzzzzzzzzz`), kv)).status, 404);
  assert.equal((await handleBoard(new Request(`${ORIGIN}/api/boards/../meta`), kv)).status, 404);
  assert.equal((await handleBoard(new Request(`${ORIGIN}/api/boards/${id}`, { method: "PUT" }), kv)).status, 405);
  const retried = post(`/api/boards/${id}/index.html`, { kind: "clear", slide: 1 });
  assert.equal((await handleBoard(retried, kv)).status, 403);
});

test("slide images are organizer-only JPEGs and are replaced on re-import", async () => {
  const { kv, id, token, send, read } = await setup(memoryKV(), {}, true);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const put = (slide: number, body: Uint8Array<ArrayBuffer>, auth: string | null, type = "image/jpeg") => handleBoard(new Request(`${ORIGIN}/api/boards/${id}/thumbs/${slide}`, {
    method: "PUT", headers: { "Content-Type": type, ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body,
  }), kv);
  assert.equal((await put(1, jpeg, null)).status, 403);
  assert.equal((await put(1, new Uint8Array([1, 2, 3]), token)).status, 415);
  assert.equal((await put(1, jpeg, token, "image/png")).status, 415);
  assert.equal((await put(9, jpeg, token)).status, 404);
  assert.equal((await put(1, jpeg, token)).status, 204);
  assert.equal((await put(5, jpeg, token)).status, 204);
  const image = await handleBoard(new Request(`${ORIGIN}/api/boards/${id}/thumbs/1`), kv);
  assert.equal(image.headers.get("Content-Type"), "image/jpeg");
  assert.deepEqual(new Uint8Array(await image.arrayBuffer()), jpeg);
  assert.equal((await handleBoard(new Request(`${ORIGIN}/api/boards/${id}/thumbs/2`), kv)).status, 404);
  const { revision, meta } = await read();
  const four = boardInput({ slides: boardInput().slides.slice(0, 4), sections: [] });
  assert.equal((await send({ kind: "meta", board: four, revision, thumbs: meta.thumbs }, token)).status, 200);
  assert.deepEqual(await kv.keys(`${id}/thumbs/`), [`${id}/thumbs/1`]);
  const next = await read();
  assert.equal((await send({ kind: "meta", board: four, revision: next.revision, thumbs: Date.now() + 1 }, token)).status, 200);
  assert.deepEqual(await kv.keys(`${id}/thumbs/`), []);
});

test("the local storage sandbox without ETags still saves", async () => {
  const { send, read, token } = await setup(memoryKV(false));
  await send({ kind: "claim", slide: 1, name: "Ana" });
  await send({ kind: "claim", slide: 2, name: "Ben" });
  const { revision } = await read();
  assert.equal(revision, null);
  assert.equal((await send({ kind: "meta", board: boardInput({ title: "Renamed" }), revision, thumbs: null }, token)).body.meta.title, "Renamed");
  assert.deepEqual((await read()).claims, { "1": "Ana", "2": "Ben" });
});

test("deleting a board removes every key it owns", async () => {
  const { kv, id, token, send } = await setup();
  const other = await setup(kv);
  await send({ kind: "claim", slide: 1, name: "Ana" });
  // boards from before ratings were removed may still hold a ratings blob, which goes with the board
  await kv.putJSON(`${id}/prefs/legacy`, { name: "Ana", ratings: { s1: 2 } }, {});
  await send({ kind: "poll", name: "Ana", title: "", questions: [q("Q?", ["A", "B"])] });
  const remove = (auth: string | null) => handleBoard(new Request(`${ORIGIN}/api/boards/${id}`, { method: "DELETE", headers: auth ? { Authorization: `Bearer ${auth}` } : {} }), kv);
  assert.equal((await remove(null)).status, 403);
  assert.equal((await remove(token)).status, 204);
  assert.deepEqual(await kv.keys(`${id}/`), []);
  assert.ok((await kv.keys(`${other.id}/`)).length > 0);
});

test("the cleanup job deletes idle boards and old slide images, and keeps active ones", async () => {
  const kv = memoryKV();
  const idle = await setup(kv);
  const active = await setup(kv, { settings: { unit: "slide", membersCanPoll: true, presentationDate: "2026-01-10" } }, true);
  await idle.send({ kind: "claim", slide: 1, name: "Ana" });
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0]);
  await handleBoard(new Request(`${ORIGIN}/api/boards/${active.id}/thumbs/1`, { method: "PUT", headers: { "Content-Type": "image/jpeg", Authorization: `Bearer ${active.token}` }, body: jpeg }), kv);
  await kv.putJSON(`${idle.id}/touch`, { lastActive: new Date(Date.now() - 91 * DAY).toISOString() }, {});
  await kv.putJSON("orphan/claims", {}, {});

  const upcoming = await setup(kv, { settings: { unit: "slide", membersCanPoll: true, presentationDate: "2099-01-01" } }, true);
  const early = await purge(kv);
  assert.equal(early.boards, 2);
  assert.deepEqual(await kv.keys(`${idle.id}/`), []);
  assert.deepEqual(await kv.keys("orphan/"), []);
  assert.equal((await active.read()).meta.thumbs, null);
  assert.deepEqual(await kv.keys(`${active.id}/thumbs/`), []);
  assert.ok((await kv.keys(`${active.id}/`)).includes(`${active.id}/meta`));
  assert.notEqual((await upcoming.read()).meta.thumbs, null);

  const later = await purge(kv, Date.now() + 89 * DAY);
  assert.equal(later.boards, 0);
  assert.equal((await purge(kv, Date.now() + 91 * DAY)).boards, 2);
});

test("the presenter feed is public to any origin and holds only title, count, claims and roster", async () => {
  const { kv, id, send, token } = await setup();
  await send({ kind: "claim", slide: 2, name: "Ben" });
  await send({ kind: "poll", name: "Ana", title: "", questions: [q("When?", ["Mon", "Tue"])] }, token);
  const response = await handleBoard(new Request(`${ORIGIN}/api/boards/${id}/presenters`, { headers: { Origin: "https://deck.example.org" } }), kv);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  const body = await response.json() as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ["claims", "roster", "slides", "title"]);
  assert.deepEqual(body.claims, { "2": "Ben" });
  assert.equal(body.slides, 6);
  assert.deepEqual(Object.keys((body.roster as object[])[0]).sort(), ["color", "name"]);
  assert.ok(!JSON.stringify(body).includes("adminHash"));
  const write = await handleBoard(new Request(`${ORIGIN}/api/boards/${id}/presenters`, { method: "POST" }), kv);
  assert.equal(write.status, 405);
  assert.equal(write.headers.get("Access-Control-Allow-Origin"), "*");
});
