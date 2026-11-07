import { ApiError, copyText, request } from "./api.ts";
import { forgetBoard, listBoards, openedAgo, type BoardEntry } from "./boards.ts";
import { attachMenu, button, confirmAction, el, toast } from "./ui.ts";

// The top bar every page shares: About, My Boards (the boards this browser made or opened) and New Board,
// folded into one menu on phones. The My Boards sheet is built here, so every page gets the same one.

function entries(): BoardEntry[] {
  try {
    return listBoards(localStorage);
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
    return [];
  }
}

async function deleteEverywhere(entry: BoardEntry, rerender: () => void): Promise<void> {
  if (!await confirmAction(`Delete "${entry.title}"?`, "Slides, claims and polls are removed for everyone. This cannot be undone.", "Delete Board")) return;
  try {
    await request(`/api/boards/${entry.id}`, { method: "DELETE" }, localStorage.getItem(`pys-admin-${entry.id}`));
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    // a board that is already gone only needs forgetting here
    if (error.status !== 404) {
      toast(error.message, true);
      return;
    }
  }
  forgetBoard(localStorage, entry.id);
  rerender();
  toast("Board deleted");
}

function boardRow(entry: BoardEntry, rerender: () => void): HTMLElement {
  const link = new URL(`/b/${entry.id}`, location.origin).href;
  const row = el("div", "row board-entry");
  const open = el("a", "row-text stacked-text");
  open.href = `/b/${entry.id}`;
  open.append(el("span", "row-title", entry.title), el("span", "caption", `${entry.role === "organizer" ? "Organizer" : "Member"} · ${openedAgo(entry.lastOpened)}`));
  const more = button("", "icon small", undefined);
  more.setAttribute("aria-label", `Options for ${entry.title}`);
  more.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>';
  attachMenu(more, () => [
    { label: "Open", action: () => { location.href = `/b/${entry.id}`; } },
    { label: "Copy Link", action: () => { void copyText(link).then(ok => toast(ok ? "Link copied" : link)); } },
    ...(entry.role === "organizer" ? [{ label: "Edit…", action: () => { location.href = `/b/${entry.id}#settings`; } }] : []),
    "separator" as const,
    { label: "Forget on This Device", action: () => {
      forgetBoard(localStorage, entry.id);
      rerender();
      toast(entry.role === "organizer" ? "Forgotten here. The board stays up, and the organizer link still works." : "Forgotten here. The board stays up.");
    } },
    ...(entry.role === "organizer" ? [{ label: "Delete Board…", destructive: true, action: () => { void deleteEverywhere(entry, rerender); } }] : []),
  ]);
  row.append(open, more);
  return row;
}

function renderBoards(boardsSheet: HTMLDialogElement, boardsButton: HTMLButtonElement): void {
  const list = entries();
  boardsButton.hidden = list.length === 0;
  boardsButton.querySelector(".count")!.textContent = String(list.length);
  const body = boardsSheet.querySelector(".sheet-body")!;
  body.replaceChildren();
  if (list.length === 0) {
    body.append(el("p", "empty", "Boards you make or open in this browser show up here."));
    return;
  }
  const group = el("section", "group");
  group.append(...list.map(entry => boardRow(entry, () => renderBoards(boardsSheet, boardsButton))));
  body.append(group, el("p", "group-footer", "This list is kept in this browser only. Another phone or browser has its own."));
}

function boardsSheetElement(): HTMLDialogElement {
  const sheet = el("dialog", "sheet");
  sheet.id = "boards-sheet";
  sheet.setAttribute("aria-labelledby", "boards-sheet-title");
  sheet.innerHTML = `<header class="sheet-bar"><button type="button" class="plain" data-close>Close</button><h2 id="boards-sheet-title">My Boards</h2><span></span></header><div class="sheet-body"></div>`;
  document.body.append(sheet);
  return sheet;
}

// Returns a refresh for the My Boards count, for a page that remembers a new board.
export function siteNav(): () => void {
  const boardsButton = document.querySelector<HTMLButtonElement>("#my-boards")!;
  const boardsSheet = boardsSheetElement();
  const openBoards = (): void => {
    renderBoards(boardsSheet, boardsButton);
    boardsSheet.showModal();
  };
  boardsButton.addEventListener("click", openBoards);
  // on phones the nav folds About and My Boards into this menu
  attachMenu(document.querySelector<HTMLButtonElement>("#nav-menu")!, () => {
    const count = entries().length;
    return [
      ...(count ? [{ label: `My Boards (${count})`, action: openBoards }] : []),
      { label: "About", action: () => { location.href = "/about/"; } },
      { label: "Privacy", action: () => { location.href = "/privacy/"; } },
      { label: "Source Code", action: () => { location.href = "https://github.com/sakudiff/Pick-Your-Slides"; } },
    ];
  });
  boardsSheet.querySelector("[data-close]")!.addEventListener("click", () => boardsSheet.close());
  renderBoards(boardsSheet, boardsButton);
  if (location.hash === "#boards" && entries().length > 0) {
    history.replaceState(null, "", location.pathname);
    boardsSheet.showModal();
  }
  return () => renderBoards(boardsSheet, boardsButton);
}
