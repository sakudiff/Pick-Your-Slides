import type { Bookmark } from "../create/pdf.ts";
import { loadChunk, request, StaleBuild } from "./api.ts";
import { boardError, isDeckUrl, isRecord, LIMITS, normalizeText, type BoardInput, type Meta } from "./model.ts";
import { namesFromOcr, rosterFrom, sectionsFrom, sectionsText } from "./parse.ts";
import { bookmarkSections, htmlDeckSlides, overlayRuns, pptxTitles, type DeckSection } from "./titles.ts";
import { button, el, plural, screenshotBubble, typingBubble } from "./ui.ts";

export type FormResult = { board: BoardInput; thumbs: Blob[] | null };
type Options = { initial: Meta | null; submitLabel: string | null; onSubmit(result: FormResult): Promise<void> };

let canvaStatus: Promise<boolean> | null = null;
function canvaEnabled(): Promise<boolean> {
  canvaStatus ??= request("/api/canva/status").then(value => isRecord(value) && value.enabled === true, () => false);
  return canvaStatus;
}

const SOURCE_HINTS: Record<string, string> = {
  manual: "Set the count, and add titles if you have them. Or import the deck.",
  pdf: "Export any deck as a PDF: Canva (Share, Download, PDF), Google Slides (File, Download, PDF), Keynote, or Overleaf for Beamer. Titles, sections and previews are read on this device.",
  pptx: "Titles are read from each slide's title or largest text, on this device.",
  none: "No slides for now, so the board starts with polls. Add the deck later from Board Settings.",
  link: "Paste a Google Slides deck shared with anyone who has the link, or an HTML deck you host, like a Netlify or reveal.js deck.",
};

const MARKUP = `
<section class="group">
  <div class="row field-row">
    <label for="f-title">Title</label>
    <input id="f-title" maxlength="${LIMITS.title}" placeholder="Title here" autocomplete="off">
  </div>
</section>

<h3 class="group-header" id="f-roster-label">Members</h3>
<section class="group" id="f-roster-group">
  <div class="tokens" id="f-roster">
    <input id="f-roster-input" aria-labelledby="f-roster-label" placeholder="Add a name, then Return" autocomplete="off" enterkeyhint="done">
  </div>
  <div class="row">
    <button type="button" class="plain" id="f-shot-pick">Import from Screenshot…</button>
    <input type="file" id="f-shot-file" accept="image/png,image/jpeg,image/webp" multiple hidden>
  </div>
  <div class="shot-review" id="f-shot-review" hidden>
    <p class="caption" id="f-shot-caption"></p>
    <div class="chips" id="f-shot-chips" role="group" aria-label="Names found in the screenshot"></div>
    <div class="shot-actions">
      <button type="button" class="plain" id="f-shot-cancel">Cancel</button>
      <button type="button" class="plain strong" id="f-shot-add">Add</button>
    </div>
  </div>
</section>
<p class="group-footer" id="f-shot-status" aria-live="polite">Paste a list, or drop or paste screenshots of a Messenger member list or Canvas group. Screenshots are read on this device and never uploaded.</p>

<h3 class="group-header">Slides</h3>
<section class="group">
  <div class="row">
    <label class="row-label" for="f-source">Source</label>
    <select id="f-source" class="popup">
      <option value="manual">Manual</option>
      <option value="pdf">PDF</option>
      <option value="pptx">PowerPoint</option>
      <option value="link">Link</option>
      <option value="none">None yet, polls only</option>
    </select>
  </div>
  <div class="row source-file" hidden>
    <input id="f-file" type="file" aria-label="Slide file">
  </div>
  <div class="row source-report" hidden>
    <div class="note-bubble"><p><strong>Looks like a report</strong> These pages are portrait, so this is probably a document, not slides. Each page became a slide. Check the titles, or pick the deck's PDF instead.</p></div>
  </div>
  <div class="row field-row source-link" hidden>
    <input id="f-link" type="url" inputmode="url" autocomplete="off" placeholder="https:// Google Slides or deck link" aria-label="Deck link to import">
    <button type="button" class="plain strong" id="f-link-go">Import</button>
  </div>
  <div class="row source-link-note" hidden>
    <div class="note-bubble">
      <p><strong>Google Slides</strong> Share the deck first. In Share, set General access to <em>Anyone with the link</em>, or the import can't read it.</p>
      <p class="note-canva"><strong>Canva</strong> Link import is in development. For now, in Canva choose Share, Download, PDF, then pick PDF as the source.</p>
    </div>
  </div>
  <label class="row switch-row" id="f-merge-row" hidden>
    <span id="f-merge-label">Merge overlay pages</span>
    <input id="f-merge" type="checkbox" role="switch" checked>
  </label>
  <div class="row count-row">
    <label class="row-label" for="f-count">Number of slides</label>
    <div class="stepper">
      <button type="button" data-step="-1" aria-label="One fewer slide">−</button>
      <input id="f-count" type="number" min="1" max="${LIMITS.slides}" value="12" inputmode="numeric">
      <button type="button" data-step="1" aria-label="One more slide">+</button>
    </div>
  </div>
  <div class="row stacked titles-row">
    <div class="stacked-head"><label class="row-label" for="f-titles">Slide titles <span class="optional">optional</span></label><span class="value" id="f-titles-count">None</span></div>
    <textarea id="f-titles" class="field" rows="6" placeholder="One title per line, in slide order"></textarea>
  </div>
  <div class="row clear-slides" hidden>
    <button type="button" class="plain destructive" id="f-clear">Clear Slides</button>
  </div>
</section>
<p class="group-footer" id="f-file-status" aria-live="polite">${SOURCE_HINTS.manual}</p>

<details class="group disclosure-group">
  <summary class="row">More options</summary>
  <div class="row">
    <span class="row-label">Split by</span>
    <div class="segmented" role="radiogroup" aria-label="Split by">
      <label><input type="radio" name="f-unit" value="slide" checked><span>Slide</span></label>
      <label><input type="radio" name="f-unit" value="section"><span>Section</span></label>
    </div>
  </div>
  <div class="row stacked">
    <label class="row-label" for="f-sections">Sections</label>
    <textarea id="f-sections" class="field" rows="3" placeholder="A slide range and a title per line"></textarea>
  </div>
  <div class="row field-row">
    <label for="f-deck">Deck link</label>
    <input id="f-deck" type="url" inputmode="url" maxlength="${LIMITS.url}" placeholder="Optional" autocomplete="off">
  </div>
  <div class="row field-row">
    <label for="f-date">Presenting on</label>
    <input id="f-date" type="date">
  </div>
  <label class="row switch-row">
    <span>Members can start polls</span>
    <input id="f-polls" type="checkbox" role="switch" checked>
  </label>
</details>
<p class="form-error" id="f-error" role="alert"></p>`;

export function boardForm(form: HTMLFormElement, options: Options): void {
  form.innerHTML = MARKUP;
  const field = <T extends HTMLElement>(selector: string) => form.querySelector<T>(selector)!;
  const title = field<HTMLInputElement>("#f-title");
  const tokens = field<HTMLDivElement>("#f-roster");
  const tokenInput = field<HTMLInputElement>("#f-roster-input");
  const count = field<HTMLInputElement>("#f-count");
  const titles = field<HTMLTextAreaElement>("#f-titles");
  const sections = field<HTMLTextAreaElement>("#f-sections");
  const date = field<HTMLInputElement>("#f-date");
  const polls = field<HTMLInputElement>("#f-polls");
  const file = field<HTMLInputElement>("#f-file");
  const sourcePicker = field<HTMLSelectElement>("#f-source");
  const link = field<HTMLInputElement>("#f-link");
  const linkGo = field<HTMLButtonElement>("#f-link-go");
  const deck = field<HTMLInputElement>("#f-deck");
  const mergeRow = field<HTMLLabelElement>("#f-merge-row");
  const merge = field<HTMLInputElement>("#f-merge");
  const fileStatus = field<HTMLParagraphElement>("#f-file-status");
  const error = field<HTMLParagraphElement>("#f-error");
  let submit: HTMLButtonElement | null = null;
  if (options.submitLabel) {
    submit = el("button", "primary wide", options.submitLabel);
    submit.type = "submit";
    form.append(submit);
  }
  let thumbs: Blob[] | null = null;
  const names: string[] = [];
  let refreshShotBubble = (): void => {};

  const renderTokens = (): void => {
    tokens.querySelectorAll(".token").forEach(token => token.remove());
    for (const name of names) {
      const token = el("span", "token", name);
      token.append(button("×", "token-remove", () => {
        names.splice(names.indexOf(name), 1);
        renderTokens();
        tokenInput.focus();
      }));
      token.lastElementChild!.setAttribute("aria-label", `Remove ${name}`);
      tokens.insertBefore(token, tokenInput);
    }
    refreshShotBubble();
    tokenInput.placeholder = names.length >= LIMITS.roster ? "Group is full" : names.length ? "Add another" : "Add a name, then Return";
    tokenInput.disabled = names.length >= LIMITS.roster;
  };
  const addNames = (text: string): void => {
    for (const raw of text.split(/[\n,;]+/)) {
      const name = normalizeText(raw).slice(0, LIMITS.name).trim();
      if (name && names.length < LIMITS.roster && !names.some(existing => existing.toLowerCase() === name.toLowerCase())) names.push(name);
    }
    tokenInput.value = "";
    renderTokens();
  };
  tokenInput.addEventListener("keydown", event => {
    if ((event.key === "Enter" || event.key === ",") && tokenInput.value.trim()) {
      event.preventDefault();
      addNames(tokenInput.value);
    } else if (event.key === "Enter") event.preventDefault();
    else if (event.key === "Backspace" && tokenInput.value === "" && names.length > 0) {
      names.pop();
      renderTokens();
    }
  });
  tokenInput.addEventListener("paste", event => {
    const pasted = [...event.clipboardData?.files ?? []].filter(item => item.type.startsWith("image/"));
    if (pasted.length) {
      event.preventDefault();
      void readShots(pasted);
      return;
    }
    const text = event.clipboardData?.getData("text") ?? "";
    if (!/[\n,;]/.test(text)) return;
    event.preventDefault();
    addNames(text);
  });
  tokenInput.addEventListener("blur", () => { if (tokenInput.value.trim()) addNames(tokenInput.value); });
  tokens.addEventListener("click", event => { if (event.target === tokens) tokenInput.focus(); });

  const shotFile = field<HTMLInputElement>("#f-shot-file");
  const shotReview = field<HTMLDivElement>("#f-shot-review");
  const shotChips = field<HTMLDivElement>("#f-shot-chips");
  const shotAdd = field<HTMLButtonElement>("#f-shot-add");
  const shotStatus = field<HTMLParagraphElement>("#f-shot-status");
  const shotHint = shotStatus.textContent ?? "";
  const pickedNames = (): string[] => [...shotChips.querySelectorAll<HTMLButtonElement>('[aria-pressed="true"]')].map(chip => chip.dataset.name!);
  const updateShotAdd = (): void => {
    const picked = pickedNames().length;
    shotAdd.textContent = picked === 1 ? "Add 1 Name" : `Add ${picked} Names`;
    shotAdd.disabled = picked === 0;
  };
  const closeShot = (message = shotHint): void => {
    shotReview.hidden = true;
    shotChips.replaceChildren();
    shotStatus.textContent = message;
  };
  const readShots = async (images: Blob[]): Promise<void> => {
    if (images.length === 0) return;
    if (names.length >= LIMITS.roster) {
      shotStatus.textContent = `The group is full at ${LIMITS.roster} people.`;
      return;
    }
    shotStatus.textContent = "Loading the text reader…";
    try {
      const { screenshotLines } = await loadChunk(() => import("../create/ocr.ts"));
      const found = namesFromOcr(await screenshotLines(images, text => { shotStatus.textContent = text; }), names);
      if (found.length === 0) {
        closeShot("No new names were found. Crop the screenshot to the member list, or type the names.");
        return;
      }
      shotChips.replaceChildren(...found.map(name => {
        const chip = button(name, "chip", () => {
          chip.setAttribute("aria-pressed", String(chip.getAttribute("aria-pressed") !== "true"));
          updateShotAdd();
        });
        chip.dataset.name = name;
        chip.setAttribute("aria-pressed", "true");
        return chip;
      }));
      field("#f-shot-caption").textContent = `Found ${found.length === 1 ? "1 name" : `${found.length} names`}. Tap any that are wrong to leave them out.`;
      shotReview.hidden = false;
      shotStatus.textContent = "";
      updateShotAdd();
      shotAdd.focus();
    } catch (failure) {
      if (reloadForUpdate(failure, "shot")) return;
      closeShot(failure instanceof Error ? `The screenshot could not be read. ${failure.message}` : "The screenshot could not be read.");
    }
  };
  const imagesIn = (files: FileList | null | undefined): Blob[] => [...files ?? []].filter(item => item.type.startsWith("image/"));
  // the reader is 7 MB, so it starts loading on a clear sign of intent, while the file picker is still open
  const warm = (): void => { void loadChunk(() => import("../create/ocr.ts")).then(module => module.warmReader()).catch(() => {}); };
  const shotPick = field<HTMLButtonElement>("#f-shot-pick");
  for (const signal of ["pointerenter", "pointerdown", "focus"]) shotPick.addEventListener(signal, warm, { once: true });
  shotPick.addEventListener("click", () => shotFile.click());
  shotFile.addEventListener("change", () => {
    void readShots(imagesIn(shotFile.files));
    shotFile.value = "";
  });
  field("#f-shot-cancel").addEventListener("click", () => closeShot());
  shotAdd.addEventListener("click", () => {
    addNames(pickedNames().join("\n"));
    closeShot();
    tokenInput.focus();
  });
  const rosterGroup = field<HTMLElement>("#f-roster-group");
  refreshShotBubble = screenshotBubble(tokenInput, rosterGroup, () => names.length > 0, shotPick);
  rosterGroup.addEventListener("dragover", event => {
    if (![...event.dataTransfer?.items ?? []].some(item => item.type.startsWith("image/"))) return;
    warm();
    event.preventDefault();
    rosterGroup.dataset.drop = "true";
  });
  rosterGroup.addEventListener("dragleave", () => { delete rosterGroup.dataset.drop; });
  rosterGroup.addEventListener("drop", event => {
    delete rosterGroup.dataset.drop;
    const images = imagesIn(event.dataTransfer?.files);
    if (images.length === 0) return;
    event.preventDefault();
    void readShots(images);
  });

  const titleLines = (): string[] => {
    const lines = titles.value.split(/\r?\n/).map(line => normalizeText(line));
    while (lines.length > 0 && lines.at(-1) === "") lines.pop();
    return lines;
  };
  const updateTitleCount = (): void => {
    const named = titleLines().filter(Boolean).length;
    field("#f-titles-count").textContent = named ? `${named} of ${Math.max(Number(count.value) || 0, titleLines().length)}` : "None";
  };
  titles.addEventListener("input", updateTitleCount);
  count.addEventListener("input", () => {
    if (thumbs && Number(count.value) !== thumbs.length) thumbs = null;
    updateTitleCount();
  });
  form.querySelectorAll<HTMLButtonElement>("[data-step]").forEach(step => step.addEventListener("click", () => {
    count.value = String(Math.min(LIMITS.slides, Math.max(1, (Number(count.value) || 0) + Number(step.dataset.step))));
    count.dispatchEvent(new Event("input"));
  }));

  const { initial } = options;
  if (initial) {
    title.value = initial.title;
    names.push(...initial.roster.map(member => member.name));
    count.value = String(initial.slides.length || 12);
    titles.value = initial.slides.map(slide => slide.title).join("\n").replace(/\n+$/, "");
    sections.value = sectionsText(initial.sections);
    date.value = initial.settings.presentationDate ?? "";
    deck.value = initial.deckUrl ?? "";
    polls.checked = initial.settings.membersCanPoll;
    field<HTMLInputElement>(`input[name="f-unit"][value="${initial.settings.unit}"]`).checked = true;
  }
  renderTokens();
  updateTitleCount();
  typingBubble(titles, ["Introduction", "Background of the study"]);
  typingBubble(sections, ["1-3 Introduction", "4-8 Analysis"]);

  const source = (): string => sourcePicker.value;
  // a Beamer PDF keeps every overlay page until the organizer decides whether to merge them
  let pdfPages: { titles: string[]; thumbs: Blob[]; runs: number[][]; portrait: boolean; bookmarks: Bookmark[] } | null = null;
  // titles typed by the organizer stay put, but titles read from a file go when the next file fails
  let titlesImported = false;
  let sectionsImported = false;
  let deckImported = false;
  titles.addEventListener("input", () => { titlesImported = false; });
  sections.addEventListener("input", () => { sectionsImported = false; });
  deck.addEventListener("input", () => { deckImported = false; });
  const clearRow = field<HTMLDivElement>(".clear-slides");
  const updateClear = (): void => {
    clearRow.hidden = source() === "none" || !(titles.value.trim() || sections.value.trim() || thumbs || pdfPages || file.value);
  };
  for (const input of [titles, sections, count]) input.addEventListener("input", updateClear);
  updateClear();
  const clearImported = (): void => {
    if (!titlesImported) return;
    titles.value = "";
    titlesImported = false;
    updateTitleCount();
  };

  const applyImport = (found: string[], images: Blob[] | null, foundSections: DeckSection[], message: string): void => {
    thumbs = images;
    count.value = String(found.length);
    titles.value = found.map((text, index) => text || `Slide ${index + 1}`).join("\n");
    if (foundSections.length) {
      sections.value = sectionsText(foundSections);
      sectionsImported = true;
      field<HTMLDetailsElement>(".disclosure-group").open = true;
    } else if (sectionsImported) {
      // sections read from the previous file do not fit this one
      sections.value = "";
      sectionsImported = false;
      field<HTMLInputElement>('input[name="f-unit"][value="slide"]').checked = true;
    }
    titlesImported = true;
    updateTitleCount();
    updateClear();
    fileStatus.textContent = message;
  };
  const reportNote = field<HTMLDivElement>(".source-report");
  const applyPdf = (): void => {
    if (!pdfPages) return;
    const { runs } = pdfPages;
    const merged = merge.checked && runs.length < pdfPages.titles.length;
    // the last overlay step shows the whole frame, so it names and previews the slide
    const pick = (index: number[]) => merged ? index.at(-1)! : index[0];
    const pages = merged ? runs.map(pick) : pdfPages.titles.map((_, index) => index);
    const slideRuns = merged ? runs : pdfPages.titles.map((_, index) => [index]);
    applyImport(pages.map(page => pdfPages!.titles[page]), pages.map(page => pdfPages!.thumbs[page]), bookmarkSections(pdfPages.bookmarks, slideRuns), [
      `Found ${plural(pages.length, "slide")}${merged ? ` in ${plural(pdfPages.titles.length, "page")}` : ""}.`,
      pdfPages.portrait ? "" : "Check the titles and fix any that came out wrong.",
    ].filter(Boolean).join(" "));
    reportNote.hidden = !pdfPages.portrait;
  };
  merge.addEventListener("change", applyPdf);

  sourcePicker.addEventListener("change", () => {
    const kind = source();
    field<HTMLDivElement>(".source-file").hidden = kind === "manual" || kind === "link";
    field<HTMLDivElement>(".source-link").hidden = kind !== "link";
    field<HTMLDivElement>(".source-link-note").hidden = kind !== "link";
    if (kind === "link") void canvaEnabled().then(enabled => { field<HTMLParagraphElement>(".note-canva").hidden = enabled; });
    for (const row of [".count-row", ".titles-row"]) field<HTMLDivElement>(row).hidden = kind === "none";
    mergeRow.hidden = true;
    reportNote.hidden = true;
    pdfPages = null;
    fileStatus.textContent = SOURCE_HINTS[kind];
    file.accept = {
      pdf: "application/pdf,.pdf",
      pptx: ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation",
    }[kind] ?? "";
    file.value = "";
    if (kind === "link") link.focus();
    else if (kind === "pdf" || kind === "pptx") file.click();
    updateClear();
  });
  if (initial && initial.slides.length === 0) {
    sourcePicker.value = "none";
    sourcePicker.dispatchEvent(new Event("change"));
  }

  const busy = async (work: () => Promise<void>, fallback: string): Promise<void> => {
    if (submit) submit.disabled = true;
    linkGo.disabled = true;
    try {
      await work();
    } catch (failure) {
      thumbs = null;
      clearImported();
      if (reloadForUpdate(failure, source())) return;
      fileStatus.textContent = failure instanceof Error ? failure.message : fallback;
    } finally {
      if (submit) submit.disabled = false;
      linkGo.disabled = false;
      updateClear();
    }
  };

  const importPdf = async (blob: Blob): Promise<void> => {
    const { readPdf } = await loadChunk(() => import("../create/pdf.ts"));
    const imported = await readPdf(blob, (done, total) => { fileStatus.textContent = `Reading page ${done} of ${total}…`; });
    const runs = overlayRuns(imported.labels);
    pdfPages = { titles: imported.titles, thumbs: imported.thumbs, runs: runs.length ? runs : imported.titles.map((_, index) => [index]), portrait: imported.portrait, bookmarks: imported.bookmarks };
    if (pdfPages.runs.length < imported.titles.length) {
      field("#f-merge-label").textContent = `Merge ${imported.titles.length} overlay pages into ${pdfPages.runs.length} slides`;
      mergeRow.hidden = false;
    }
    applyPdf();
  };

  file.addEventListener("change", () => {
    const chosen = file.files?.[0];
    if (!chosen) return;
    fileStatus.textContent = "Reading the slides…";
    mergeRow.hidden = true;
    reportNote.hidden = true;
    pdfPages = null;
    void busy(async () => {
      if (source() === "pdf") {
        await importPdf(chosen);
      } else {
        applyImport(pptxTitles(new Uint8Array(await chosen.arrayBuffer()), new DOMParser()), null, [], "");
        fileStatus.textContent = `Found ${plural(Number(count.value), "slide")}. Check the titles and fix any that came out wrong.`;
      }
    }, "The file could not be read.");
  });

  const importLink = (): void => {
    const address = link.value.trim();
    if (!address) return;
    if (!isDeckUrl(address)) {
      fileStatus.textContent = "Paste a full https link.";
      return;
    }
    deck.value = address;
    deckImported = true;
    const host = new URL(address).hostname;
    if (/(?:^|\.)canva\.com$/.test(host)) {
      void busy(async () => {
        // signing in to Canva leaves the page, so only the create page offers it, and the draft is kept for the return
        if (options.initial === null && /\/design\//.test(address) && await canvaEnabled()) {
          fileStatus.textContent = "Opening Canva…";
          const started = await request("/api/canva/start", { method: "POST", body: JSON.stringify({ designUrl: address }) });
          if (!isRecord(started) || typeof started.url !== "string") throw new Error("Canva sign-in could not start.");
          saveDraft();
          location.assign(started.url);
          return;
        }
        fileStatus.textContent = "Canva link import is in development. For now, in Canva choose Share, Download, PDF Standard, then pick PDF as the source. The link is saved as the board's deck link.";
      }, "Canva sign-in could not start.");
      return;
    }
    if (host === "docs.google.com" && /\/presentation\//.test(address)) {
      const fallback = "Google Slides could not export the deck. Choose File, Download, PDF Document, then pick PDF as the source. The link is saved as the board's deck link.";
      fileStatus.textContent = "Asking Google Slides for the PDF…";
      void busy(async () => {
        const response = await fetch("/api/fetch-deck", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: address }), cache: "no-store",
        });
        if (!response.ok || !/^application\/pdf\b/.test(response.headers.get("Content-Type") ?? "")) {
          const problem: unknown = await response.json().catch(() => null);
          throw new Error(isRecord(problem) && typeof problem.error === "string" ? problem.error : fallback);
        }
        sourcePicker.value = "pdf";
        await importPdf(await response.blob());
      }, fallback);
      return;
    }
    fileStatus.textContent = "Fetching the deck…";
    void busy(async () => {
      const result = await request("/api/fetch-deck", { method: "POST", body: JSON.stringify({ url: address }) });
      if (!isRecord(result) || typeof result.html !== "string" || typeof result.finalUrl !== "string") throw new Error("The deck could not be read.");
      // DOMParser builds an inert document, so the deck's scripts never run here
      const outline = htmlDeckSlides(new DOMParser().parseFromString(result.html, "text/html"));
      if (isDeckUrl(result.finalUrl)) deck.value = result.finalUrl;
      if (outline.titles.length === 0) {
        clearImported();
        fileStatus.textContent = "This deck builds its slides with JavaScript. Type the count, or import its PDF. The link is saved as the board's deck link.";
        return;
      }
      applyImport(outline.titles, null, outline.sections, `Found ${plural(outline.titles.length, "slide")}. Check the titles and fix any that came out wrong.`);
    }, "The deck could not be fetched.");
  };
  linkGo.addEventListener("click", importLink);

  // a wrong file can be undone in one go, keeping the title and members
  field<HTMLButtonElement>("#f-clear").addEventListener("click", () => {
    thumbs = null;
    pdfPages = null;
    titles.value = "";
    titlesImported = false;
    sections.value = "";
    sectionsImported = false;
    if (deckImported) deck.value = "";
    deckImported = false;
    link.value = "";
    count.value = "12";
    field<HTMLInputElement>('input[name="f-unit"][value="slide"]').checked = true;
    sourcePicker.value = "manual";
    sourcePicker.dispatchEvent(new Event("change"));
    updateTitleCount();
    updateClear();
    fileStatus.textContent = "Slides cleared. Set the count, or pick another deck.";
    sourcePicker.focus();
  });
  link.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    importLink();
  });

  const DRAFT = "pys-draft";
  const saveDraft = (): void => {
    try {
      sessionStorage.setItem(DRAFT, JSON.stringify({
        title: title.value, names, deck: deck.value, date: date.value, polls: polls.checked, sections: sections.value,
      }));
    } catch (failure) {
      if (!(failure instanceof DOMException)) throw failure;
    }
  };
  const restoreDraft = (): void => {
    let draft: unknown = null;
    try {
      draft = JSON.parse(sessionStorage.getItem(DRAFT) ?? "null");
      sessionStorage.removeItem(DRAFT);
    } catch (failure) {
      if (!(failure instanceof DOMException) && !(failure instanceof SyntaxError)) throw failure;
    }
    if (!isRecord(draft)) return;
    if (typeof draft.title === "string") title.value = draft.title;
    if (Array.isArray(draft.names)) addNames(draft.names.filter(name => typeof name === "string").join("\n"));
    if (typeof draft.deck === "string") deck.value = draft.deck;
    if (typeof draft.date === "string") date.value = draft.date;
    if (typeof draft.polls === "boolean") polls.checked = draft.polls;
    if (typeof draft.sections === "string") sections.value = draft.sections;
  };
  // the create page reloads into the new build and keeps what was typed, but a file picked before cannot be carried over
  const reloadForUpdate = (failure: unknown, kind: string): boolean => {
    if (!(failure instanceof StaleBuild) || options.initial !== null) return false;
    saveDraft();
    location.replace(`${location.pathname}?updated=${encodeURIComponent(kind)}#new`);
    return true;
  };
  const continueCanva = async (): Promise<void> => {
    fileStatus.textContent = "Asking Canva for the design…";
    const started = await request("/api/canva/import", { method: "POST", body: "{}" });
    if (!isRecord(started) || typeof started.job !== "string") throw new Error("Canva did not start the export.");
    if (typeof started.title === "string" && !title.value.trim()) title.value = started.title.slice(0, LIMITS.title);
    const pages = typeof started.pages === "number" ? started.pages : null;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      fileStatus.textContent = "Canva is exporting the PDF…";
      const response = await fetch(`/api/canva/export/${started.job}`, { cache: "no-store" });
      if (response.status === 202) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        continue;
      }
      if (response.ok) {
        sourcePicker.value = "pdf";
        await importPdf(await response.blob());
        return;
      }
      const problem: unknown = await response.json().catch(() => null);
      if (isRecord(problem) && problem.tooLarge === true && pages) {
        applyImport(Array.from({ length: Math.min(pages, LIMITS.slides) }, () => ""), null, [], String(problem.error));
        return;
      }
      throw new Error(isRecord(problem) && typeof problem.error === "string" ? problem.error : "Canva could not export the design.");
    }
    throw new Error("Canva took too long to export. Try again, or download the PDF yourself.");
  };
  if (options.initial === null) {
    const query = new URLSearchParams(location.search);
    const outcome = query.get("canva");
    const updated = query.get("updated");
    if (updated) {
      history.replaceState(null, "", `${location.pathname}#new`);
      restoreDraft();
      requestAnimationFrame(() => form.scrollIntoView({ block: "start" }));
      const message = "Pick your slides was updated while this page was open, so it reloaded and kept what you typed.";
      if (updated === "shot") shotStatus.textContent = `${message} Pick the screenshot again.`;
      else if (updated in SOURCE_HINTS) {
        sourcePicker.value = updated;
        sourcePicker.dispatchEvent(new Event("change"));
        if (updated === "link") link.value = deck.value;
        fileStatus.textContent = `${message} ${updated === "link" ? "Import the link again." : "Pick the file again."}`;
      }
    } else if (outcome) {
      history.replaceState(null, "", `${location.pathname}#new`);
      restoreDraft();
      requestAnimationFrame(() => form.scrollIntoView({ block: "start" }));
      sourcePicker.value = "link";
      sourcePicker.dispatchEvent(new Event("change"));
      link.value = deck.value;
      if (outcome === "ready") void busy(continueCanva, "The Canva import failed.");
      else fileStatus.textContent = {
        denied: "Canva access was not allowed. Download the PDF from Canva instead, or try again.",
        expired: "The Canva sign-in took too long. Import the link again.",
      }[outcome] ?? "Canva sign-in failed. Try again, or download the PDF from Canva.";
    }
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (tokenInput.value.trim()) addNames(tokenInput.value);
    // names found in a screenshot are selected by default, so creating the board takes them as meant
    if (!shotReview.hidden && pickedNames().length) {
      addNames(pickedNames().join("\n"));
      closeShot();
    }
    const named = titleLines();
    const total = source() === "none" ? 0 : Math.max(Number(count.value) || 0, named.length);
    const parsed = sectionsFrom(sections.value);
    const board: BoardInput = {
      title: normalizeText(title.value),
      slides: Array.from({ length: total }, (_, index) => ({ title: (named[index] ?? "").slice(0, LIMITS.title) })),
      sections: parsed.sections,
      roster: rosterFrom(names.join("\n"), initial?.roster),
      settings: {
        unit: field<HTMLInputElement>('input[name="f-unit"]:checked').value as "slide" | "section",
        membersCanPoll: polls.checked,
        presentationDate: date.value || null,
      },
      deckUrl: deck.value.trim() || null,
    };
    const problem = parsed.error ?? boardError(board);
    error.textContent = problem ?? "";
    if (problem) {
      if (/section|deck link/i.test(problem)) field<HTMLDetailsElement>(".disclosure-group").open = true;
      return;
    }
    const controls = [submit, ...document.querySelectorAll<HTMLButtonElement>(`button[form="${form.id}"]`)].filter(Boolean) as HTMLButtonElement[];
    controls.forEach(control => { control.disabled = true; });
    try {
      await options.onSubmit({ board, thumbs: thumbs && thumbs.length === total ? thumbs : null });
      thumbs = null;
    } catch (failure) {
      error.textContent = failure instanceof Error ? failure.message : "Saving failed. Try again.";
    } finally {
      controls.forEach(control => { control.disabled = false; });
    }
  });
}
