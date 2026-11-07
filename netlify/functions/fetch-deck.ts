import type { Config } from "@netlify/functions";
import { handleFetchDeck } from "../../server/fetch-deck.ts";

export default async function handler(request: Request): Promise<Response> {
  return handleFetchDeck(request);
}

// each call makes an outbound request, so it is limited more tightly than board edits
export const config: Config = {
  path: "/api/fetch-deck",
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
