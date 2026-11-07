import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { purge } from "../../server/board.ts";
import { purgeCanva } from "../../server/canva.ts";
import { blobKV } from "../../server/kv.ts";

export default async function handler(): Promise<void> {
  const result = await purge(blobKV(getStore({ name: "boards", consistency: "strong" })));
  const canva = await purgeCanva(blobKV(getStore({ name: "canva", consistency: "strong" })));
  console.log(`Deleted ${result.boards} idle boards, ${result.thumbs} old slide images and ${canva} expired Canva sign-ins`);
}

export const config: Config = { schedule: "@daily" };
