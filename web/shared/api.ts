import { isRecord, type Snapshot } from "./model.ts";

export class ApiError extends Error {
  readonly status: number;
  readonly snapshot: Snapshot | null;
  constructor(message: string, status: number, snapshot: Snapshot | null) {
    super(message);
    this.status = status;
    this.snapshot = snapshot;
  }
}

// A deploy replaces the previous build's chunks, so a page opened before it can no longer load code it imports later.
export class StaleBuild extends Error {}

export async function loadChunk<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (failure) {
    if (!(failure instanceof TypeError)) throw failure;
    throw new StaleBuild("Pick your slides was updated while this page was open. Reload the page, then try again.");
  }
}

export function parseSnapshot(value: unknown): Snapshot | null {
  return asSnapshot(value);
}

function asSnapshot(value: unknown): Snapshot | null {
  return isRecord(value) && typeof value.id === "string" && isRecord(value.meta) && isRecord(value.claims)
    && Array.isArray(value.polls) ? value as Snapshot : null;
}

export async function request(path: string, init: RequestInit = {}, token: string | null = null): Promise<unknown> {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (typeof init.body === "string") headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers, cache: "no-store" });
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new ApiError("Could not reach the board. Check your connection.", 0, null);
  }
  if (response.status === 204) return null;
  if (response.status === 429) throw new ApiError("Too many requests from this network. Wait a minute and try again.", 429, null);
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === "string" ? payload.error : "Something went wrong. Try again.";
    throw new ApiError(message, response.status, asSnapshot(payload));
  }
  return payload;
}

export async function loadBoard(id: string): Promise<Snapshot> {
  const snapshot = asSnapshot(await request(`/api/boards/${id}`));
  if (!snapshot) throw new ApiError("The board could not be read.", 500, null);
  return snapshot;
}

export async function sendChange(id: string, change: unknown, token: string | null): Promise<Snapshot> {
  const snapshot = asSnapshot(await request(`/api/boards/${id}`, { method: "POST", body: JSON.stringify(change) }, token));
  if (!snapshot) throw new ApiError("The board could not be read.", 500, null);
  return snapshot;
}

export async function uploadThumbs(id: string, token: string, thumbs: Blob[], progress: (done: number) => void): Promise<void> {
  let done = 0;
  const queue = thumbs.map((thumb, index) => ({ thumb, slide: index + 1 }));
  const worker = async (): Promise<void> => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      await request(`/api/boards/${id}/thumbs/${next.slide}`, {
        method: "PUT", body: next.thumb, headers: { "Content-Type": "image/jpeg" },
      }, token);
      done += 1;
      progress(done);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    if (!(error instanceof DOMException) && !(error instanceof TypeError)) throw error;
    return false;
  }
}
