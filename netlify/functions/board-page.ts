import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { isBoardId, readSnapshot } from "../../server/board.ts";
import { blobKV } from "../../server/kv.ts";
import { injectPreview } from "../../server/page.ts";

export default async function handler(request: Request, context: Context): Promise<Response> {
  const id = context.params.id;
  const page = await fetch(new URL("/board/", request.url));
  if (!page.ok) return new Response("The board page is missing from this deploy.", { status: 500 });
  const snapshot = isBoardId(id) ? await readSnapshot(blobKV(getStore({ name: "boards", consistency: "strong" })), id) : null;
  return new Response(injectPreview(await page.text(), snapshot, new URL(request.url).origin), {
    status: snapshot ? 200 : 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export const config: Config = { path: "/b/:id", method: "GET" };
