import { ApiError, copyText, request, uploadThumbs } from "../shared/api.ts";
import { rememberBoard } from "../shared/boards.ts";
import { boardForm } from "../shared/form.ts";
import { isRecord } from "../shared/model.ts";
import { siteNav } from "../shared/nav.ts";
import { toast } from "../shared/ui.ts";

const form = document.querySelector<HTMLFormElement>("#create")!;
const created = document.querySelector<HTMLElement>("#created")!;
const memberLink = document.querySelector<HTMLOutputElement>("#member-link")!;
const adminLink = document.querySelector<HTMLOutputElement>("#admin-link")!;
const uploadStatus = document.querySelector<HTMLParagraphElement>("#upload-status")!;

for (const [trigger, output] of [["#copy-member", memberLink], ["#copy-admin", adminLink]] as const) {
  document.querySelector(trigger)!.addEventListener("click", async () => {
    toast(await copyText(output.value) ? "Copied" : "Copying is blocked here. Select the link instead.");
  });
}

boardForm(form, {
  initial: null,
  submitLabel: "Create Board",
  async onSubmit({ board, thumbs }) {
    const result = await request("/api/boards", { method: "POST", body: JSON.stringify({ board, thumbs: thumbs !== null }) });
    if (!isRecord(result) || typeof result.id !== "string" || typeof result.token !== "string") throw new Error("The board could not be created.");
    const member = new URL(`/b/${result.id}`, location.origin).href;
    memberLink.value = member;
    adminLink.value = `${member}#admin=${result.token}`;
    document.querySelector<HTMLAnchorElement>("#open-board")!.href = adminLink.value;
    try {
      localStorage.setItem(`pys-admin-${result.id}`, result.token);
      rememberBoard(localStorage, result.id, board.title);
      refreshBoards();
    } catch (error) {
      if (!(error instanceof DOMException)) throw error;
    }
    form.hidden = true;
    created.hidden = false;
    document.querySelector("#new-title")!.textContent = "Board Ready";
    created.scrollIntoView({ block: "start" });
    if (thumbs) {
      uploadStatus.textContent = `Uploading previews, 0 of ${thumbs.length}…`;
      try {
        await uploadThumbs(result.id, result.token, thumbs, done => { uploadStatus.textContent = `Uploading previews, ${done} of ${thumbs.length}…`; });
        uploadStatus.textContent = "Previews uploaded.";
      } catch (error) {
        uploadStatus.textContent = `${error instanceof Error ? error.message : "Upload failed."} The board works without previews.`;
      }
    }
  },
});

// the landing's buttons scroll within the page, and New Board puts the cursor in the title
for (const link of document.querySelectorAll<HTMLAnchorElement>("[data-scroll]")) {
  link.addEventListener("click", event => {
    const target = document.getElementById(link.dataset.scroll!);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ block: "start" });
    history.replaceState(null, "", `#${link.dataset.scroll}`);
    if (link.dataset.scroll === "new" && !form.hidden) form.querySelector<HTMLInputElement>("#f-title")?.focus({ preventScroll: true });
  });
}


const refreshBoards = siteNav();
