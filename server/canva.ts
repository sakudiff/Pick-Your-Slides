import { createHash, randomBytes } from "node:crypto";
import { isRecord } from "../web/shared/model.ts";
import type { KV } from "./kv.ts";

// Canva Connect, used only to read one design's title and page count and export it as a PDF.
// It stays off until the three keys exist and CANVA_ENABLED is true, which waits on Canva approving the public review.

export type CanvaConfig = { clientId: string; clientSecret: string; redirectUri: string };
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const AUTHORIZE = "https://www.canva.com/api/oauth/authorize";
const API = "https://api.canva.com/rest/v1";
const SCOPES = "design:meta:read design:content:read";
const PENDING_MS = 10 * 60_000;
const SESSION_MS = 60 * 60_000;
export const PDF_LIMIT = 20 * 1024 * 1024;
const COOKIE = "pys_canva";

const key = {
  pending: (state: string) => `pending/${state}`,
  session: (id: string) => `sessions/${id}`,
};

type Pending = { verifier: string; designId: string; expires: number };
type Session = { token: string; designId: string; job: string | null; expires: number };

export function canvaConfig(env: Record<string, string | undefined>): CanvaConfig | null {
  const { CANVA_CLIENT_ID: clientId, CANVA_CLIENT_SECRET: clientSecret, CANVA_REDIRECT_URI: redirectUri, CANVA_ENABLED: enabled } = env;
  return enabled === "true" && clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : null;
}

// Accepts canva.com/design/<id>/..., including the edit, view and watch forms of a share link.
export function designIdFrom(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !/(?:^|\.)canva\.com$/.test(url.hostname)) return null;
    return url.pathname.match(/^\/design\/([A-Za-z0-9_-]{8,40})(?:\/|$)/)?.[1] ?? null;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return null;
  }
}

const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store", ...headers } });

function cookieValue(request: Request): string | null {
  const match = (request.headers.get("Cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{20,})`));
  return match?.[1] ?? null;
}

const setCookie = (value: string, maxAge: number) =>
  `${COOKIE}=${value}; Path=/api/canva; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;

async function readLive<T extends { expires: number }>(kv: KV, target: string, now: number): Promise<T | null> {
  const entry = await kv.getJSON(target);
  if (!entry || !isRecord(entry.data) || typeof entry.data.expires !== "number") return null;
  if (entry.data.expires < now) {
    await kv.delete(target);
    return null;
  }
  return entry.data as T;
}

// Canva's error codes, said in words the organizer can act on.
function exportProblem(code: unknown): string {
  switch (code) {
    case "license_required": return "The design has premium elements that are not licensed, so Canva will not export it. Remove them or download the PDF yourself.";
    case "approval_required": return "The design needs a reviewer's approval in Canva before it can be exported.";
    case "permission_denied": return "Your Canva account cannot open this design. Ask its owner to share it with you.";
    case "design_not_found": return "Canva cannot find that design. Check the link.";
    case "too_many_requests": return "Canva is limiting exports right now. Wait a minute and try again.";
    default: return "Canva could not export the design. Try again, or download the PDF yourself.";
  }
}

type Deps = { config: CanvaConfig | null; kv: KV; fetch?: Fetch; now?: () => number };

export async function handleCanva(request: Request, deps: Deps): Promise<Response> {
  const { config, kv } = deps;
  const send = deps.fetch ?? fetch;
  const now = deps.now?.() ?? Date.now();
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\/canva\/?/, "").replace(/\/$/, "");

  if (route === "status") return json({ enabled: config !== null });
  if (!config) return json({ error: "Canva import is not set up on this site. Download the PDF from Canva instead." }, 404);
  const origin = request.headers.get("Origin");
  if (request.method === "POST" && origin && origin !== url.origin) return json({ error: "Start the import from this site." }, 403);
  const canva = (path: string, token: string, init: RequestInit = {}) => send(`${API}${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });

  if (route === "start" && request.method === "POST") {
    let designUrl: unknown;
    try {
      designUrl = (await request.json() as { designUrl?: unknown }).designUrl;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    const designId = typeof designUrl === "string" ? designIdFrom(designUrl) : null;
    if (!designId) return json({ error: "Paste a Canva design link, like canva.com/design/…" }, 400);
    const verifier = randomBytes(64).toString("base64url");
    const state = randomBytes(24).toString("base64url");
    await kv.putJSON(key.pending(state), { verifier, designId, expires: now + PENDING_MS } satisfies Pending, { onlyIfNew: true });
    const authorize = new URL(AUTHORIZE);
    authorize.search = new URLSearchParams({
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
      scope: SCOPES, response_type: "code", client_id: config.clientId, state, redirect_uri: config.redirectUri,
    }).toString().replace(/\+/g, "%20");
    // spaces as %20, as Canva's documented examples write the scope list
    return json({ url: authorize.href });
  }

  if (route === "callback" && request.method === "GET") {
    const back = (outcome: string) => new Response(null, { status: 303, headers: { Location: `/?canva=${outcome}#new`, "Cache-Control": "no-store" } });
    const state = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code");
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(state)) return back("expired");
    const pending = await readLive<Pending>(kv, key.pending(state), now);
    // the state is single use, so a replayed callback finds nothing
    await kv.delete(key.pending(state));
    if (!pending) return back("expired");
    if (!code) return back("denied");
    const reply = await send(`${API}/oauth/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: pending.verifier, redirect_uri: config.redirectUri }).toString(),
    });
    const tokens: unknown = reply.ok ? await reply.json() : null;
    if (!isRecord(tokens) || typeof tokens.access_token !== "string") return back("failed");
    // only the access token is kept, for an hour, and the refresh token is never stored
    const session = randomBytes(24).toString("base64url");
    await kv.putJSON(key.session(session), { token: tokens.access_token, designId: pending.designId, job: null, expires: now + SESSION_MS } satisfies Session, { onlyIfNew: true });
    const response = back("ready");
    response.headers.set("Set-Cookie", setCookie(session, SESSION_MS / 1000));
    return response;
  }

  const sessionId = cookieValue(request);
  const session = sessionId ? await readLive<Session>(kv, key.session(sessionId), now) : null;
  if (!sessionId || !session) return json({ error: "The Canva sign-in expired. Import the link again." }, 401);
  const end = async () => {
    await kv.delete(key.session(sessionId));
    return setCookie("", 0);
  };

  if (route === "import" && request.method === "POST") {
    const design = await canva(`/designs/${session.designId}`, session.token);
    const body: unknown = await design.json().catch(() => null);
    if (!design.ok || !isRecord(body) || !isRecord(body.design)) {
      const code = isRecord(body) ? body.code : null;
      return json({ error: exportProblem(code) }, design.status === 404 ? 404 : 502, { "Set-Cookie": await end() });
    }
    const title = typeof body.design.title === "string" ? body.design.title : "";
    const pages = typeof body.design.page_count === "number" ? body.design.page_count : null;
    const job = await canva("/exports", session.token, {
      method: "POST", body: JSON.stringify({ design_id: session.designId, format: { type: "pdf", export_quality: "regular" } }),
    });
    const created: unknown = await job.json().catch(() => null);
    if (!job.ok || !isRecord(created) || !isRecord(created.job) || typeof created.job.id !== "string") {
      return json({ error: exportProblem(isRecord(created) ? created.code : null), title, pages }, 502, { "Set-Cookie": await end() });
    }
    await kv.putJSON(key.session(sessionId), { ...session, job: created.job.id } satisfies Session, {});
    return json({ title, pages, job: created.job.id });
  }

  const exportJob = route.match(/^export\/([A-Za-z0-9-]{8,64})$/)?.[1];
  if (exportJob && request.method === "GET") {
    if (exportJob !== session.job) return json({ error: "That export belongs to another import." }, 403);
    const status = await canva(`/exports/${exportJob}`, session.token);
    const body: unknown = await status.json().catch(() => null);
    const job = isRecord(body) && isRecord(body.job) ? body.job : null;
    if (!status.ok || !job) return json({ error: exportProblem(isRecord(body) ? body.code : null) }, 502, { "Set-Cookie": await end() });
    if (job.status === "in_progress") return json({ status: "in_progress" }, 202);
    if (job.status !== "success") {
      return json({ error: exportProblem(isRecord(job.error) ? job.error.code : null) }, 502, { "Set-Cookie": await end() });
    }
    const download = Array.isArray(job.urls) && typeof job.urls[0] === "string" ? new URL(job.urls[0]) : null;
    // Canva serves exports from its own download host, and nothing else is fetched here
    if (!download || download.protocol !== "https:" || !/(?:^|\.)canva\.com$/.test(download.hostname)) {
      return json({ error: exportProblem(null) }, 502, { "Set-Cookie": await end() });
    }
    const cookie = await end();
    const file = await send(download.href);
    const size = Number(file.headers.get("Content-Length") ?? 0);
    if (!file.ok || !file.body) return json({ error: exportProblem(null) }, 502, { "Set-Cookie": cookie });
    if (size > PDF_LIMIT) {
      await file.body.cancel();
      return json({ error: "The exported PDF is larger than 20 MB. The slide count is filled in, without titles.", tooLarge: true }, 413, { "Set-Cookie": cookie });
    }
    let read = 0;
    const capped = file.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        read += chunk.byteLength;
        if (read > PDF_LIMIT) controller.error(new Error("The exported PDF is larger than 20 MB."));
        else controller.enqueue(chunk);
      },
    }));
    return new Response(capped, { headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store", "Set-Cookie": cookie } });
  }

  return json({ error: "There is nothing at this address." }, 404);
}

// Pending sign-ins and sessions expire on their own, and the daily cleanup removes what is left.
export async function purgeCanva(kv: KV, now = Date.now()): Promise<number> {
  let removed = 0;
  for (const target of [...await kv.keys("pending/"), ...await kv.keys("sessions/")]) {
    const entry = await kv.getJSON(target);
    if (!entry || !isRecord(entry.data) || typeof entry.data.expires !== "number" || entry.data.expires < now) {
      await kv.delete(target);
      removed += 1;
    }
  }
  return removed;
}
