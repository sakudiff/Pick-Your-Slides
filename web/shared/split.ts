import type { Unit } from "./model.ts";

export type EvenSplit = { claims: Record<string, string>; added: Record<string, number[]> };

// Keeps every claim and hands out the open units so counts end up as even as they can.
// Counts are levelled first (each open unit goes to whoever has fewest, a tie to whoever claimed fewest themselves),
// then each person's share is laid out as one back-to-back run in deck order.
export function evenSplit(units: Unit[], roster: string[], claims: Record<string, string>): EvenSplit {
  const held = new Map(roster.map(name => [name, 0]));
  const open: Unit[] = [];
  const result = { ...claims };
  const added: Record<string, number[]> = Object.fromEntries(roster.map(name => [name, []]));
  for (const unit of units) {
    const owner = unit.slides.map(slide => claims[slide]).find(name => name !== undefined);
    if (owner === undefined) {
      open.push(unit);
      continue;
    }
    if (!held.has(owner)) continue;
    held.set(owner, held.get(owner)! + 1);
    // a section belongs to one person, so whoever holds part of it gets the rest
    for (const slide of unit.slides) {
      if (result[slide] !== undefined) continue;
      result[slide] = owner;
      added[owner].push(slide);
    }
  }
  const share = new Map(roster.map(name => [name, 0]));
  for (let left = open.length; left > 0 && roster.length > 0; left -= 1) {
    // fewest in total first, then whoever claimed fewest themselves, then roster order
    const total = (name: string) => held.get(name)! + share.get(name)!;
    const next = roster.reduce((best, name) => total(name) < total(best)
      || (total(name) === total(best) && held.get(name)! < held.get(best)!) ? name : best);
    share.set(next, share.get(next)! + 1);
  }
  let cursor = 0;
  for (const name of roster) {
    for (const unit of open.slice(cursor, cursor + share.get(name)!)) {
      for (const slide of unit.slides) {
        result[slide] = name;
        added[name].push(slide);
      }
    }
    cursor += share.get(name)!;
  }
  return { claims: result, added };
}
