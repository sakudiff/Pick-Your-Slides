import { COLORS, LIMITS, normalizeText, type Member, type Section } from "./model.ts";

export function lines(text: string): string[] {
  return text.split(/\r?\n/).map(normalizeText).filter(line => line !== "");
}

// Keeps a returning member's colour, gives new members the first colour nobody holds.
export function rosterFrom(text: string, previous: Member[] = []): Member[] {
  const names = lines(text).map(name => name.slice(0, LIMITS.name).trim());
  const taken = new Set<string>();
  const roster = names.map(name => {
    const color = previous.find(member => member.name === name)?.color;
    const keep = color !== undefined && !taken.has(color);
    if (keep) taken.add(color);
    return { name, color: keep ? color : "" };
  });
  for (const member of roster) {
    if (member.color) continue;
    member.color = COLORS.find(color => !taken.has(color.value))?.value ?? COLORS[0].value;
    taken.add(member.color);
  }
  return roster;
}

// Accepts "1-3 Introduction", "4–6: Results" or "7 Conclusion", one section per line.
export function sectionsFrom(text: string): { sections: Section[]; error: string | null } {
  const sections: Section[] = [];
  for (const line of lines(text)) {
    const match = line.match(/^(\d+)(?:\s*(?:[-–—]|to)\s*(\d+))?\s*[:.)\-–—]?\s*(.*)$/i);
    if (!match) return { sections, error: `Write "${line}" as a slide range and a title, like "1-3 Introduction".` };
    const from = Number(match[1]);
    const to = match[2] ? Number(match[2]) : from;
    sections.push({ from, to, title: match[3].trim() || `Slides ${from}${to === from ? "" : `–${to}`}` });
  }
  return { sections, error: null };
}

export function sectionsText(sections: Section[]): string {
  return sections.map(section => `${section.from}${section.to === section.from ? "" : `-${section.to}`} ${section.title}`).join("\n");
}

// Labels Messenger and Canvas print around member names, matched against a whole line.
const UI_LINES = new RegExp(`^(?:${[
  "admins?", "group admins?", "group creator", "creator", "owner", "moderator", "you", "me", "everyone", "all", "requests",
  "members?", "chat members", "group members", "see all", "see more", "show more", "view all", "add", "add people", "add members?",
  "invite", "invite link", "message", "remove", "remove from group", "leave group", "mute", "search", "search people", "online",
  "active now", "active", "people", "groups?", "group \\d+", "students?", "teachers?", "tas?", "teaching assistants?", "instructors?",
  "observers?", "designers?", "unassigned students", "home", "announcements", "assignments", "discussions", "grades", "files",
  "pages", "syllabus", "modules", "collaborations", "dashboard", "courses", "calendar", "inbox", "history", "help", "account",
  "messenger", "facebook", "chats?", "media", "options", "customise chat", "customize chat", "privacy", "privacy & support",
  "yesterday", "today", "now", "mon(?:day)?", "tue(?:sday)?", "wed(?:nesday)?", "thu(?:rsday)?", "fri(?:day)?", "sat(?:urday)?", "sun(?:day)?",
].join("|")})$`, "i");
const UI_PREFIX = /^(?:added by|invited by|joined\b|left\b|created\b|removed\b|changed\b|named\b|active \d|last activity|total activity|section\b|role\b|\d+ (?:members?|people|students?)\b|search\b)/i;
const ROLE_TAIL = /(?:\s*[·•|-]\s*|\s+)(?:admin|owner|creator|student|teacher|ta|observer|designer|you)$/i;
const TIME_TAIL = /\s+(?:\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?|\d+\s*(?:m|h|d|w|min|mins|hr|hrs)(?: ago)?)$/i;
const WORD = /^(?:\p{Lu}\.?|\p{L}[\p{L}\p{M}'’.-]*)$/u;
const PARTICLES = /^(?:de|del|dela|della|delos|de los|di|da|van|von|der|bin|binti|la|le|y|e)$/i;

// "Cruz, Ana" and "Ana Cruz" are the same person.
function nameKey(name: string): string {
  const parts = name.split(",");
  return normalizeText(parts.length === 2 ? `${parts[1]} ${parts[0]}` : name).toLowerCase();
}

function titleCase(word: string): string {
  return word.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_, mark: string, letter: string) => mark + letter.toUpperCase());
}

// Keeps the lines of screenshot text that look like people's names, cleaned and deduplicated.
export function namesFromOcr(lines: string[], existing: string[] = [], limit: number = LIMITS.roster): string[] {
  const seen = new Set(existing.map(nameKey));
  const found: string[] = [];
  for (const raw of lines) {
    if (found.length + existing.length >= limit) break;
    // OCR reads avatars, status dots and icons as stray symbols at the ends of a line
    let line = normalizeText(raw.normalize("NFC").replace(/[^\p{L}\p{M}\p{N}\s'’.,:·•|-]/gu, " "))
      .replace(/^[^\p{L}]+|[^\p{L}.]+$/gu, "")
      .replace(/^\p{Ll}\s+(?=\p{Lu})/u, "");
    for (let previous = ""; previous !== line;) {
      previous = line;
      line = line.replace(ROLE_TAIL, "").replace(TIME_TAIL, "").trim();
    }
    // a letter avatar reads as the person's initials in front of the name, as in "AR Ana Reyes"
    const avatar = /^(\p{Lu}{1,2})\s+(\p{Lu}.*)$/u.exec(line);
    if (avatar && avatar[2].split(/\s+/).map(word => word[0]).join("").startsWith(avatar[1])) line = avatar[2];
    if (!line || UI_LINES.test(line) || UI_PREFIX.test(line) || /\d/.test(line)) continue;
    // a row of tabs like "All Admins" is labels side by side
    if (line.split(/\s+/).every(word => UI_LINES.test(word))) continue;
    const words = line.replace(/,/g, ", ").split(/\s+/).map(word => word.replace(/,$/, ""));
    if (line.split(",").length > 2 || words.length < 2 || words.length > 5) continue;
    if (!words.every(word => WORD.test(word))) continue;
    if (!/^\p{Lu}/u.test(words[0]) && !PARTICLES.test(words[0])) continue;
    // a lowercase word in a name is a particle like "de" or "van", so "Joined with invite link" is a label
    if (words.some(word => /^\p{Ll}/u.test(word) && !PARTICLES.test(word))) continue;
    const shouting = line === line.toUpperCase() && /\p{L}{3}/u.test(line);
    const name = (shouting ? line.replace(/\p{L}[\p{L}'’-]*/gu, titleCase) : line).slice(0, LIMITS.name).trim();
    if (seen.has(nameKey(name))) continue;
    seen.add(nameKey(name));
    found.push(name);
  }
  return found;
}
