// A short walkthrough: a spotlight on one control at a time, a cursor that shows the tap,
// and a card that says what it does. The cursor only pretends, so nothing is claimed or voted.

export type CoachStep = { target: () => HTMLElement | null; title: string; text: string; tap?: boolean };

const reduced = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, reduced() ? 0 : ms));

let running = false;

export function coachRunning(): boolean {
  return running;
}

// Resolves true when the walkthrough was finished, false when it was skipped.
export function runCoach(steps: CoachStep[]): Promise<boolean> {
  const shown = steps.filter(step => step.target());
  if (running || shown.length === 0) return Promise.resolve(false);
  running = true;
  const layer = document.createElement("div");
  layer.className = "coach";
  layer.innerHTML = `
    <div class="coach-spot"></div>
    <div class="cursor coach-cursor" data-who="you" style="--person-color: #fffdf7"><svg viewBox="0 0 20 22" aria-hidden="true"><path d="M2 2 L2 17 L6.2 13.2 L9 20 L12 18.7 L9.3 12.2 L15 12 Z"/></svg><span>Tap</span></div>
    <span class="coach-ripple"></span>
    <section class="coach-card" role="dialog" aria-modal="true" aria-labelledby="coach-title">
      <p class="coach-count"></p>
      <h2 id="coach-title"></h2>
      <p class="coach-text"></p>
      <div class="coach-actions">
        <button type="button" class="plain" data-act="skip">Skip</button>
        <span>
          <button type="button" class="plain" data-act="back">Back</button>
          <button type="button" class="primary coach-next" data-act="next">Next</button>
        </span>
      </div>
    </section>`;
  document.body.append(layer);
  const q = <T extends HTMLElement>(selector: string) => layer.querySelector<T>(selector)!;
  const spot = q(".coach-spot");
  const card = q(".coach-card");
  const cursor = q(".coach-cursor");
  const ripple = q(".coach-ripple");
  const previousFocus = document.activeElement as HTMLElement | null;
  let index = 0;
  let generation = 0;

  return new Promise(resolve => {
    const finish = (done: boolean): void => {
      running = false;
      removeEventListener("resize", place);
      removeEventListener("scroll", place, true);
      document.removeEventListener("keydown", keys, true);
      layer.remove();
      previousFocus?.focus?.();
      resolve(done);
    };

    // puts the spotlight on the target, and the card below it, or above when there is no room
    function place(): void {
      const target = shown[index].target();
      if (!target) return;
      const box = target.getBoundingClientRect();
      const pad = 6;
      Object.assign(spot.style, { left: `${box.left - pad}px`, top: `${box.top - pad}px`, width: `${box.width + pad * 2}px`, height: `${box.height + pad * 2}px` });
      const width = Math.min(340, innerWidth - 24);
      const left = Math.min(Math.max(12, box.left + box.width / 2 - width / 2), innerWidth - width - 12);
      card.style.width = `${width}px`;
      card.style.left = `${left}px`;
      const below = box.bottom + 18 + card.offsetHeight < innerHeight - 12;
      card.style.top = `${below ? box.bottom + 18 : Math.max(12, box.top - 18 - card.offsetHeight)}px`;
      card.dataset.side = below ? "below" : "above";
    }

    async function show(next: number): Promise<void> {
      index = next;
      const run = ++generation;
      const step = shown[index];
      const target = step.target();
      if (!target) return finish(false);
      target.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" });
      q(".coach-count").textContent = `${index + 1} of ${shown.length}`;
      q("#coach-title").textContent = step.title;
      q(".coach-text").textContent = step.text;
      q<HTMLButtonElement>('[data-act="back"]').hidden = index === 0;
      q('[data-act="next"]').textContent = index === shown.length - 1 ? "Got It" : "Next";
      cursor.dataset.visible = "false";
      ripple.dataset.on = "false";
      await pause(320);
      if (run !== generation) return;
      place();
      q<HTMLButtonElement>('[data-act="next"]').focus({ preventScroll: true });
      if (!step.tap) return;
      // the cursor comes in from the card, glides to the target and pretends to tap it
      const box = target.getBoundingClientRect();
      const from = card.getBoundingClientRect();
      cursor.style.transition = "none";
      cursor.style.transform = `translate(${from.left + from.width / 2}px, ${card.dataset.side === "below" ? from.top : from.bottom}px)`;
      void cursor.offsetWidth;
      cursor.style.transition = "";
      cursor.dataset.visible = "true";
      const x = box.left + Math.min(box.width * 0.5, 140);
      const y = box.top + box.height / 2;
      cursor.style.transform = `translate(${x}px, ${y}px)`;
      await pause(700);
      if (run !== generation) return;
      cursor.dataset.press = "true";
      Object.assign(ripple.style, { left: `${x}px`, top: `${y}px` });
      ripple.dataset.on = "true";
      await pause(160);
      cursor.dataset.press = "false";
    }

    function keys(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        q<HTMLButtonElement>('[data-act="next"]').click();
      } else if (event.key === "ArrowLeft" && index > 0) {
        event.preventDefault();
        void show(index - 1);
      } else if (event.key === "Tab") {
        // keep focus on the card while it is open
        const buttons = [...card.querySelectorAll<HTMLButtonElement>("button:not([hidden])")];
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
        event.preventDefault();
        buttons[(at + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus();
      }
    }

    layer.addEventListener("click", event => {
      const action = (event.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
      if (action === "skip") finish(false);
      else if (action === "back") void show(index - 1);
      else if (action === "next") {
        if (index === shown.length - 1) finish(true);
        else void show(index + 1);
      }
    });
    addEventListener("resize", place);
    addEventListener("scroll", place, true);
    document.addEventListener("keydown", keys, true);
    void show(0);
  });
}
