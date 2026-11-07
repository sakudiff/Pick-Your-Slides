import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { canvaConfig, handleCanva } from "../../server/canva.ts";
import { blobKV } from "../../server/kv.ts";

export default async function handler(request: Request): Promise<Response> {
  return handleCanva(request, {
    config: canvaConfig(process.env),
    kv: blobKV(getStore({ name: "canva", consistency: "strong" })),
  });
}

// an import polls its export about once a second for up to a minute
export const config: Config = {
  path: "/api/canva/*",
  rateLimit: { windowLimit: 90, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
