import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { handleCreate } from "../../server/board.ts";
import { blobKV } from "../../server/kv.ts";

export default async function handler(request: Request): Promise<Response> {
  return handleCreate(request, blobKV(getStore({ name: "boards", consistency: "strong" })));
}

// creating boards is the one write that grows storage without a link, so it is limited per visitor
export const config: Config = {
  path: "/api/boards",
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
