// The boards this browser has made or opened. Boards have no accounts, so this list lives on the device.

export type Role = "organizer" | "member";
export type BoardEntry = { id: string; title: string; role: Role; lastOpened: number };
export type KeyStore = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

const INDEX = "pys-boards";
const ID = /^[0-9a-hjkmnp-tv-z]{10}$/;
const keysFor = (id: string) => [`pys-admin-${id}`, `pys-name-${id}`, `pys-board-${id}`];

function safely<T>(work: () => T, fallback: T): T {
  try {
    return work();
  } catch (error) {
    if (!(error instanceof DOMException) && !(error instanceof SyntaxError)) throw error;
    return fallback;
  }
}

function roleOf(store: KeyStore, id: string): Role {
  return safely(() => store.getItem(`pys-admin-${id}`), null) ? "organizer" : "member";
}

function cachedTitle(store: KeyStore, id: string): string {
  const cached: unknown = safely(() => JSON.parse(store.getItem(`pys-board-${id}`) ?? "null"), null);
  const title = (cached as { meta?: { title?: unknown } } | null)?.meta?.title;
  return typeof title === "string" && title ? title : "Untitled board";
}

// Boards made before this list existed still left their keys behind, so the first read rebuilds from them.
function rebuild(store: KeyStore): BoardEntry[] {
  const ids = new Set<string>();
  for (let index = 0; index < store.length; index += 1) {
    const id = store.key(index)?.match(/^pys-(?:admin|name|board)-(.+)$/)?.[1];
    if (id && ID.test(id)) ids.add(id);
  }
  return [...ids].map(id => ({ id, title: cachedTitle(store, id), role: roleOf(store, id), lastOpened: 0 }));
}

function isEntry(value: unknown): value is BoardEntry {
  const entry = value as BoardEntry;
  return typeof entry === "object" && entry !== null && typeof entry.id === "string" && ID.test(entry.id)
    && typeof entry.title === "string" && typeof entry.lastOpened === "number";
}

function save(store: KeyStore, entries: BoardEntry[]): void {
  safely(() => store.setItem(INDEX, JSON.stringify(entries)), undefined);
}

export function listBoards(store: KeyStore): BoardEntry[] {
  const raw: unknown = safely(() => JSON.parse(store.getItem(INDEX) ?? "null"), null);
  const entries = Array.isArray(raw) ? raw.filter(isEntry) : rebuild(store);
  if (!Array.isArray(raw)) save(store, entries);
  // the organizer secret decides the role, so a board opened later with the organizer link is shown as yours
  return entries.map(entry => ({ ...entry, role: roleOf(store, entry.id) }))
    .sort((a, b) => b.lastOpened - a.lastOpened || a.title.localeCompare(b.title));
}

export function rememberBoard(store: KeyStore, id: string, title: string, now = Date.now()): void {
  if (!ID.test(id)) return;
  const rest = listBoards(store).filter(entry => entry.id !== id);
  save(store, [{ id, title: title || "Untitled board", role: roleOf(store, id), lastOpened: now }, ...rest]);
}

// Forgets the board on this device only. The board itself stays up for everyone else.
export function forgetBoard(store: KeyStore, id: string): void {
  save(store, listBoards(store).filter(entry => entry.id !== id));
  for (const key of keysFor(id)) safely(() => store.removeItem(key), undefined);
}

export function openedAgo(lastOpened: number, now = Date.now()): string {
  if (lastOpened === 0) return "opened earlier";
  const minutes = Math.round((now - lastOpened) / 60_000);
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (minutes < 1) return "opened just now";
  if (minutes < 60) return `opened ${format.format(-minutes, "minute")}`;
  if (minutes < 60 * 24) return `opened ${format.format(-Math.round(minutes / 60), "hour")}`;
  return `opened ${format.format(-Math.round(minutes / 1440), "day")}`;
}
