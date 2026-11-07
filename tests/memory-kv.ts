import type { KV } from "../server/kv.ts";

type Stored = { value: unknown; version: number };

// Each call yields before touching the map, so concurrent requests interleave as they do against real storage.
export function memoryKV(etags = true): KV & { data: Map<string, Stored> } {
  const data = new Map<string, Stored>();
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const etag = (entry: Stored) => `"${entry.version}"`;
  return {
    data,
    async getJSON(key) {
      await tick();
      const entry = data.get(key);
      return entry ? { data: structuredClone(entry.value), etag: etags ? etag(entry) : null } : null;
    },
    async getBytes(key) {
      await tick();
      const entry = data.get(key);
      return entry && entry.value instanceof ArrayBuffer ? entry.value : null;
    },
    async putJSON(key, value, condition) {
      await tick();
      const entry = data.get(key);
      if ("onlyIfNew" in condition && entry) return false;
      if ("onlyIfMatch" in condition && (!entry || etag(entry) !== condition.onlyIfMatch)) return false;
      data.set(key, { value: structuredClone(value), version: (entry?.version ?? 0) + 1 });
      return true;
    },
    async putBytes(key, bytes) {
      await tick();
      data.set(key, { value: bytes, version: (data.get(key)?.version ?? 0) + 1 });
    },
    async delete(key) {
      await tick();
      data.delete(key);
    },
    async keys(prefix) {
      return [...data.keys()].filter(key => key.startsWith(prefix));
    },
    async folders() {
      return [...new Set([...data.keys()].map(key => key.split("/")[0]))];
    },
  };
}
