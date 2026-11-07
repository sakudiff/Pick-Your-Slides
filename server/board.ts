import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  boardError, cleanBoard, isAdminChange, isRecord, isSlideNumber, normalizePoll, parseChange, pruneClaims, prunePoll,
  LIMITS, type BoardInput, type Change, type Meta, type Poll, type Snapshot,
} from "../web/shared/model.ts";
import { conditionFor, type KV } from "./kv.ts";

type StoredMeta = Meta & { adminHash: string };

const BODY_LIMIT = 65536;
const THUMB_LIMIT = 150_000;
const DAY = 86_400_000;
export const IDLE_DAYS = 90;
export const THUMB_DAYS_AFTER_PRESENTING = 30;

const key = {
  meta: (id: string) => `${id}/meta`,
  claims: (id: string) => `${id}/claims`,
  touch: (id: string) => `${id}/touch`,
  poll: (id: string, poll: string) => `${id}/polls/${poll}`,
  thumb: (id: string, slide: number) => `${id}/thumbs/${slide}`,
};

class Refusal {
  readonly status: number;
  readonly error: string;
  constructor(status: number, error: string) {
    this.status = status;
    this.error = error;
  }
}

function respond(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
export function newId(length = 10): string {
  return [...randomBytes(length)].map(byte => ALPHABET[byte & 31]).join("");
}

export function isBoardId(value: string): boolean {
  return /^[0-9a-hjkmnp-tv-z]{10}$/.test(value);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isOrganizer(request: Request, meta: StoredMeta): boolean {
  const header = request.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const given = Buffer.from(hashToken(header.slice(7)), "hex");
  const stored = Buffer.from(meta.adminHash, "hex");
  return given.length === stored.length && timingSafeEqual(given, stored);
}

function publicMeta(meta: StoredMeta): Meta {
  const { adminHash: _, ...rest } = meta;
  return rest;
}

async function readMeta(kv: KV, id: string): Promise<{ meta: StoredMeta; etag: string | null } | null> {
  const entry = await kv.getJSON(key.meta(id));
  return entry ? { meta: entry.data as StoredMeta, etag: entry.etag } : null;
}

export async function readSnapshot(kv: KV, id: string): Promise<Snapshot | null> {
  const [stored, claims, pollKeys] = await Promise.all([readMeta(kv, id), kv.getJSON(key.claims(id)), kv.keys(`${id}/polls/`)]);
  if (!stored) return null;
  const meta = publicMeta(stored.meta);
  const pollEntries = await Promise.all(pollKeys.map(pollKey => kv.getJSON(pollKey)));
  const polls = pollEntries.flatMap(entry => {
    const poll = entry ? normalizePoll(entry.data) : null;
    return poll ? [prunePoll(meta, poll)] : [];
  })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { id, meta, revision: stored.etag, claims: pruneClaims(meta, claims?.data ?? {}), polls };
}

// Reads, applies and writes one key, retrying when someone else wrote it in between.
async function mutate(kv: KV, target: string, apply: (current: unknown) => unknown): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const entry = await kv.getJSON(target);
    const next = apply(entry?.data ?? null);
    if (await kv.putJSON(target, next, conditionFor(entry))) return;
  }
  throw new Refusal(409, "Too many people saved at the same time. Try again.");
}

async function touch(kv: KV, id: string): Promise<void> {
  await kv.putJSON(key.touch(id), { lastActive: new Date().toISOString() }, {});
}

async function readJSONBody(request: Request): Promise<unknown> {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) throw new Refusal(403, "Use the board page to save changes.");
  if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") {
    throw new Refusal(415, "Send a JSON change.");
  }
  const text = await request.text();
  if (text.length > BODY_LIMIT) throw new Refusal(413, "The change is too long.");
  try {
    return JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Refusal(400, "The change could not be read.");
  }
}

export async function handleCreate(request: Request, kv: KV): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  try {
    const value = await readJSONBody(request);
    const board = isRecord(value) ? value.board : undefined;
    const error = boardError(board);
    if (error) return respond({ error }, 400);
    const id = newId();
    const token = randomBytes(16).toString("base64url");
    const meta: StoredMeta = {
      ...cleanBoard(board as BoardInput), thumbs: isRecord(value) && value.thumbs === true ? Date.now() : null,
      createdAt: new Date().toISOString(), adminHash: hashToken(token),
    };
    if (!await kv.putJSON(key.meta(id), meta, { onlyIfNew: true })) return respond({ error: "Try creating the board again." }, 409);
    await touch(kv, id);
    return respond({ id, token }, 201);
  } catch (error) {
    if (error instanceof Refusal) return respond({ error: error.error }, error.status);
    throw error;
  }
}

async function applyChange(kv: KV, id: string, stored: { meta: StoredMeta; etag: string | null }, change: Change, organizer: boolean): Promise<void> {
  const meta = publicMeta(stored.meta);
  switch (change.kind) {
    case "claim":
    case "release":
    case "clear":
      return mutate(kv, key.claims(id), current => {
        const claims = pruneClaims(meta, current);
        const owner = claims[change.slide];
        if (change.kind === "claim") {
          if (owner && owner !== change.name) throw new Refusal(409, `Slide ${change.slide} belongs to ${owner}. Ask them or the organizer to free it.`);
          claims[change.slide] = change.name;
        } else if (change.kind === "release") {
          if (owner !== change.name) throw new Refusal(409, `Slide ${change.slide} is not yours to release.`);
          delete claims[change.slide];
        } else delete claims[change.slide];
        return claims;
      });
    case "apply":
      return mutate(kv, key.claims(id), () => change.claims);
    case "poll": {
      if (!organizer && !meta.settings.membersCanPoll) throw new Refusal(403, "Only the organizer can start polls on this board.");
      if ((await kv.keys(`${id}/polls/`)).length >= LIMITS.polls) throw new Refusal(409, `A board holds at most ${LIMITS.polls} polls.`);
      const poll: Poll = {
        id: newId(8), title: change.title, questions: change.questions, closed: false,
        createdBy: change.name, createdAt: new Date().toISOString(), votes: {},
      };
      if (!await kv.putJSON(key.poll(id, poll.id), poll, { onlyIfNew: true })) throw new Refusal(409, "Try starting the poll again.");
      return;
    }
    case "vote":
    case "closePoll":
      return mutate(kv, key.poll(id, change.poll), stored => {
        const current = normalizePoll(stored);
        if (!current) throw new Refusal(404, "That poll no longer exists.");
        if (change.kind === "closePoll") return { ...current, closed: change.closed };
        if (current.closed) throw new Refusal(409, "This poll is closed.");
        const question = current.questions[change.question];
        if (!question || change.choices.some(choice => choice >= question.options.length) || (!question.multi && change.choices.length > 1)) {
          throw new Refusal(400, "Choose from the poll's options.");
        }
        const answers = current.questions.map((_, index) => current.votes[change.name]?.[index] ?? []);
        answers[change.question] = change.choices;
        const votes = { ...current.votes };
        if (answers.every(choices => choices.length === 0)) delete votes[change.name];
        else votes[change.name] = answers;
        return { ...current, votes };
      });
    case "deletePoll":
      return kv.delete(key.poll(id, change.poll));
    case "meta": {
      if (change.revision !== stored.etag) throw new Refusal(409, "Someone else edited the board. It is refreshed now, review and save again.");
      const next: StoredMeta = { ...stored.meta, ...change.board, thumbs: change.thumbs };
      if (!await kv.putJSON(key.meta(id), next, conditionFor({ data: stored.meta, etag: stored.etag }))) {
        throw new Refusal(409, "Someone else edited the board. It is refreshed now, review and save again.");
      }
      await mutate(kv, key.claims(id), current => pruneClaims(next, current));
      const keep = next.thumbs === stored.meta.thumbs ? next.slides.length : 0;
      const stale = (await kv.keys(`${id}/thumbs/`)).filter(thumb => Number(thumb.split("/").at(-1)) > keep);
      await Promise.all(stale.map(thumb => kv.delete(thumb)));
      return;
    }
  }
}

async function deleteBoard(kv: KV, id: string): Promise<void> {
  const keys = await kv.keys(`${id}/`);
  // meta goes last, so a half-finished delete still leaves a board the cleanup job can find
  await Promise.all(keys.filter(entry => entry !== key.meta(id)).map(entry => kv.delete(entry)));
  await kv.delete(key.meta(id));
}

async function handleThumb(request: Request, kv: KV, id: string, slide: number, stored: StoredMeta): Promise<Response> {
  if (!isSlideNumber(stored, slide)) return new Response(null, { status: 404 });
  if (request.method === "GET") {
    const bytes = await kv.getBytes(key.thumb(id, slide));
    if (!bytes) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    return new Response(bytes, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" } });
  }
  if (request.method !== "PUT") return new Response(null, { status: 405, headers: { Allow: "GET, PUT" } });
  if (!isOrganizer(request, stored)) return respond({ error: "Only the organizer can upload slide images." }, 403);
  if (request.headers.get("Content-Type") !== "image/jpeg") return respond({ error: "Send a JPEG image." }, 415);
  const bytes = await request.arrayBuffer();
  const head = new Uint8Array(bytes.slice(0, 3));
  if (bytes.byteLength > THUMB_LIMIT) return respond({ error: "The image is too large." }, 413);
  if (head[0] !== 0xff || head[1] !== 0xd8 || head[2] !== 0xff) return respond({ error: "Send a JPEG image." }, 415);
  await kv.putBytes(key.thumb(id, slide), bytes);
  await touch(kv, id);
  return new Response(null, { status: 204 });
}

// Read by the presenter bar on decks hosted anywhere, so it is open to every origin and carries only
// what the bar draws: no organizer data, ratings or polls.
async function handlePresenters(request: Request, kv: KV, id: string, stored: StoredMeta): Promise<Response> {
  const headers = { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=5" };
  if (request.method !== "GET") return new Response(null, { status: 405, headers: { ...headers, Allow: "GET" } });
  const meta = publicMeta(stored);
  const claims = pruneClaims(meta, (await kv.getJSON(key.claims(id)))?.data ?? {});
  return Response.json({
    title: meta.title, slides: meta.slides.length, claims,
    roster: meta.roster.map(({ name, color }) => ({ name, color })),
  }, { headers });
}

export async function handleBoard(request: Request, kv: KV): Promise<Response> {
  // netlify dev retries a 403 or 404 at path.html and path/index.html, so those resolve to the same route
  const pathname = new URL(request.url).pathname.replace(/(?:\/index)?\.html?$/, "");
  const path = pathname.match(/^\/api\/boards\/([^/]+)(?:\/thumbs\/(\d+)|\/(presenters))?\/?$/);
  if (!path || !isBoardId(path[1])) return respond({ error: "There is no board at this address." }, 404);
  const id = path[1];
  const stored = await readMeta(kv, id);
  if (!stored) return respond({ error: "There is no board at this address. Boards are deleted after 90 days without changes." }, 404);
  if (path[2] !== undefined) return handleThumb(request, kv, id, Number(path[2]), stored.meta);
  if (path[3] !== undefined) return handlePresenters(request, kv, id, stored.meta);

  if (request.method === "GET") return respond(await readSnapshot(kv, id));
  if (request.method === "DELETE") {
    if (!isOrganizer(request, stored.meta)) return respond({ error: "Only the organizer can delete the board." }, 403);
    await deleteBoard(kv, id);
    return new Response(null, { status: 204 });
  }
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "GET, POST, DELETE" } });
  try {
    const change = parseChange(await readJSONBody(request), publicMeta(stored.meta));
    if (!change) return respond({ ...await readSnapshot(kv, id), error: "That change does not fit this board." }, 400);
    const organizer = isOrganizer(request, stored.meta);
    if (isAdminChange(change) && !organizer) return respond({ error: "Only the organizer can do that." }, 403);
    await applyChange(kv, id, stored, change, organizer);
    // the activity stamp and the reply's reads do not depend on each other
    const [, snapshot] = await Promise.all([touch(kv, id), readSnapshot(kv, id)]);
    return respond(snapshot);
  } catch (error) {
    if (error instanceof Refusal) return respond({ ...await readSnapshot(kv, id), error: error.error }, error.status);
    throw error;
  }
}

// Deletes boards idle past IDLE_DAYS, and slide images once the presentation is long over.
export async function purge(kv: KV, now = Date.now()): Promise<{ boards: number; thumbs: number }> {
  let boards = 0;
  let thumbs = 0;
  for (const id of await kv.folders()) {
    const [activity, stored] = await Promise.all([kv.getJSON(key.touch(id)), readMeta(kv, id)]);
    const last = isRecord(activity?.data) && typeof activity.data.lastActive === "string"
      ? Date.parse(activity.data.lastActive) : Date.parse(stored?.meta.createdAt ?? "");
    if (!stored || Number.isNaN(last) || now - last > IDLE_DAYS * DAY) {
      await deleteBoard(kv, id);
      boards += 1;
      continue;
    }
    const presented = stored.meta.settings.presentationDate;
    if (stored.meta.thumbs !== null && presented !== null
      && now - Date.parse(`${presented}T00:00:00Z`) > THUMB_DAYS_AFTER_PRESENTING * DAY) {
      const images = await kv.keys(`${id}/thumbs/`);
      await Promise.all(images.map(image => kv.delete(image)));
      // a conflicting organizer edit wins, and the next daily run tries again
      await kv.putJSON(key.meta(id), { ...stored.meta, thumbs: null }, conditionFor({ data: stored.meta, etag: stored.etag }));
      thumbs += images.length;
    }
  }
  return { boards, thumbs };
}
