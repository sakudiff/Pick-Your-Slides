import type { Store } from "@netlify/blobs";

export type Condition = { onlyIfNew: true } | { onlyIfMatch: string } | Record<string, never>;
export type Entry = { data: unknown; etag: string | null };

export interface KV {
  getJSON(key: string): Promise<Entry | null>;
  getBytes(key: string): Promise<ArrayBuffer | null>;
  putJSON(key: string, value: unknown, condition: Condition): Promise<boolean>;
  putBytes(key: string, data: ArrayBuffer): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
  folders(): Promise<string[]>;
}

// Netlify's local Blobs sandbox returns no ETags, so an existing key has no revision there.
// Production always returns one, so every production write stays conditional.
export function conditionFor(entry: Entry | null): Condition {
  if (entry === null) return { onlyIfNew: true };
  return entry.etag === null ? {} : { onlyIfMatch: entry.etag };
}

export function blobKV(store: Store): KV {
  return {
    async getJSON(key) {
      const blob = await store.getWithMetadata(key, { type: "json" });
      return blob ? { data: blob.data as unknown, etag: blob.etag ?? null } : null;
    },
    getBytes: key => store.get(key, { type: "arrayBuffer" }),
    async putJSON(key, value, condition) {
      return (await store.setJSON(key, value, condition)).modified;
    },
    async putBytes(key, data) {
      await store.set(key, data);
    },
    delete: key => store.delete(key),
    async keys(prefix) {
      return (await store.list({ prefix })).blobs.map(blob => blob.key);
    },
    async folders() {
      return (await store.list({ directories: true })).directories;
    },
  };
}
