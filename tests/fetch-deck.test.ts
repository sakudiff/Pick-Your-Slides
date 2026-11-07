import assert from "node:assert/strict";
import test from "node:test";
import type { LookupFunction } from "node:net";
import { checkDeckUrl, DECK_LIMIT, DeckRefusal, fetchDeck, fetchSlidesPdf, guardedLookup, handleFetchDeck, isPublicAddress, slidesId, type Get, type Reply } from "../server/fetch-deck.ts";

const DNS: Record<string, string[]> = {
  "deck.example.org": ["93.184.215.14"],
  "moved.example.org": ["93.184.215.15"],
  "rebind.example.org": ["93.184.215.16", "10.0.0.5"],
  "metadata.example.org": ["169.254.169.254"],
  "v6.example.org": ["::ffff:127.0.0.1"],
  "docs.google.com": ["142.250.66.14"],
  "doc-0o-slides.googleusercontent.com": ["142.250.66.15"],
  "accounts.google.com": ["142.250.66.16"],
};
const resolve = async (host: string) => (DNS[host] ?? []).map(address => ({ address, family: address.includes(":") ? 6 : 4 }));

type Page = { status: number; location?: string; type?: string; body?: string | Uint8Array[] };

// Calls the guarded lookup the way a socket would, before "connecting".
function site(pages: Record<string, Page>, visited: string[] = []): Get {
  return async (url, lookup: LookupFunction) => {
    await new Promise<void>((done, fail) => lookup(url.hostname, { all: true }, error => error ? fail(error) : done()));
    visited.push(url.href);
    const page = pages[url.href] ?? { status: 404 };
    const chunks = typeof page.body === "string" ? [new TextEncoder().encode(page.body)] : page.body ?? [];
    let cancelled = false;
    const reply: Reply = {
      status: page.status, location: page.location ?? null, type: page.type ?? "text/html; charset=utf-8",
      body: (async function* () { for (const chunk of chunks) if (!cancelled) yield chunk; })(),
      cancel: () => { cancelled = true; },
    };
    return reply;
  };
}

async function refusal(promise: Promise<unknown>): Promise<DeckRefusal> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DeckRefusal) return error;
    throw error;
  }
  assert.fail("expected a refusal");
}

test("deck links must be public https names", () => {
  for (const bad of [
    "http://deck.example.org/", "https://localhost/", "https://127.0.0.1/", "https://10.1.2.3/", "https://[::1]/",
    "https://169.254.169.254/latest/meta-data/", "https://user:pw@deck.example.org/", "https://deck.example.org:8443/",
    "https://printer.local/", "https://intranet/", "not a url",
  ]) assert.throws(() => checkDeckUrl(bad), DeckRefusal, bad);
  assert.equal(checkDeckUrl("https://deck.example.org:443/x").href, "https://deck.example.org/x");
});

test("private, link-local, CGNAT, multicast and mapped addresses are not public", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "172.20.1.1", "192.168.1.1", "100.64.0.1", "169.254.169.254", "0.0.0.0",
    "224.0.0.1", "::1", "::", "fd00::1", "fe80::1", "ff02::1", "::ffff:10.0.0.1", "::ffff:7f00:1", "64:ff9b::a9fe:a9fe"]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ["93.184.215.14", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) assert.equal(isPublicAddress(address), true, address);
});

test("a name is refused when any of its addresses is private", async () => {
  const lookup = guardedLookup(resolve);
  const run = (host: string) => new Promise<unknown>((done, fail) => lookup(host, {}, (error, address) => error ? fail(error) : done(address)));
  assert.equal(await run("deck.example.org"), "93.184.215.14");
  for (const host of ["rebind.example.org", "metadata.example.org", "v6.example.org", "nowhere.example.org"]) {
    await assert.rejects(run(host), DeckRefusal, host);
  }
});

test("redirects are followed and each hop is checked again", async () => {
  const visited: string[] = [];
  const result = await fetchDeck("https://deck.example.org/a", site({
    "https://deck.example.org/a": { status: 301, location: "https://moved.example.org/b" },
    "https://moved.example.org/b": { status: 302, location: "/c" },
    "https://moved.example.org/c": { status: 200, body: "<section class=slide>Hi</section>" },
  }, visited), resolve);
  assert.equal(result.finalUrl, "https://moved.example.org/c");
  assert.ok(result.html.includes("slide"));
  assert.equal(visited.length, 3);

  const toPrivate = await refusal(fetchDeck("https://deck.example.org/a", site({
    "https://deck.example.org/a": { status: 302, location: "https://metadata.example.org/" },
  }), resolve));
  assert.equal(toPrivate.status, 400);
  const toHttp = await refusal(fetchDeck("https://deck.example.org/a", site({
    "https://deck.example.org/a": { status: 302, location: "http://deck.example.org/" },
  }), resolve));
  assert.match(toHttp.message, /https/);
  const loop = await refusal(fetchDeck("https://deck.example.org/a", site({
    "https://deck.example.org/a": { status: 302, location: "/a" },
  }), resolve));
  assert.match(loop.message, /too many/);
});

test("non-HTML, oversize and failed pages are refused", async () => {
  const pdf = await refusal(fetchDeck("https://deck.example.org/a", site({ "https://deck.example.org/a": { status: 200, type: "application/pdf", body: "%PDF" } }), resolve));
  assert.equal(pdf.status, 415);
  const big = new Uint8Array(1024 * 1024);
  const huge = await refusal(fetchDeck("https://deck.example.org/a", site({ "https://deck.example.org/a": { status: 200, body: [big, big, big, big] } }), resolve));
  assert.equal(huge.status, 413);
  assert.ok(DECK_LIMIT < 4 * big.byteLength);
  const missing = await refusal(fetchDeck("https://deck.example.org/a", site({}), resolve));
  assert.match(missing.message, /404/);
});

test("the endpoint takes a JSON link from this site only", async () => {
  const get = site({ "https://deck.example.org/a": { status: 200, body: "<h1>x</h1>" } });
  const call = (body: string, origin = "https://pick.example") => handleFetchDeck(new Request("https://pick.example/api/fetch-deck", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body,
  }), get, resolve);
  const ok = await call(JSON.stringify({ url: "https://deck.example.org/a" }));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(Object.keys(await ok.json() as object).sort(), ["finalUrl", "html"]);
  assert.equal((await call(JSON.stringify({ url: "https://deck.example.org/a" }), "https://evil.example")).status, 403);
  assert.equal((await call("{")).status, 400);
  assert.equal((await call(JSON.stringify({ url: "https://127.0.0.1/" }))).status, 400);
  assert.equal((await handleFetchDeck(new Request("https://pick.example/api/fetch-deck"))).status, 405);
});

const ID = "1EdzdNgugstTOXlh3APrG4nxyZkizSukmijwu_2eQ4Ek";
const EXPORT = `https://docs.google.com/presentation/d/${ID}/export/pdf`;
const DOWNLOAD = "https://doc-0o-slides.googleusercontent.com/export/x";

test("Google Slides links yield the deck ID only", () => {
  for (const link of [`https://docs.google.com/presentation/d/${ID}/edit`, `https://docs.google.com/presentation/d/${ID}/edit?usp=sharing#slide=id.p`,
    `https://docs.google.com/presentation/u/1/d/${ID}/view`, `https://docs.google.com/presentation/d/${ID}`]) assert.equal(slidesId(link), ID, link);
  for (const link of [`http://docs.google.com/presentation/d/${ID}/edit`, `https://docs.google.com.evil.example/presentation/d/${ID}/edit`,
    `https://docs.google.com/document/d/${ID}/edit`, "https://docs.google.com/presentation/d/short/edit", "not a url"]) assert.equal(slidesId(link), null, link);
});

test("a shared Google Slides deck streams back as a PDF from Google's hosts", async () => {
  const visited: string[] = [];
  const stream = await fetchSlidesPdf(ID, site({
    [EXPORT]: { status: 307, location: DOWNLOAD },
    [DOWNLOAD]: { status: 200, type: "application/pdf", body: "%PDF-1.4" },
  }, visited), resolve);
  assert.equal(await new Response(stream).text(), "%PDF-1.4");
  assert.deepEqual(visited, [EXPORT, DOWNLOAD]);
});

test("unshared, missing, off-host and oversize Google Slides exports are refused", async () => {
  const signIn = await refusal(fetchSlidesPdf(ID, site({ [EXPORT]: { status: 302, location: "https://accounts.google.com/ServiceLogin" } }), resolve));
  assert.equal(signIn.status, 403);
  assert.match(signIn.message, /Anyone with the link/);
  const page = await refusal(fetchSlidesPdf(ID, site({ [EXPORT]: { status: 200, body: "<html>sign in</html>" } }), resolve));
  assert.equal(page.status, 403);
  const missing = await refusal(fetchSlidesPdf(ID, site({}), resolve));
  assert.equal(missing.status, 404);
  const offHost = await refusal(fetchSlidesPdf(ID, site({ [EXPORT]: { status: 302, location: "https://deck.example.org/x.pdf" } }), resolve));
  assert.equal(offHost.status, 403);
  const big = new Uint8Array(8 * 1024 * 1024);
  const stream = await fetchSlidesPdf(ID, site({ [EXPORT]: { status: 200, type: "application/pdf", body: [big, big, big] } }), resolve);
  await assert.rejects(new Response(stream).arrayBuffer(), /20 MB/);
});

test("the endpoint answers a Google Slides link with the PDF itself", async () => {
  const response = await handleFetchDeck(new Request("https://pick.example/api/fetch-deck", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://pick.example" },
    body: JSON.stringify({ url: `https://docs.google.com/presentation/d/${ID}/edit` }),
  }), site({ [EXPORT]: { status: 200, type: "application/pdf", body: "%PDF" } }), resolve);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "application/pdf");
  assert.equal(await response.text(), "%PDF");
});
