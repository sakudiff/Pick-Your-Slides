import type { Snapshot } from "./model.ts";

export function compressRanges(numbers: number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let start = 0; start < sorted.length;) {
    let end = start;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end += 1;
    parts.push(start === end ? String(sorted[start]) : `${sorted[start]}-${sorted[end]}`);
    start = end + 1;
  }
  return parts.join(", ");
}

export function slidesByMember(snapshot: Snapshot): Map<string, number[]> {
  const owned = new Map<string, number[]>(snapshot.meta.roster.map(member => [member.name, []]));
  for (const [slide, name] of Object.entries(snapshot.claims)) owned.get(name)?.push(Number(slide));
  for (const slides of owned.values()) slides.sort((a, b) => a - b);
  return owned;
}

// The same lines groups paste into Messenger by hand, in deck order.
export function messengerSummary(snapshot: Snapshot, link: string): string {
  const owned = [...slidesByMember(snapshot)].filter(([, slides]) => slides.length > 0)
    .sort(([, a], [, b]) => a[0] - b[0]);
  const open = snapshot.meta.slides.map((_, index) => index + 1).filter(number => !snapshot.claims[number]);
  const lines = [snapshot.meta.title];
  for (const [name, slides] of owned) lines.push(`${slides.length === 1 ? "Slide" : "Slides"} ${compressRanges(slides)}: ${name}`);
  if (open.length > 0) lines.push(`Open: ${compressRanges(open)}`);
  if (snapshot.meta.slides.length === 0) lines.push("Polls are open. Pick your name and vote.");
  lines.push(link);
  return lines.join("\n");
}
