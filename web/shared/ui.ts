export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

export function button(label: string, className = "", onClick?: () => void): HTMLButtonElement {
  const element = el("button", className, label);
  element.type = "button";
  if (onClick) element.addEventListener("click", onClick);
  return element;
}

export type MenuItem =
  | { label: string; action(): void; destructive?: boolean; checked?: boolean; color?: string }
  | "separator";

let menu: HTMLDivElement | null = null;
let opener: HTMLButtonElement | null = null;

// One popover element serves every menu, so light dismiss and Escape come from the browser.
function menuElement(): HTMLDivElement {
  if (menu) return menu;
  menu = el("div", "menu");
  menu.popover = "auto";
  menu.setAttribute("role", "menu");
  menu.addEventListener("toggle", event => {
    const open = (event as ToggleEvent).newState === "open";
    opener?.setAttribute("aria-expanded", String(open));
    if (!open) opener = null;
  });
  menu.addEventListener("keydown", event => {
    const items = [...menu!.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
    }
  });
  document.body.append(menu);
  return menu;
}

export function attachMenu(trigger: HTMLButtonElement, items: () => MenuItem[]): void {
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  trigger.addEventListener("click", () => {
    const popover = menuElement();
    if (opener === trigger) {
      popover.hidePopover();
      return;
    }
    // a modal dialog makes the rest of the page inert, so a menu opened from inside one must live there too
    const host = trigger.closest("dialog") ?? document.body;
    if (popover.parentElement !== host) host.append(popover);
    popover.replaceChildren();
    for (const item of items()) {
      if (item === "separator") {
        popover.append(el("div", "menu-separator"));
        continue;
      }
      const row = button(item.label, item.destructive ? "destructive" : "", () => {
        popover.hidePopover();
        trigger.focus();
        item.action();
      });
      row.setAttribute("role", item.checked === undefined ? "menuitem" : "menuitemradio");
      if (item.checked !== undefined) row.setAttribute("aria-checked", String(item.checked));
      if (item.color) row.style.setProperty("--person-color", item.color);
      popover.append(row);
    }
    popover.showPopover();
    opener = trigger;
    trigger.setAttribute("aria-expanded", "true");
    const anchor = trigger.getBoundingClientRect();
    const { width, height } = popover.getBoundingClientRect();
    const left = Math.min(Math.max(8, anchor.right - width), innerWidth - width - 8);
    const below = anchor.bottom + 6 + height <= innerHeight - 8;
    popover.style.left = `${left}px`;
    popover.style.top = `${below ? anchor.bottom + 6 : Math.max(8, anchor.top - 6 - height)}px`;
    popover.querySelector<HTMLButtonElement>("button")?.focus();
  });
}

let toastTimer: number | undefined;
export function toast(text: string, error = false): void {
  let element = document.querySelector<HTMLDivElement>(".toast");
  if (!element) {
    element = el("div", "toast");
    element.setAttribute("role", "status");
    element.setAttribute("aria-live", "polite");
    document.body.append(element);
  }
  element.textContent = text;
  element.dataset.error = String(error);
  element.dataset.visible = "true";
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { element!.dataset.visible = "false"; }, error ? 6000 : 2800);
}

// Mirrors an action sheet: the destructive choice sits apart from the menu that offered it.
export function confirmAction(title: string, detail: string, confirmLabel: string): Promise<boolean> {
  const dialog = el("dialog", "sheet alert");
  const body = el("div", "alert-body");
  body.append(el("h2", "", title), el("p", "", detail));
  const actions = el("div", "alert-actions");
  const cancel = button("Cancel", "", () => dialog.close("cancel"));
  const confirm = button(confirmLabel, "destructive", () => dialog.close("confirm"));
  actions.append(cancel, confirm);
  dialog.append(body, actions);
  document.body.append(dialog);
  dialog.showModal();
  cancel.focus();
  return new Promise(resolve => {
    dialog.addEventListener("close", () => {
      resolve(dialog.returnValue === "confirm");
      dialog.remove();
    }, { once: true });
  });
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function initials(name: string): string {
  const parts = name.replace(/,/g, " ").split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts.at(-1)![0] : name.slice(0, 2)).toUpperCase();
}

// The first name, or the first name and last initial when someone else on the roster shares it.
// "Cruz, Ana" is read as Ana Cruz.
export function shortName(name: string, roster: string[]): string {
  const parts = (name.includes(",") ? `${name.split(",").slice(1).join(" ")} ${name.split(",")[0]}` : name).trim().split(/\s+/);
  if (parts.length < 2) return name;
  const first = (full: string) => (full.includes(",") ? full.split(",")[1] : full).trim().split(/\s+/)[0].toLowerCase();
  const shared = roster.filter(other => other !== name && first(other) === parts[0].toLowerCase()).length > 0;
  return shared ? `${parts[0]} ${parts.at(-1)![0]}.` : parts[0];
}

class Stopped extends Error {}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Stopped());
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Stopped());
    }, { once: true });
  });
}

// While a multi-line field is focused and holds fewer than two lines, a bubble under it plays someone
// typing the first example, pressing Return, then typing the second. It sits below the field, so the
// field never moves as it opens. It is decoration only, and the placeholder carries the words for screen readers.
export function typingBubble(textarea: HTMLTextAreaElement, lines: [string, string]): void {
  const bubble = el("div", "typing-bubble");
  bubble.setAttribute("aria-hidden", "true");
  bubble.hidden = true;
  const screen = el("span", "typing-screen");
  const rows = [el("span", "typing-line"), el("span", "typing-line")];
  const key = el("span", "typing-key", "Return");
  screen.append(...rows);
  bubble.append(el("span", "typing-label", "One per line"), screen, key);
  textarea.after(bubble);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let run: AbortController | null = null;
  let dismissed = false;

  const caretOn = (index: number): void => rows.forEach((row, at) => { row.dataset.caret = String(at === index); });
  const loop = async (signal: AbortSignal): Promise<void> => {
    for (;;) {
      rows.forEach(row => { row.textContent = ""; });
      for (const [index, line] of lines.entries()) {
        caretOn(index);
        for (const character of line) {
          rows[index].textContent += character;
          await pause(65, signal);
        }
        await pause(index === 0 ? 380 : 1700, signal);
        if (index === 0) {
          key.dataset.press = "true";
          await pause(180, signal);
          key.dataset.press = "false";
        }
      }
    }
  };
  const filled = (): boolean => textarea.value.split(/\r?\n/).filter(line => line.trim() !== "").length >= 2;
  const hide = (): void => {
    run?.abort();
    run = null;
    bubble.hidden = true;
  };
  const show = (): void => {
    if (dismissed || filled()) return hide();
    if (!bubble.hidden) return;
    bubble.hidden = false;
    if (reduced.matches) {
      rows.forEach((row, index) => { row.textContent = lines[index]; });
      caretOn(-1);
      return;
    }
    run = new AbortController();
    loop(run.signal).catch(error => {
      if (!(error instanceof Stopped)) throw error;
    });
  };
  textarea.addEventListener("focus", show);
  textarea.addEventListener("input", show);
  textarea.addEventListener("blur", () => {
    dismissed = false;
    hide();
  });
  textarea.addEventListener("keydown", event => {
    if (event.key !== "Escape" || bubble.hidden) return;
    dismissed = true;
    hide();
  });
}

const SHOT_PEOPLE = [
  { name: "Ana Reyes", color: "#a9d7ec" }, { name: "Ben Cruz", color: "#c5b7e6" },
  { name: "Cy Lim", color: "#f2b8c6" }, { name: "Dee Santos", color: "#f0c38e" },
];
const SHOT_KINDS = [
  { kind: "chat", title: "Members", meta: "4", roles: ["Admin", "", "", ""], caption: "a group chat's member list" },
  { kind: "class", title: "People", meta: "Search", roles: ["Student", "Student", "Student", "Student"], caption: "a class People page" },
] as const;

// While the member field is focused and empty, a bubble under it acts out the screenshot import: a phone
// shows a member list, the screen flashes as it is captured, the shot shrinks to a thumbnail and is read,
// and the names land as chips. It alternates a group chat with a class People page. Decoration only.
// Returns a check the caller runs after names change, since adding names from code sends no input event.
export function screenshotBubble(input: HTMLInputElement, host: HTMLElement, hasNames: () => boolean, hover: HTMLElement): () => void {
  const row = el("div", "row shot-row");
  row.hidden = true;
  row.setAttribute("aria-hidden", "true");
  const bubble = el("div", "shot-bubble");
  const phone = el("div", "shot-phone");
  const head = el("div", "shot-head");
  const list = el("div", "shot-list");
  const flash = el("div", "shot-flash");
  const scan = el("div", "shot-scan");
  phone.append(head, list, flash, scan);
  const side = el("div", "shot-side");
  const caption = el("p", "shot-caption");
  const chips = el("div", "shot-chips");
  side.append(caption, chips);
  bubble.append(phone, side);
  row.append(bubble);
  host.append(row);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let run: AbortController | null = null;
  let dismissed = false;
  let pointer = false;

  const draw = (index: number): void => {
    const view = SHOT_KINDS[index];
    phone.dataset.kind = view.kind;
    phone.dataset.stage = "list";
    head.replaceChildren(el("span", "shot-back", "‹"), el("strong", "", view.title), el("span", "shot-meta", view.meta));
    list.replaceChildren(...SHOT_PEOPLE.map((person, at) => {
      const entry = el("div", "shot-person");
      const avatar = el("span", "shot-avatar", person.name.split(" ").map(part => part[0]).join(""));
      avatar.style.setProperty("--person-color", person.color);
      entry.append(avatar, el("span", "shot-name", person.name), el("span", "shot-role", view.roles[at]));
      return entry;
    }));
    chips.replaceChildren();
  };
  const say = (text: string): void => { caption.textContent = text; };
  const chip = (name: string): HTMLElement => el("span", "token shot-chip", name.split(" ")[0]);

  const loop = async (signal: AbortSignal): Promise<void> => {
    for (let index = 0; ; index = (index + 1) % SHOT_KINDS.length) {
      draw(index);
      say(`1. Screenshot ${SHOT_KINDS[index].caption}`);
      await pause(1300, signal);
      phone.dataset.stage = "flash";
      await pause(260, signal);
      phone.dataset.stage = "thumb";
      say("2. Drop or paste it here");
      await pause(1000, signal);
      phone.dataset.stage = "scan";
      say("3. Names are read on this device");
      await pause(1300, signal);
      say("4. Check them, then Add");
      for (const person of SHOT_PEOPLE) {
        chips.append(chip(person.name));
        await pause(230, signal);
      }
      await pause(1900, signal);
    }
  };
  const busy = (): boolean => dismissed || hasNames() || input.value.trim() !== "";
  const hide = (): void => {
    run?.abort();
    run = null;
    row.hidden = true;
  };
  const show = (): void => {
    if (busy()) return hide();
    if (!row.hidden) return;
    row.hidden = false;
    if (reduced.matches) {
      draw(0);
      phone.dataset.stage = "thumb";
      say("Screenshot the member list, drop it here, and check the names");
      chips.replaceChildren(...SHOT_PEOPLE.map(person => chip(person.name)));
      return;
    }
    run = new AbortController();
    loop(run.signal).catch(error => {
      if (!(error instanceof Stopped)) throw error;
    });
  };
  input.addEventListener("focus", show);
  input.addEventListener("input", show);
  input.addEventListener("blur", () => {
    dismissed = false;
    if (!pointer) hide();
  });
  input.addEventListener("keydown", event => {
    if (event.key !== "Escape" || row.hidden) return;
    dismissed = true;
    hide();
  });
  hover.addEventListener("pointerenter", () => {
    pointer = true;
    show();
  });
  hover.addEventListener("pointerleave", () => {
    pointer = false;
    if (document.activeElement !== input) hide();
  });
  return () => { if (busy()) hide(); };
}
