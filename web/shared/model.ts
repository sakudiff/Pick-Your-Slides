export const LIMITS = {
  slides: 200, roster: 10, name: 40, title: 120, sections: 30,
  polls: 20, questions: 5, options: 10, question: 200, option: 80, url: 500,
};

export const COLORS = [
  { value: "#a9d7ec", label: "Blue" },
  { value: "#c5b7e6", label: "Violet" },
  { value: "#f2b8c6", label: "Pink" },
  { value: "#f0c38e", label: "Peach" },
  { value: "#e9d889", label: "Yellow" },
  { value: "#a8d7be", label: "Green" },
  { value: "#9fd8d2", label: "Teal" },
  { value: "#e4b5e0", label: "Lilac" },
  { value: "#f4a99a", label: "Coral" },
  { value: "#d6c7a8", label: "Sand" },
];

export type Slide = { title: string };
export type Section = { title: string; from: number; to: number };
export type Member = { name: string; color: string };
export type Settings = { unit: "slide" | "section"; membersCanPoll: boolean; presentationDate: string | null };
export type BoardInput = {
  title: string; slides: Slide[]; sections: Section[]; roster: Member[]; settings: Settings; deckUrl: string | null;
};
export type Meta = BoardInput & { thumbs: number | null; createdAt: string };
export type Question = { question: string; options: string[]; multi: boolean };
// votes[name][question] holds the options that person picked for that question, empty when unanswered
export type Poll = {
  id: string; title: string; questions: Question[]; closed: boolean;
  createdBy: string; createdAt: string; votes: Record<string, number[][]>;
};
export type Snapshot = {
  id: string;
  meta: Meta;
  revision: string | null;
  claims: Record<string, string>;
  polls: Poll[];
};
export type Unit = { id: string; label: string; title: string; slides: number[] };

export type Change =
  | { kind: "claim"; slide: number; name: string }
  | { kind: "release"; slide: number; name: string }
  | { kind: "clear"; slide: number }
  | { kind: "apply"; claims: Record<string, string> }
  | { kind: "poll"; name: string; title: string; questions: Question[] }
  | { kind: "vote"; poll: string; name: string; question: number; choices: number[] }
  | { kind: "closePoll"; poll: string; closed: boolean }
  | { kind: "deletePoll"; poll: string }
  | { kind: "meta"; board: BoardInput; revision: string | null; thumbs: number | null };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isText(value: unknown, max: number, allowEmpty = false): value is string {
  return typeof value === "string" && value === normalizeText(value)
    && (allowEmpty || value.length > 0) && value.length <= max
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function isInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

export function isRevision(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0 && value.length <= 200);
}

export function isDeckUrl(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || value.length > LIMITS.url) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return false;
  }
}

function isDate(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
}

// Returns an error the organizer can act on, or null when the board is valid.
export function boardError(value: unknown): string | null {
  if (!isRecord(value)) return "Send a board.";
  if (!isText(value.title, LIMITS.title)) return `Give the board a title of up to ${LIMITS.title} characters.`;
  const { slides, sections, roster, settings } = value;
  if (!Array.isArray(slides) || slides.length === 0 || slides.length > LIMITS.slides) {
    return `A board needs between 1 and ${LIMITS.slides} slides.`;
  }
  if (!slides.every(slide => isRecord(slide) && isText(slide.title, LIMITS.title, true))) {
    return `Slide titles must be up to ${LIMITS.title} characters.`;
  }
  if (!Array.isArray(roster) || roster.length === 0 || roster.length > LIMITS.roster) {
    return `List between 1 and ${LIMITS.roster} group members.`;
  }
  if (!roster.every(member => isRecord(member) && isText(member.name, LIMITS.name)
    && COLORS.some(color => color.value === member.color))) {
    return `Each member needs a name of up to ${LIMITS.name} characters and a colour from the palette.`;
  }
  const names = roster.map(member => (member as Member).name.toLowerCase());
  if (new Set(names).size !== names.length) return "Two members have the same name.";
  if (!Array.isArray(sections) || sections.length > LIMITS.sections) return `Use at most ${LIMITS.sections} sections.`;
  let previous = 0;
  for (const section of sections) {
    if (!isRecord(section) || !isText(section.title, LIMITS.title)
      || !isInteger(section.from, 1, slides.length) || !isInteger(section.to, section.from as number, slides.length)) {
      return "Each section needs a title and a slide range inside the deck.";
    }
    if (section.from <= previous) return "Sections must be in order and must not overlap.";
    previous = section.to as number;
  }
  if (!isRecord(settings) || (settings.unit !== "slide" && settings.unit !== "section")
    || typeof settings.membersCanPoll !== "boolean" || !isDate(settings.presentationDate)) {
    return "The board settings are incomplete.";
  }
  if (settings.unit === "section" && sections.length === 0) return "Add sections before splitting by section.";
  if (!isDeckUrl(value.deckUrl ?? null)) return "The deck link must be an https address.";
  return null;
}

// Copies only the known fields, so stored boards never carry extra client data.
export function cleanBoard(value: BoardInput): BoardInput {
  return {
    title: value.title,
    slides: value.slides.map(slide => ({ title: slide.title })),
    sections: value.sections.map(({ title, from, to }) => ({ title, from, to })),
    roster: value.roster.map(({ name, color }) => ({ name, color })),
    settings: {
      unit: value.settings.unit, membersCanPoll: value.settings.membersCanPoll,
      presentationDate: value.settings.presentationDate,
    },
    deckUrl: value.deckUrl ?? null,
  };
}

export function slideTitle(meta: Meta, number: number): string {
  return meta.slides[number - 1]?.title || `Slide ${number}`;
}

// A section board still lets slides outside every section be rated on their own.
export function unitsOf(meta: Meta): Unit[] {
  const slideUnit = (number: number): Unit => ({
    id: `s${number}`, label: `Slide ${number}`, title: slideTitle(meta, number), slides: [number],
  });
  if (meta.settings.unit === "slide") return meta.slides.map((_, index) => slideUnit(index + 1));
  const units: Unit[] = [];
  let next = 1;
  meta.sections.forEach((section, index) => {
    for (; next < section.from; next += 1) units.push(slideUnit(next));
    const slides = Array.from({ length: section.to - section.from + 1 }, (_, offset) => section.from + offset);
    units.push({ id: `x${index + 1}`, label: section.from === section.to ? `Slide ${section.from}` : `Slides ${section.from}–${section.to}`, title: section.title, slides });
    next = section.to + 1;
  });
  for (; next <= meta.slides.length; next += 1) units.push(slideUnit(next));
  return units;
}

export function isMember(meta: Meta, name: unknown): name is string {
  return typeof name === "string" && meta.roster.some(member => member.name === name);
}

export function isSlideNumber(meta: Meta, value: unknown): value is number {
  return isInteger(value, 1, meta.slides.length);
}

// Drops claims and votes left behind when the organizer edits the slides or roster.
export function pruneClaims(meta: Meta, claims: unknown): Record<string, string> {
  const kept: Record<string, string> = {};
  if (!isRecord(claims)) return kept;
  for (const [slide, name] of Object.entries(claims)) {
    if (String(Number(slide)) === slide && isSlideNumber(meta, Number(slide)) && isMember(meta, name)) kept[slide] = name;
  }
  return kept;
}

function isQuestion(value: unknown): value is Question {
  return isRecord(value) && isText(value.question, LIMITS.question) && typeof value.multi === "boolean"
    && Array.isArray(value.options) && value.options.length >= 2 && value.options.length <= LIMITS.options
    && value.options.every(option => isText(option, LIMITS.option));
}

// Reads a stored poll of either shape. Polls from before several questions were allowed hold one
// question at the top level and one list of choices per person, so they become a one-question poll.
export function normalizePoll(value: unknown): Poll | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.closed !== "boolean"
    || typeof value.createdBy !== "string" || typeof value.createdAt !== "string" || !isRecord(value.votes)) return null;
  if (Array.isArray(value.questions)) {
    if (value.questions.length === 0 || value.questions.length > LIMITS.questions || !value.questions.every(isQuestion)) return null;
    const title = typeof value.title === "string" && isText(value.title, LIMITS.title) ? value.title : value.questions[0].question;
    const votes: Record<string, number[][]> = {};
    for (const [name, answers] of Object.entries(value.votes)) if (Array.isArray(answers)) votes[name] = answers.map(answer => Array.isArray(answer) ? answer : []);
    return { id: value.id, title, questions: value.questions, closed: value.closed, createdBy: value.createdBy, createdAt: value.createdAt, votes };
  }
  const single = { question: value.question, options: value.options, multi: value.multi };
  if (!isQuestion(single)) return null;
  const votes: Record<string, number[][]> = {};
  for (const [name, choices] of Object.entries(value.votes)) if (Array.isArray(choices)) votes[name] = [choices];
  return { id: value.id, title: single.question, questions: [single], closed: value.closed, createdBy: value.createdBy, createdAt: value.createdAt, votes };
}

// Keeps only members' votes, one valid answer list per question.
export function prunePoll(meta: Meta, poll: Poll): Poll {
  const votes: Record<string, number[][]> = {};
  for (const [name, answers] of Object.entries(poll.votes)) {
    if (!isMember(meta, name)) continue;
    const kept = poll.questions.map((question, index) => {
      const choices = (answers[index] ?? []).filter(choice => isInteger(choice, 0, question.options.length - 1));
      return question.multi ? [...new Set(choices)] : choices.slice(0, 1);
    });
    if (kept.some(choices => choices.length > 0)) votes[name] = kept;
  }
  return { ...poll, votes };
}

export function parseChange(value: unknown, meta: Meta): Change | null {
  if (!isRecord(value)) return null;
  switch (value.kind) {
    case "claim":
    case "release":
      return isSlideNumber(meta, value.slide) && isMember(meta, value.name)
        ? { kind: value.kind, slide: value.slide, name: value.name } : null;
    case "clear":
      return isSlideNumber(meta, value.slide) ? { kind: "clear", slide: value.slide } : null;
    case "apply": {
      if (!isRecord(value.claims)) return null;
      const claims = pruneClaims(meta, value.claims);
      return Object.keys(claims).length === Object.keys(value.claims).length ? { kind: "apply", claims } : null;
    }
    case "poll": {
      const { questions } = value;
      if (!isMember(meta, value.name) || !Array.isArray(questions) || questions.length === 0
        || questions.length > LIMITS.questions || !questions.every(isQuestion)) return null;
      if (value.title !== undefined && value.title !== "" && !isText(value.title, LIMITS.title)) return null;
      const title = typeof value.title === "string" && value.title ? value.title : questions[0].question;
      return {
        kind: "poll", name: value.name, title,
        questions: questions.map(({ question, options, multi }) => ({ question, options: [...options], multi })),
      };
    }
    case "vote":
      return typeof value.poll === "string" && isMember(meta, value.name) && isInteger(value.question, 0, LIMITS.questions - 1)
        && Array.isArray(value.choices) && value.choices.length <= LIMITS.options
        && value.choices.every(choice => isInteger(choice, 0, LIMITS.options - 1))
        ? { kind: "vote", poll: value.poll, name: value.name, question: value.question, choices: [...new Set(value.choices as number[])] } : null;
    case "closePoll":
      return typeof value.poll === "string" && typeof value.closed === "boolean"
        ? { kind: "closePoll", poll: value.poll, closed: value.closed } : null;
    case "deletePoll":
      return typeof value.poll === "string" ? { kind: "deletePoll", poll: value.poll } : null;
    case "meta":
      return boardError(value.board) === null && isRevision(value.revision)
        && (value.thumbs === null || isInteger(value.thumbs, 1, Number.MAX_SAFE_INTEGER))
        ? { kind: "meta", board: cleanBoard(value.board as BoardInput), revision: value.revision, thumbs: value.thumbs as number | null }
        : null;
    default:
      return null;
  }
}

export function isAdminChange(change: Change): boolean {
  return ["clear", "apply", "closePoll", "deletePoll", "meta"].includes(change.kind);
}
