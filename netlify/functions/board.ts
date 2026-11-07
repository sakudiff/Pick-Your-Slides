import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { handleBoard } from "../../server/board.ts";
import { blobKV } from "../../server/kv.ts";

export default async function handler(request: Request): Promise<Response> {
  return handleBoard(request, blobKV(getStore({ name: "boards", consistency: "strong" })));
}

export const config: Config = {
  path: ["/api/boards/:id", "/api/boards/:id/thumbs/:slide", "/api/boards/:id/presenters"],
  rateLimit: { windowLimit: 300, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
