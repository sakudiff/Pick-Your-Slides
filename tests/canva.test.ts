import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { canvaConfig, designIdFrom, handleCanva, PDF_LIMIT, purgeCanva } from "../server/canva.ts";
import { memoryKV } from "./memory-kv.ts";

const ORIGIN = "https://pick.example";
const config = { clientId: "client-1", clientSecret: "secret-1", redirectUri: `${ORIGIN}/api/canva/callback` };
const TOKEN = "canva-access-token-never-shown";

type Call = { url: string; init?: RequestInit };

function canvaStub(overrides: Partial<Record<string, () => Response>> = {}) {
  const calls: Call[] = [];
  let polls = 0;
  const routes: Record<string, () => Response> = {
    "POST https://api.canva.com/rest/v1/oauth/token": () => Response.json({ access_token: TOKEN, refresh_token: "refresh-never-kept", token_type: "Bearer", expires_in: 14400 }),
    "GET https://api.canva.com/rest/v1/designs/DAGabc12345": () => Response.json({ design: { id: "DAGabc12345", title: "Bond Offering", page_count: 9 } }),
    "POST https://api.canva.com/rest/v1/exports": () => Response.json({ job: { id: "e08861ae-3b29-45db-8dc1-1fe0bf7f1cc8", status: "in_progress" } }),
    "GET https://api.canva.com/rest/v1/exports/e08861ae-3b29-45db-8dc1-1fe0bf7f1cc8": () => {
      polls += 1;
      return Response.json({ job: polls < 2 ? { id: "x", status: "in_progress" } : { id: "x", status: "success", urls: ["https://export-download.canva.com/abc/file.pdf"] } });
    },
    "GET https://export-download.canva.com/abc/file.pdf": () => new Response("%PDF-1.7 fake", { headers: { "Content-Type": "application/pdf", "Content-Length": "13" } }),
    ...overrides,
  };
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const route = routes[`${init?.method ?? "GET"} ${url}`];
    return route ? route() : new Response("not stubbed", { status: 599 });
  };
  return { fetch, calls };
}

async function flow(stub = canvaStub(), kv = memoryKV(), now = () => 1_000_000) {
  const call = (path: string, init: RequestInit = {}, cookie = "") => handleCanva(new Request(`${ORIGIN}${path}`, {
    ...init, headers: { Origin: ORIGIN, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...init.headers as object },
  }), { config, kv, fetch: stub.fetch, now });
  const start = await call("/api/canva/start", { method: "POST", body: JSON.stringify({ designUrl: "https://www.canva.com/design/DAGabc12345/edit?utm=x" }) });
  const authorize = new URL((await start.json() as { url: string }).url);
  return { call, authorize, kv, stub };
}

const everything = async (response: Response) => `${[...response.headers].join(" ")} ${await response.clone().text()}`;

test("Canva stays off without all three keys and CANVA_ENABLED", async () => {
  assert.equal(canvaConfig({ CANVA_CLIENT_ID: "a", CANVA_CLIENT_SECRET: "b" }), null);
  assert.equal(canvaConfig({ CANVA_CLIENT_ID: "a", CANVA_CLIENT_SECRET: "b", CANVA_REDIRECT_URI: "c" }), null);
  assert.equal(canvaConfig({ CANVA_CLIENT_ID: "a", CANVA_CLIENT_SECRET: "b", CANVA_REDIRECT_URI: "c", CANVA_ENABLED: "1" }), null);
  assert.deepEqual(canvaConfig({ CANVA_CLIENT_ID: "a", CANVA_CLIENT_SECRET: "b", CANVA_REDIRECT_URI: "c", CANVA_ENABLED: "true" }), { clientId: "a", clientSecret: "b", redirectUri: "c" });
  const status = await handleCanva(new Request(`${ORIGIN}/api/canva/status`), { config: null, kv: memoryKV() });
  assert.deepEqual(await status.json(), { enabled: false });
  const start = await handleCanva(new Request(`${ORIGIN}/api/canva/start`, { method: "POST", body: "{}" }), { config: null, kv: memoryKV() });
  assert.equal(start.status, 404);
});

test("design ids come only from canva.com design links", () => {
  assert.equal(designIdFrom("https://www.canva.com/design/DAGabc12345/edit"), "DAGabc12345");
  assert.equal(designIdFrom("https://canva.com/design/DAGabc12345/xyz/view?mode=preview"), "DAGabc12345");
  for (const bad of ["http://www.canva.com/design/DAGabc12345/edit", "https://canva.com.evil.example/design/DAGabc12345/", "https://www.canva.com/folder/DAGabc12345", "nope"]) {
    assert.equal(designIdFrom(bad), null, bad);
  }
});

test("sign-in uses PKCE with S256 and asks only for the two scopes", async () => {
  const { authorize, kv } = await flow();
  assert.equal(authorize.origin + authorize.pathname, "https://www.canva.com/api/oauth/authorize");
  const params = authorize.searchParams;
  assert.equal(params.get("code_challenge_method"), "S256");
  assert.equal(params.get("scope"), "design:meta:read design:content:read");
  assert.match(authorize.search, /scope=design%3Ameta%3Aread%20design%3Acontent%3Aread&/);
  assert.equal(params.get("response_type"), "code");
  assert.equal(params.get("redirect_uri"), config.redirectUri);
  const pending = await kv.getJSON(`pending/${params.get("state")}`);
  const verifier = (pending!.data as { verifier: string }).verifier;
  assert.ok(verifier.length >= 43 && verifier.length <= 128);
  assert.equal(createHash("sha256").update(verifier).digest("base64url"), params.get("code_challenge"));
});

test("a callback with an unknown or reused state is turned away", async () => {
  const { call, authorize, stub } = await flow();
  const forged = await call(`/api/canva/callback?code=abc&state=${"x".repeat(32)}`);
  assert.equal(forged.status, 303);
  assert.match(forged.headers.get("Location")!, /canva=expired/);
  assert.equal(forged.headers.get("Set-Cookie"), null);
  const state = authorize.searchParams.get("state");
  assert.match((await call(`/api/canva/callback?code=abc&state=${state}`)).headers.get("Location")!, /canva=ready/);
  const replay = await call(`/api/canva/callback?code=abc&state=${state}`);
  assert.match(replay.headers.get("Location")!, /canva=expired/);
  assert.equal(stub.calls.filter(entry => entry.url.endsWith("/oauth/token")).length, 1);
});

test("a full import never shows the token and deletes the session after the export", async () => {
  const { call, authorize, kv, stub } = await flow();
  const callback = await call(`/api/canva/callback?code=abc&state=${authorize.searchParams.get("state")}`);
  const cookie = callback.headers.get("Set-Cookie")!;
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  const token = stub.calls.find(entry => entry.url.endsWith("/oauth/token"))!;
  assert.match(String((token.init!.headers as Record<string, string>).Authorization), /^Basic /);
  assert.match(String(token.init!.body), /grant_type=authorization_code/);
  const jar = cookie.split(";")[0];
  const stored = JSON.stringify(await Promise.all((await kv.keys("sessions/")).map(name => kv.getJSON(name))));
  assert.ok(!stored.includes("refresh-never-kept"));

  const responses: Response[] = [callback];
  const started = await call("/api/canva/import", { method: "POST", body: "{}" }, jar);
  responses.push(started);
  const job = await started.clone().json() as { title: string; pages: number; job: string };
  assert.equal(job.title, "Bond Offering");
  assert.equal(job.pages, 9);
  const exportBody = JSON.parse(String(stub.calls.find(entry => entry.url.endsWith("/exports"))!.init!.body));
  assert.deepEqual(exportBody.format, { type: "pdf", export_quality: "regular" });

  assert.equal((await call("/api/canva/export/aaaaaaaa-0000", {}, jar)).status, 403);
  const waiting = await call(`/api/canva/export/${job.job}`, {}, jar);
  responses.push(waiting);
  assert.equal(waiting.status, 202);
  const done = await call(`/api/canva/export/${job.job}`, {}, jar);
  responses.push(done);
  assert.equal(done.headers.get("Content-Type"), "application/pdf");
  assert.equal(await done.clone().text(), "%PDF-1.7 fake");
  assert.match(done.headers.get("Set-Cookie")!, /Max-Age=0/);
  assert.deepEqual(await kv.keys("sessions/"), []);
  assert.equal((await call(`/api/canva/export/${job.job}`, {}, jar)).status, 401);
  for (const response of responses) assert.ok(!(await everything(response)).includes(TOKEN));
});

test("Canva export failures come back in plain words, and big PDFs are refused", async () => {
  const failing = canvaStub({
    "GET https://api.canva.com/rest/v1/exports/e08861ae-3b29-45db-8dc1-1fe0bf7f1cc8": () => Response.json({ job: { id: "x", status: "failed", error: { code: "license_required", message: "PRO" } } }),
  });
  const run = async (stub: ReturnType<typeof canvaStub>) => {
    const { call, authorize } = await flow(stub);
    const jar = (await call(`/api/canva/callback?code=abc&state=${authorize.searchParams.get("state")}`)).headers.get("Set-Cookie")!.split(";")[0];
    const { job } = await (await call("/api/canva/import", { method: "POST", body: "{}" }, jar)).json() as { job: string };
    return call(`/api/canva/export/${job}`, {}, jar);
  };
  const failed = await run(failing);
  assert.equal(failed.status, 502);
  assert.match((await failed.json() as { error: string }).error, /premium/);

  const huge = canvaStub({
    "GET https://api.canva.com/rest/v1/exports/e08861ae-3b29-45db-8dc1-1fe0bf7f1cc8": () => Response.json({ job: { id: "x", status: "success", urls: ["https://export-download.canva.com/abc/file.pdf"] } }),
    "GET https://export-download.canva.com/abc/file.pdf": () => new Response("x", { headers: { "Content-Length": String(PDF_LIMIT + 1) } }),
  });
  const big = await run(huge);
  assert.equal(big.status, 413);
  assert.equal((await big.json() as { tooLarge: boolean }).tooLarge, true);

  const elsewhere = canvaStub({
    "GET https://api.canva.com/rest/v1/exports/e08861ae-3b29-45db-8dc1-1fe0bf7f1cc8": () => Response.json({ job: { id: "x", status: "success", urls: ["https://evil.example/file.pdf"] } }),
  });
  const offsite = await run(elsewhere);
  assert.equal(offsite.status, 502);
  assert.ok(!elsewhere.calls.some(entry => entry.url.startsWith("https://evil.example")));
});

test("expired sign-ins and sessions are purged", async () => {
  const kv = memoryKV();
  await kv.putJSON("pending/old", { verifier: "v", designId: "d", expires: 5 }, {});
  await kv.putJSON("sessions/live", { token: "t", designId: "d", job: null, expires: 50 }, {});
  assert.equal(await purgeCanva(kv, 10), 1);
  assert.deepEqual(await kv.keys("sessions/"), ["sessions/live"]);
});
