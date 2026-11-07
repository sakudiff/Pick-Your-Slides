import { ApiError, copyText, loadBoard, parseSnapshot, request, sendChange, uploadThumbs } from "../shared/api.ts";
import { boardForm } from "../shared/form.ts";
import { LIMITS, slideTitle, unitsOf, type Change, type Poll, type Snapshot } from "../shared/model.ts";
import { compressRanges, messengerSummary, slidesByMember } from "../shared/ranges.ts";
import { forgetBoard, rememberBoard } from "../shared/boards.ts";
import { coachRunning, runCoach, type CoachStep } from "./coach.ts";
import { evenSplit, type EvenSplit } from "../shared/split.ts";
import { attachMenu, button, confirmAction, el, initials, shortName, toast, typingBubble, type MenuItem } from "../shared/ui.ts";

const id = location.pathname.match(/^\/b\/([0-9a-hjkmnp-tv-z]{10})\/?$/)?.[1] ?? null;
const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const memberUrl = id ? new URL(`/b/${id}`, location.origin).href : location.href;

// `server` is the last state the server confirmed. `board` is what is shown: that state plus the claims
// still on their way, so a tap shows at once and a refresh never undoes it.
let server: Snapshot | null = null;
let board: Snapshot | null = null;
type QuickChange = Extract<Change, { kind: "claim" | "release" | "clear" | "vote" }>;
const inFlight: QuickChange[] = [];
let claimQueue: Promise<void> = Promise.resolve();
let token: string | null = null;
let me = "";
let saving = 0;
let generation = 0;
let preview: EvenSplit | null = null;
let editLoaded = false;

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
    return null;
  }
}

function store(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
  }
}

const pad = (number: number) => String(number).padStart(2, "0");

function colorOf(name: string): string {
  return board?.meta.roster.find(member => member.name === name)?.color ?? "transparent";
}

// Tight spots show a short name, and the full name stays in the title and the accessible name.
function pill(name: string, short = false): HTMLSpanElement {
  const element = el("span", "pill");
  element.style.setProperty("--person-color", colorOf(name));
  const label = short ? shortName(name, board?.meta.roster.map(member => member.name) ?? []) : name;
  element.append(el("span", "avatar", initials(name)), el("span", "pill-name", label));
  if (label !== name) {
    element.title = name;
    element.setAttribute("aria-label", name);
  }
  return element;
}

function withPending(snapshot: Snapshot): Snapshot {
  if (inFlight.length === 0) return snapshot;
  const claims = { ...snapshot.claims };
  const polls = snapshot.polls.map(poll => ({ ...poll, votes: { ...poll.votes } }));
  for (const pending of inFlight) {
    if (pending.kind === "vote") {
      const poll = polls.find(candidate => candidate.id === pending.poll);
      if (!poll) continue;
      const answers = poll.questions.map((_, index) => [...poll.votes[pending.name]?.[index] ?? []]);
      answers[pending.question] = pending.choices;
      poll.votes[pending.name] = answers;
    } else if (pending.kind === "claim") claims[pending.slide] = pending.name;
    else delete claims[pending.slide];
  }
  return { ...snapshot, claims, polls };
}

function accept(snapshot: Snapshot): void {
  server = snapshot;
  board = withPending(snapshot);
  // the last copy paints the board instantly on the next visit, before the network answers
  if (id) {
    store(`pys-board-${id}`, JSON.stringify(snapshot));
    rememberBoard(localStorage, id, snapshot.meta.title);
  }
}

function dropToken(): void {
  token = null;
  if (id) store(`pys-admin-${id}`, null);
}

// Claims and votes show at once and save in order in the background, so fast taps are never blocked or lost.
function queueChange(value: QuickChange): void {
  if (!id || !server) return;
  inFlight.push(value);
  generation += 1;
  board = withPending(server);
  render();
  claimQueue = claimQueue.then(async () => {
    try {
      const snapshot = await sendChange(id, value, token);
      inFlight.splice(inFlight.indexOf(value), 1);
      accept(snapshot);
    } catch (error) {
      inFlight.splice(inFlight.indexOf(value), 1);
      if (!(error instanceof ApiError)) throw error;
      if (error.snapshot) accept(error.snapshot);
      else if (server) board = withPending(server);
      if (error.status === 403 && token) dropToken();
      toast(error.message, true);
    } finally {
      generation += 1;
      render();
    }
  });
}

async function change(value: Change, success: string): Promise<boolean> {
  if (!id || !board) return false;
  saving += 1;
  generation += 1;
  try {
    accept(await sendChange(id, value, token));
    toast(success);
    return true;
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    if (error.snapshot) accept(error.snapshot);
    if (error.status === 403 && token && value.kind !== "poll") dropToken();
    toast(error.message, true);
    return false;
  } finally {
    saving -= 1;
    render();
  }
}

function requireName(): string | null {
  if (me) return me;
  toast("Choose who you are first.", true);
  $("#me").click();
  return null;
}

function setMe(name: string): void {
  me = name;
  if (id) store(`pys-name-${id}`, name || null);
  render();
}

function renderToolbar(snapshot: Snapshot): void {
  document.title = `${snapshot.meta.title} · Pick your slides`;
  $("#title").textContent = snapshot.meta.title;
  const claimed = Object.keys(snapshot.claims).length;
  $("#summary").textContent = `${snapshot.meta.slides.length ? `${claimed} of ${snapshot.meta.slides.length} claimed` : "No slides yet"} · ${snapshot.meta.roster.length} people`;
  $<HTMLButtonElement>("#share").disabled = false;
  const identity = $<HTMLButtonElement>("#me");
  identity.replaceChildren(me ? pill(me, true) : document.createTextNode("Who are you?"));
  identity.dataset.chosen = String(Boolean(me));
}

function emptyState(text: string): HTMLElement {
  return el("p", "empty", text);
}

type Group = { header: string; rows: HTMLElement[] };

function grouped(groups: Group[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const group of groups) {
    if (group.rows.length === 0) continue;
    if (group.header) fragment.append(el("h3", "group-header", group.header));
    const section = el("section", "group");
    section.append(...group.rows);
    fragment.append(section);
  }
  return fragment;
}

// Rows follow the deck's sections, with loose slides between them under a plain header.
function bySection<T>(snapshot: Snapshot, items: T[], slideOf: (item: T) => number, row: (item: T) => HTMLElement): Group[] {
  const groups: Group[] = [];
  for (const item of items) {
    const slide = slideOf(item);
    const section = snapshot.meta.sections.find(candidate => slide >= candidate.from && slide <= candidate.to);
    const header = section ? `${section.title} · ${section.from === section.to ? section.from : `${section.from}–${section.to}`}` : snapshot.meta.sections.length ? "Other slides" : "";
    if (groups.at(-1)?.header !== header) groups.push({ header, rows: [] });
    groups.at(-1)!.rows.push(row(item));
  }
  return groups;
}

function renderSlides(snapshot: Snapshot): void {
  const filter = document.querySelector<HTMLInputElement>('input[name="filter"]:checked')?.value ?? "all";
  const numbers = snapshot.meta.slides.map((_, index) => index + 1).filter(number => {
    const owner = snapshot.claims[number];
    return filter === "all" || (filter === "open" ? !owner : owner === me && me !== "");
  });
  const container = $("#slides");
  container.replaceChildren();
  $("#view-slides .view-tools").hidden = snapshot.meta.slides.length === 0;
  if (snapshot.meta.slides.length === 0) {
    container.append(emptyState(token ? "No slides yet. Add the deck when it's ready, and everyone can claim theirs." : "No slides yet. The organizer adds the deck later. Polls are open now."));
    if (token) container.append(button("Add Your Deck", "primary", openSettings));
  } else if (numbers.length === 0) {
    container.append(emptyState(filter === "mine" ? (me ? "You have no slides yet." : "Choose who you are to see your slides.") : "Every slide is taken."));
  } else {
    container.append(grouped(bySection(snapshot, numbers, number => number, number => slideRow(snapshot, number))));
  }
  const people = $("#people");
  people.replaceChildren();
  for (const [name, slides] of slidesByMember(snapshot)) {
    if (slides.length === 0) continue;
    const chip = pill(name, true);
    chip.title = `${name}: ${compressRanges(slides)}`;
    chip.append(el("span", "count", String(slides.length)));
    people.append(chip);
  }
}

function slideRow(snapshot: Snapshot, number: number): HTMLElement {
  const owner = snapshot.claims[number];
  const title = snapshot.meta.slides[number - 1]?.title;
  const row = button("", "row slide-row", () => { void tapSlide(number); });
  if (snapshot.meta.thumbs !== null) {
    const image = el("img", "thumb");
    image.src = `/api/boards/${snapshot.id}/thumbs/${number}?v=${snapshot.meta.thumbs}`;
    image.alt = "";
    image.loading = "lazy";
    image.addEventListener("error", () => { image.replaceWith(el("span", "thumb")); });
    row.append(image);
  }
  const text = el("span", "row-text");
  text.append(el("span", "slide-number", pad(number)), el("span", title ? "row-title" : "row-title untitled", title || "Untitled"));
  row.append(text);
  if (owner) row.append(pill(owner, true));
  else row.append(el("span", "claim", "Claim"));
  row.dataset.mine = String(Boolean(owner) && owner === me);
  row.setAttribute("aria-label", `Slide ${number}, ${title || "untitled"}, ${owner ? `${owner}${owner === me ? ", tap to release" : ""}` : "open, tap to claim"}`);
  return row;
}

async function tapSlide(number: number): Promise<void> {
  if (!board) return;
  const owner = board.claims[number];
  if (owner && owner !== me) {
    if (!token) {
      toast(`Slide ${number} is ${owner}'s. Ask them or the organizer to free it.`, true);
      return;
    }
    if (await confirmAction(`Free slide ${number}?`, `${owner} will no longer have this slide.`, "Free Slide")) {
      queueChange({ kind: "clear", slide: number });
    }
    return;
  }
  const name = requireName();
  if (!name) return;
  queueChange(owner === name ? { kind: "release", slide: number, name } : { kind: "claim", slide: number, name });
}

function renderSplit(snapshot: Snapshot, result: EvenSplit): void {
  const totals = new Map<string, number[]>();
  for (const [slide, name] of Object.entries(result.claims)) totals.set(name, [...totals.get(name) ?? [], Number(slide)]);
  const rows = snapshot.meta.roster.map(member => {
    const slides = (totals.get(member.name) ?? []).sort((x, y) => x - y);
    const added = result.added[member.name] ?? [];
    const row = el("div", "row");
    const text = el("span", "row-text");
    text.append(el("span", "row-title", slides.length ? `Slides ${compressRanges(slides)}` : "No slides"));
    if (added.length) text.append(el("span", "caption", `+${added.length} new`));
    row.append(pill(member.name), text, el("span", "value", String(slides.length)));
    return row;
  });
  const open = snapshot.meta.slides.length - Object.keys(snapshot.claims).length;
  const container = $("#split");
  container.replaceChildren(grouped([{ header: "", rows }]));
  container.append(el("p", "group-footer", open === 0
    ? "Every slide is already claimed, so there is nothing to hand out."
    : `Hands out the ${open} open ${open === 1 ? "slide" : "slides"} so everyone ends up with about the same number. Claims people already made stay.`));
  $<HTMLButtonElement>("#apply-split").disabled = open === 0;
}

function previewSplit(snapshot: Snapshot): EvenSplit {
  return evenSplit(unitsOf(snapshot.meta), snapshot.meta.roster.map(member => member.name), snapshot.claims);
}

function renderPolls(snapshot: Snapshot): void {
  const canStart = snapshot.meta.settings.membersCanPoll || token !== null;
  $<HTMLButtonElement>("#new-poll").hidden = !canStart;
  $("#poll-caption").textContent = canStart ? "" : "Only the organizer can start polls.";
  const container = $("#polls");
  container.replaceChildren();
  if (snapshot.polls.length === 0) {
    container.append(emptyState(canStart ? "No polls yet. Ask when to practise, which template, anything." : "No polls yet."));
    return;
  }
  for (const poll of [...snapshot.polls].reverse()) container.append(pollGroup(poll));
}

function pollGroup(poll: Poll): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const header = el("div", "poll-header");
  header.append(el("h3", "group-header", poll.title));
  if (token) {
    const more = button("", "icon small", undefined);
    more.setAttribute("aria-label", `Poll options for ${poll.title}`);
    more.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>';
    attachMenu(more, () => [
      { label: poll.closed ? "Reopen Poll" : "Close Poll", action: () => { void change({ kind: "closePoll", poll: poll.id, closed: !poll.closed }, poll.closed ? "Poll reopened" : "Poll closed"); } },
      { label: "Copy Results", action: () => { void copyText(pollText(poll)).then(ok => toast(ok ? "Copied" : "Copying is blocked here.")); } },
      "separator",
      { label: "Delete Poll", destructive: true, action: async () => {
        if (await confirmAction("Delete this poll?", "Its votes are removed for everyone.", "Delete")) void change({ kind: "deletePoll", poll: poll.id }, "Poll deleted");
      } },
    ]);
    header.append(more);
  }
  fragment.append(header);
  const several = poll.questions.length > 1;
  poll.questions.forEach((question, questionIndex) => {
    const answered = Object.values(poll.votes).filter(answers => (answers[questionIndex] ?? []).length > 0).length;
    const mine = me ? poll.votes[me]?.[questionIndex] ?? [] : [];
    // a one-question poll titled by its question would say it twice
    if (several || question.question !== poll.title) {
      fragment.append(el("p", "poll-question", `${question.question}${question.multi ? " · pick any" : ""}`));
    }
    const rows = question.options.map((option, index) => {
      const names = Object.entries(poll.votes).filter(([, answers]) => (answers[questionIndex] ?? []).includes(index)).map(([name]) => name);
      const row = button("", "row option", () => {
        const name = requireName();
        if (!name) return;
        const choices = question.multi
          ? (mine.includes(index) ? mine.filter(choice => choice !== index) : [...mine, index])
          : (mine.includes(index) ? [] : [index]);
        queueChange({ kind: "vote", poll: poll.id, name, question: questionIndex, choices });
      });
      row.disabled = poll.closed;
      row.setAttribute("role", question.multi ? "checkbox" : "radio");
      row.setAttribute("aria-checked", String(mine.includes(index)));
      row.style.setProperty("--share", answered ? `${(names.length / answered) * 100}%` : "0%");
      const text = el("span", "row-text");
      text.append(el("span", "row-title", option));
      if (names.length) text.append(el("span", "caption", names.join(", ")));
      row.append(el("span", "check", ""), text, el("span", "value", String(names.length)));
      return row;
    });
    const section = el("section", "group");
    section.append(...rows);
    fragment.append(section);
  });
  const people = Object.keys(poll.votes).length;
  const singleMulti = !several && poll.questions[0].multi && poll.questions[0].question === poll.title ? " · pick any" : "";
  fragment.append(el("p", "group-footer", `${poll.createdBy} · ${people} of ${board?.meta.roster.length ?? 0} answered${singleMulti}${poll.closed ? " · closed" : ""}`));
  return fragment;
}

function pollText(poll: Poll): string {
  const lines = [poll.title];
  poll.questions.forEach((question, questionIndex) => {
    if (poll.questions.length > 1 || question.question !== poll.title) lines.push("", question.question);
    question.options.forEach((option, index) => {
      const names = Object.entries(poll.votes).filter(([, answers]) => (answers[questionIndex] ?? []).includes(index)).map(([name]) => name);
      lines.push(`${option}: ${names.length}${names.length ? ` (${names.join(", ")})` : ""}`);
    });
  });
  return lines.join("\n");
}

// One block per question in the New Poll sheet.
function addQuestion(): void {
  const list = $("#poll-questions");
  const count = list.children.length;
  if (count >= LIMITS.questions) return;
  const block = el("div", "question-block");
  const head = el("div", "poll-header");
  head.append(el("h3", "group-header", `Question ${count + 1}`));
  if (count > 0) {
    head.append(button("Remove", "plain", () => {
      block.remove();
      [...list.querySelectorAll(".question-block .group-header")].forEach((title, index) => { title.textContent = `Question ${index + 1}`; });
      $<HTMLButtonElement>("#poll-add-question").hidden = false;
    }));
  }
  const group = el("section", "group");
  const field = el("div", "row field-row");
  const text = el("input", "q-text");
  text.maxLength = LIMITS.question;
  text.placeholder = count === 0 ? "When do we practise?" : "Which template?";
  text.setAttribute("aria-label", `Question ${count + 1}`);
  field.append(text);
  const optionsRow = el("div", "row stacked");
  const options = el("textarea", "q-options field");
  options.rows = 4;
  options.placeholder = "One option per line";
  options.setAttribute("aria-label", `Options for question ${count + 1}, one per line`);
  optionsRow.append(options);
  const toggle = el("label", "row switch-row");
  const multi = el("input", "q-multi");
  multi.type = "checkbox";
  multi.setAttribute("role", "switch");
  toggle.append(el("span", "", "Allow several choices"), multi);
  group.append(field, optionsRow, toggle);
  block.append(head, group);
  list.append(block);
  typingBubble(options, count === 0 ? ["Monday 7pm", "Tuesday lunch"] : ["Clean and simple", "Bold colours"]);
  $<HTMLButtonElement>("#poll-add-question").hidden = list.children.length >= LIMITS.questions;
}

function resetPollForm(): void {
  $<HTMLInputElement>("#poll-title").value = "";
  $("#poll-questions").replaceChildren();
  $("#poll-error").textContent = "";
  addQuestion();
}

function renderOrder(snapshot: Snapshot): void {
  const numbers = snapshot.meta.slides.map((_, index) => index + 1);
  const container = $("#order");
  if (numbers.length === 0) {
    container.replaceChildren(emptyState("The presenting order shows once the deck is added."));
    return;
  }
  container.replaceChildren(grouped(bySection(snapshot, numbers, number => number, number => {
    const owner = snapshot.claims[number];
    const row = el("div", "row");
    const text = el("span", "row-text");
    text.append(el("span", "slide-number", pad(number)), el("span", "row-title", slideTitle(snapshot.meta, number)));
    row.append(text, owner ? pill(owner, true) : el("span", "caption", "Open"));
    return row;
  })));
  const totals = [...slidesByMember(snapshot)].map(([name, slides]) => {
    const row = el("div", "row");
    const text = el("span", "row-text");
    text.append(el("span", "row-title caption", slides.length ? compressRanges(slides) : "No slides"));
    row.append(pill(name), text, el("span", "value", String(slides.length)));
    return row;
  });
  container.append(grouped([{ header: "Totals", rows: totals }]));
}

function render(): void {
  if (!board) return;
  renderToolbar(board);
  renderSlides(board);
  renderPolls(board);
  renderOrder(board);
  if (preview) renderSplit(board, preview);
}

async function refresh(): Promise<void> {
  if (!id || saving > 0 || inFlight.length > 0 || document.hidden || document.querySelector("dialog[open]")) return;
  const requested = generation;
  try {
    const snapshot = await loadBoard(id);
    if (saving > 0 || inFlight.length > 0 || requested !== generation) return;
    accept(snapshot);
    if (me && !snapshot.meta.roster.some(member => member.name === me)) setMe("");
    render();
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    if (error.status === 404) {
      forgetBoard(localStorage, id);
      showMissing(error.message);
      return;
    }
    toast(`Could not refresh. ${error.message}`, true);
  }
}

function showMissing(reason: string): void {
  $("#missing").hidden = false;
  $("#missing-reason").textContent = reason;
  $("#title").textContent = "Board not found";
  document.querySelectorAll<HTMLElement>("[data-view-panel], .views-row, #me, #share, #more").forEach(element => { element.hidden = true; });
}

// The walkthrough plays once per browser for the board, and once for polls the first time Polls opens.
const SEEN = { board: "pys-coach-board", polls: "pys-coach-polls" };
let currentView = "slides";

function boardSteps(): CoachStep[] {
  const firstOpen = () => document.querySelector<HTMLElement>(".slide-row:has(.claim)") ?? document.querySelector<HTMLElement>(".slide-row");
  const steps: CoachStep[] = [
    { target: () => $("#me"), tap: true, title: me ? "This is you" : "Pick your name",
      text: me ? "Your claims and votes carry this name. Tap it if you need to switch." : "Tap here and choose yourself from the list. Your claims and votes carry your name." },
    { target: firstOpen, tap: true, title: "Tap a slide to claim it",
      text: "It's yours for the whole group at once. Tap it again to let it go." },
    { target: () => $('[data-view="polls"]'), title: "Polls live here",
      text: board?.meta.settings.membersCanPoll ? "Vote on when to practise, which template, anything. Anyone can start one." : "Vote on the organizer's polls here." },
  ];
  if (token) steps.push({ target: () => $("#more"), title: "Your organizer tools",
    text: "Split Evenly hands out the open slides. Board Settings edits the slides and members." });
  steps.push({ target: () => $("#help"), title: "Need this again?", text: "Tap ? any time to replay this." });
  return steps;
}

function pollSteps(): CoachStep[] {
  const steps: CoachStep[] = [];
  if (document.querySelector(".option")) {
    steps.push({ target: () => document.querySelector<HTMLElement>(".option:not(:disabled)") ?? document.querySelector<HTMLElement>(".option"), tap: true,
      title: "Tap an option to vote", text: "Tap it again to take your vote back. Some questions let you pick several." });
  }
  const newPoll = $<HTMLButtonElement>("#new-poll");
  if (!newPoll.hidden) steps.push({ target: () => newPoll, title: "Start your own poll", text: "One poll can ask several questions at once, like a time and a template." });
  return steps;
}

function updateHelp(): void {
  $("#help").dataset.shine = String(!stored(SEEN.board));
}

async function coach(kind: "board" | "polls", replay = false): Promise<void> {
  if (!board || coachRunning() || document.hidden || document.querySelector("dialog[open]")) return;
  if (!replay && stored(SEEN[kind])) return;
  if (kind === "board" && currentView !== "slides" && board.meta.slides.length) showView("slides");
  await runCoach(kind === "board" ? boardSteps() : pollSteps());
  // finished or skipped, it does not start on its own again
  store(SEEN[kind], "1");
  updateHelp();
}

function showView(name: string): void {
  for (const tab of document.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
    const active = tab.dataset.view === name;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    $(`#view-${tab.dataset.view}`).hidden = !active;
  }
  currentView = name;
  store("pys-view", name);
  if (name === "polls" && board) requestAnimationFrame(() => { void coach("polls"); });
}

function openSheet(selector: string): HTMLDialogElement {
  const dialog = $<HTMLDialogElement>(selector);
  dialog.showModal();
  return dialog;
}

function openSplit(): void {
  if (!board || !token) return;
  preview = previewSplit(board);
  renderSplit(board, preview);
  openSheet("#split-sheet");
}

function openSettings(): void {
  if (!board || !token) return;
  $<HTMLOutputElement>("#admin-link").value = `${memberUrl}#admin=${token}`;
  $<HTMLOutputElement>("#embed-snippet").value = `<script src="${location.origin}/embed.js" data-board="${id}" defer></script>`;
  if (!editLoaded) {
    editLoaded = true;
    boardForm($<HTMLFormElement>("#edit"), {
      initial: board.meta,
      submitLabel: null,
      async onSubmit({ board: edited, thumbs }) {
        if (!board || !id || !token) return;
        const dropped = Object.keys(board.claims).map(Number).filter(slide => slide > edited.slides.length);
        const removed = board.meta.roster.map(member => member.name).filter(name => !edited.roster.some(member => member.name === name));
        const version = thumbs ? Date.now() : board.meta.thumbs;
        if (!await change({ kind: "meta", board: edited, revision: board.revision, thumbs: version }, "Board saved")) {
          throw new Error("The board changed while you were editing. Close settings and open them again.");
        }
        $<HTMLDialogElement>("#settings-sheet").close();
        editLoaded = false;
        const notes = [
          dropped.length ? `Claims on slides ${compressRanges(dropped)} were removed.` : "",
          removed.length ? `${removed.join(", ")} removed with their claims and ratings.` : "",
        ].filter(Boolean).join(" ");
        if (notes) toast(notes);
        if (thumbs) {
          await uploadThumbs(id, token, thumbs, done => toast(`Uploading previews, ${done} of ${thumbs.length}…`));
          toast("Previews uploaded");
          void refresh();
        }
      },
    });
  }
  openSheet("#settings-sheet");
}

function start(): void {
  if (!id) {
    showMissing("Check the link, or make a new board.");
    return;
  }
  // My Boards opens a board's settings with #settings
  const wantsSettings = location.hash === "#settings";
  if (wantsSettings) history.replaceState(null, "", location.pathname);
  const fragment = new URLSearchParams(location.hash.slice(1)).get("admin");
  if (fragment) {
    store(`pys-admin-${id}`, fragment);
    // the organizer link should not stay in the address bar where screen shares can show it
    history.replaceState(null, "", location.pathname);
  }
  token = stored(`pys-admin-${id}`);
  me = stored(`pys-name-${id}`) ?? "";
  try {
    const cached = parseSnapshot(JSON.parse(stored(`pys-board-${id}`) ?? "null"));
    if (cached && cached.id === id) {
      accept(cached);
      render();
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }

  attachMenu($<HTMLButtonElement>("#me"), () => [
    ...(board?.meta.roster ?? []).map(member => ({ label: member.name, checked: member.name === me, color: member.color, action: () => setMe(member.name) })),
    ...(me ? ["separator" as const, { label: "Not me", action: () => setMe("") }] : []),
  ]);
  attachMenu($<HTMLButtonElement>("#more"), () => {
    const deckUrl = board?.meta.deckUrl;
    const items: MenuItem[] = [
      ...(deckUrl ? [{ label: "Open Deck", action: () => { window.open(deckUrl, "_blank", "noopener,noreferrer"); } }] : []),
      { label: "Copy for Group Chat", action: () => { void share(); } },
      { label: "Copy Board Link", action: () => { void copyText(memberUrl).then(ok => toast(ok ? "Link copied" : memberUrl)); } },
      { label: "My Boards", action: () => { location.href = "/#boards"; } },
      { label: "New Board", action: () => { location.href = "/#new"; } },
      { label: "About", action: () => { location.href = "/about/"; } },
    ];
    if (token) {
      items.push("separator", ...(board?.meta.slides.length ? [{ label: "Split Evenly…", action: openSplit }] : []), { label: "Board Settings…", action: openSettings });
      items.push({ label: "Delete Board…", destructive: true, action: () => { void deleteBoard(); } });
    }
    return items;
  });
  $("#share").addEventListener("click", () => { void share(); });

  for (const tab of document.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
    tab.addEventListener("click", () => showView(tab.dataset.view!));
    tab.addEventListener("keydown", event => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
      const next = tabs[(tabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      showView(next.dataset.view!);
      next.focus();
    });
  }
  showView(["slides", "polls", "order"].includes(stored("pys-view") ?? "") ? stored("pys-view")! : "slides");
  document.querySelectorAll('input[name="filter"]').forEach(input => input.addEventListener("change", render));

  for (const dialog of document.querySelectorAll<HTMLDialogElement>("dialog.sheet")) {
    dialog.querySelectorAll("[data-close]").forEach(close => close.addEventListener("click", () => dialog.close()));
    dialog.addEventListener("close", () => { void refresh(); });
  }

  $("#apply-split").addEventListener("click", async () => {
    if (!board || !preview || !id) return;
    // the split replaces every claim, so it is worked out again on the latest board before it is sent
    let latest: Snapshot;
    try {
      latest = await loadBoard(id);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      toast(error.message, true);
      return;
    }
    accept(latest);
    const fresh = previewSplit(withPending(latest));
    if (JSON.stringify(fresh.claims) !== JSON.stringify(preview.claims)) {
      preview = fresh;
      renderSplit(board!, fresh);
      render();
      toast("Someone claimed a slide just now. Check the split again, then apply.", true);
      return;
    }
    if (await change({ kind: "apply", claims: fresh.claims }, "Split applied")) {
      preview = null;
      $<HTMLDialogElement>("#split-sheet").close();
      showView("slides");
    }
  });
  $("#split-sheet").addEventListener("close", () => { preview = null; });

  $("#new-poll").addEventListener("click", () => {
    if (!requireName()) return;
    resetPollForm();
    openSheet("#poll-sheet");
    $<HTMLInputElement>(".q-text").focus();
  });
  $("#poll-add-question").addEventListener("click", () => {
    addQuestion();
    [...document.querySelectorAll<HTMLInputElement>(".q-text")].at(-1)?.focus();
  });
  $("#poll-form").addEventListener("submit", async event => {
    event.preventDefault();
    const name = requireName();
    if (!name) return;
    const clean = (text: string) => text.trim().replace(/\s+/g, " ");
    const questions = [...document.querySelectorAll<HTMLElement>(".question-block")].map(block => ({
      question: clean(block.querySelector<HTMLInputElement>(".q-text")!.value),
      options: block.querySelector<HTMLTextAreaElement>(".q-options")!.value.split(/\r?\n/).map(clean).filter(Boolean),
      multi: block.querySelector<HTMLInputElement>(".q-multi")!.checked,
    }));
    const broken = questions.findIndex(question => !question.question || question.options.length < 2);
    if (broken !== -1) {
      $("#poll-error").textContent = questions.length > 1
        ? `Question ${broken + 1} needs a question and at least two options.`
        : "Write a question and at least two options.";
      return;
    }
    if (await change({ kind: "poll", name, title: clean($<HTMLInputElement>("#poll-title").value), questions }, "Poll started")) {
      $<HTMLDialogElement>("#poll-sheet").close();
    }
  });
  $("#copy-embed").addEventListener("click", async () => {
    toast(await copyText($<HTMLOutputElement>("#embed-snippet").value) ? "Script tag copied" : "Copying is blocked here.");
  });
  $("#copy-admin").addEventListener("click", async () => {
    toast(await copyText($<HTMLOutputElement>("#admin-link").value) ? "Organizer link copied" : "Copying is blocked here.");
  });

  updateHelp();
  $("#help").addEventListener("click", () => { void coach(currentView === "polls" ? "polls" : "board", true); });
  void refresh().then(() => {
    if (wantsSettings && token && board) openSettings();
    // a board without slides yet is all polls, so it opens there and the polls walkthrough plays instead
    else if (board && board.meta.slides.length === 0) showView("polls");
    else if (board) void coach("board");
  });
  window.setInterval(() => { void refresh(); }, 8000);
  window.addEventListener("focus", () => { void refresh(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });
}

async function share(): Promise<void> {
  if (!board) return;
  toast(await copyText(messengerSummary(board, memberUrl)) ? "Copied. Paste it in the group chat." : "Copying is blocked in this browser.");
}

async function deleteBoard(): Promise<void> {
  if (!id || !await confirmAction("Delete this board?", "Slides, claims, ratings and polls are removed for everyone. This cannot be undone.", "Delete Board")) return;
  try {
    await request(`/api/boards/${id}`, { method: "DELETE" }, token);
    store(`pys-admin-${id}`, null);
    location.href = "/";
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    toast(error.message, true);
  }
}

start();
