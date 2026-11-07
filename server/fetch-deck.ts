import { lookup as dnsLookup } from "node:dns";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { PDF_LIMIT } from "./canva.ts";

export const DECK_LIMIT = 3 * 1024 * 1024;
const TIMEOUT = 8000;
const REDIRECTS = 3;

export class DeckRefusal extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["100::", 64], ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(network, prefix, "ipv6");

// IPv6 can carry an IPv4 address (mapped, compatible or NAT64), which is judged as that IPv4 address.
function embeddedV4(address: string): string | null {
  const dotted = address.match(/^(?:::ffff:|::|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/i);
  if (dotted) return dotted[1];
  const hex = address.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hex) return null;
  const high = parseInt(hex[1], 16);
  const low = parseInt(hex[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join(".");
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  if (family !== 6) return false;
  const inner = embeddedV4(address.toLowerCase());
  if (inner) return !blocked.check(inner, "ipv4");
  return !blocked.check(address, "ipv6");
}

// Returns the parsed URL, or throws a refusal the organizer can read.
export function checkDeckUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new DeckRefusal(400, "That is not a web address.");
  }
  if (url.protocol !== "https:") throw new DeckRefusal(400, "Use an https link.");
  if (url.username || url.password) throw new DeckRefusal(400, "Remove the user name and password from the link.");
  if (url.port !== "" && url.port !== "443") throw new DeckRefusal(400, "Use a link without a port number.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(host)) throw new DeckRefusal(400, "Use the site's name, not an IP address.");
  if (!host.includes(".") || /\.(?:localhost|local|internal|lan|home\.arpa)$/.test(host) || host === "localhost") {
    throw new DeckRefusal(400, "That address is not on the public web.");
  }
  return url;
}

type Resolve = (host: string) => Promise<{ address: string; family: number }[]>;

const systemResolve: Resolve = host => new Promise((resolve, reject) => {
  dnsLookup(host, { all: true, verbatim: true }, (error, addresses) => error ? reject(error) : resolve(addresses));
});

// Runs inside the socket's connect, so the address checked is the address used, and DNS rebinding has no gap.
export function guardedLookup(resolve: Resolve = systemResolve): LookupFunction {
  return ((host: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
    resolve(host).then(addresses => {
      if (addresses.length === 0) throw new DeckRefusal(502, "That site's name does not resolve.");
      if (!addresses.every(entry => isPublicAddress(entry.address))) throw new DeckRefusal(400, "That address is not on the public web.");
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    }).catch(error => callback(error));
  }) as LookupFunction;
}

export type Reply = { status: number; location: string | null; type: string; body: AsyncIterable<Uint8Array>; cancel(): void };
export type Get = (url: URL, lookup: LookupFunction, signal: AbortSignal, accept?: string) => Promise<Reply>;

const httpsGet: Get = (url, lookup, signal, accept = "text/html,application/xhtml+xml") => new Promise((resolve, reject) => {
  const outgoing = httpsRequest(url, {
    method: "GET", lookup, signal,
    headers: { Accept: accept, "User-Agent": "PickYourSlides/1.0 (deck import)" },
  }, incoming => {
    const location = incoming.headers.location;
    resolve({
      status: incoming.statusCode ?? 0, location: typeof location === "string" ? location : null,
      type: String(incoming.headers["content-type"] ?? ""), body: incoming, cancel: () => incoming.destroy(),
    });
  });
  outgoing.on("error", reject);
  outgoing.end();
});

function charset(type: string): string {
  const label = type.match(/charset=["']?([\w-]+)/i)?.[1] ?? "utf-8";
  try {
    new TextDecoder(label);
    return label;
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return "utf-8";
  }
}

export async function fetchDeck(value: string, get: Get = httpsGet, resolve: Resolve = systemResolve): Promise<{ html: string; finalUrl: string }> {
  let url = checkDeckUrl(value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    for (let hop = 0; ; hop += 1) {
      const reply = await get(url, guardedLookup(resolve), controller.signal);
      if (reply.status >= 300 && reply.status < 400 && reply.location) {
        reply.cancel();
        if (hop >= REDIRECTS) throw new DeckRefusal(502, "The link redirects too many times.");
        url = checkDeckUrl(new URL(reply.location, url).href);
        continue;
      }
      if (reply.status !== 200) {
        reply.cancel();
        throw new DeckRefusal(502, `The site answered ${reply.status}. Check that the deck is public.`);
      }
      if (!/^(?:text\/html|application\/xhtml\+xml)\b/i.test(reply.type)) {
        reply.cancel();
        throw new DeckRefusal(415, "That link is not a web page. For a PDF, choose PDF as the source.");
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of reply.body) {
        size += chunk.byteLength;
        if (size > DECK_LIMIT) {
          reply.cancel();
          throw new DeckRefusal(413, "The page is larger than 3 MB.");
        }
        chunks.push(chunk);
      }
      return { html: new TextDecoder(charset(reply.type)).decode(Buffer.concat(chunks)), finalUrl: url.href };
    }
  } catch (error) {
    if (error instanceof DeckRefusal) throw error;
    if (controller.signal.aborted) throw new DeckRefusal(504, "The site took too long to answer.");
    if (error instanceof Error && "code" in error && (error.code === "ENOTFOUND" || error.code === "EAI_AGAIN")) {
      throw new DeckRefusal(502, "That site's name does not resolve.");
    }
    throw new DeckRefusal(502, "The deck could not be fetched.");
  } finally {
    clearTimeout(timer);
  }
}

// Google Slides draws its slides with JavaScript, but a deck shared with anyone who has the link exports as a PDF.
export function slidesId(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "docs.google.com") return null;
    return url.pathname.match(/^\/presentation\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,100})(?:\/|$)/)?.[1] ?? null;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return null;
  }
}

const NOT_SHARED = "Google did not share this deck. In Google Slides choose Share, set General access to Anyone with the link, or download the PDF.";

// The export is served from Google's download hosts, and a deck that is not shared redirects to a sign-in page instead.
export async function fetchSlidesPdf(id: string, get: Get = httpsGet, resolve: Resolve = systemResolve): Promise<ReadableStream<Uint8Array>> {
  let url = new URL(`https://docs.google.com/presentation/d/${id}/export/pdf`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    for (let hop = 0; ; hop += 1) {
      const reply = await get(url, guardedLookup(resolve), controller.signal, "application/pdf");
      if (reply.status >= 300 && reply.status < 400 && reply.location) {
        reply.cancel();
        if (hop >= REDIRECTS) throw new DeckRefusal(502, "Google redirected too many times.");
        url = checkDeckUrl(new URL(reply.location, url).href);
        if (url.hostname !== "docs.google.com" && !url.hostname.endsWith(".googleusercontent.com")) throw new DeckRefusal(403, NOT_SHARED);
        continue;
      }
      if (reply.status === 404) {
        reply.cancel();
        throw new DeckRefusal(404, "Google cannot find that deck. Check the link.");
      }
      if (reply.status !== 200 || !/^application\/pdf\b/i.test(reply.type)) {
        reply.cancel();
        throw new DeckRefusal(reply.status === 401 || reply.status === 403 || reply.status === 200 ? 403 : 502, NOT_SHARED);
      }
      let size = 0;
      const source = reply.body[Symbol.asyncIterator]();
      return new ReadableStream<Uint8Array>({
        async pull(stream) {
          const { done, value } = await source.next();
          if (done) return stream.close();
          size += value.byteLength;
          if (size > PDF_LIMIT) {
            reply.cancel();
            stream.error(new DeckRefusal(413, "The deck's PDF is larger than 20 MB."));
          } else stream.enqueue(value);
        },
        cancel: () => reply.cancel(),
      });
    }
  } catch (error) {
    if (error instanceof DeckRefusal) throw error;
    if (controller.signal.aborted) throw new DeckRefusal(504, "Google took too long to export the deck.");
    throw new DeckRefusal(502, "Google Slides could not be reached.");
  } finally {
    // the timer covers the wait for an answer, and the function's own limit covers the download
    clearTimeout(timer);
  }
}

export async function handleFetchDeck(request: Request, get?: Get, resolve?: Resolve): Promise<Response> {
  const respond = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return respond({ error: "Import decks from the board page." }, 403);
  let url: unknown;
  try {
    const text = await request.text();
    url = text.length <= 2048 ? (JSON.parse(text) as { url?: unknown }).url : undefined;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  if (typeof url !== "string") return respond({ error: "Send the deck's link." }, 400);
  try {
    const slides = slidesId(url);
    if (slides) {
      return new Response(await fetchSlidesPdf(slides, get, resolve), { headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" } });
    }
    return respond(await fetchDeck(url, get, resolve));
  } catch (error) {
    if (error instanceof DeckRefusal) return respond({ error: error.message }, error.status);
    throw error;
  }
}
