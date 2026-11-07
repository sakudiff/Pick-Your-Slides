// The landing demo: make a board, share it, paste it in a chat, claim slides, run a poll, and loop.
// Every step can be cancelled, so pausing, jumping to a scene or scrolling away stops it cleanly.

const root = document.querySelector<HTMLElement>("#demo");

type Step = (signal: AbortSignal) => Promise<void>;
type Scene = { reset(): void; play: Step; finish(): void };

class Stopped extends Error {}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Stopped());
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Stopped());
    }, { once: true });
  });
}

if (root) start(root);

function start(demo: HTMLElement): void {
  const stage = demo.querySelector<HTMLElement>(".demo-stage")!;
  const q = <T extends HTMLElement = HTMLElement>(selector: string) => stage.querySelector<T>(selector)!;
  const qa = (selector: string) => [...stage.querySelectorAll<HTMLElement>(selector)];
  const cursor = (who: string) => q(`.cursor[data-who="${who}"]`);
  const toast = q(".demo-toast");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");

  // sets a cursor's starting point without a glide, so it never sweeps in from wherever it was last
  const place = (who: string, x: number, y: number, visible = true): void => {
    const element = cursor(who);
    element.style.transition = "none";
    element.style.transform = `translate(${x}px, ${y}px)`;
    void element.offsetWidth;
    element.style.transition = "";
    element.dataset.visible = String(visible);
  };
  const hideCursors = (): void => qa(".cursor").forEach(element => { element.dataset.visible = "false"; });

  // glides a cursor to the middle-left of a target, measured against the stage
  const moveTo = async (who: string, target: HTMLElement, signal: AbortSignal, ms = 650): Promise<void> => {
    const box = target.getBoundingClientRect();
    const frame = stage.getBoundingClientRect();
    const element = cursor(who);
    element.style.transitionDuration = `${ms}ms`;
    place(who, box.left - frame.left + Math.min(box.width * 0.6, 120), box.top - frame.top + box.height / 2);
    await wait(ms + 60, signal);
    element.style.transitionDuration = "";
  };
  const click = async (who: string, signal: AbortSignal): Promise<void> => {
    const element = cursor(who);
    element.dataset.press = "true";
    await wait(140, signal);
    element.dataset.press = "false";
  };
  const showToast = async (text: string, signal: AbortSignal): Promise<void> => {
    toast.textContent = text;
    toast.dataset.visible = "true";
    await wait(1300, signal);
    toast.dataset.visible = "false";
  };

  const MEMBERS = [
    { name: "Ana", color: "#a9d7ec" }, { name: "Ben", color: "#c5b7e6" },
    { name: "Cy", color: "#f2b8c6" }, { name: "Dee", color: "#f0c38e" },
  ];
  const pill = (name: string): HTMLElement => {
    const member = MEMBERS.find(entry => entry.name === name)!;
    const element = document.createElement("span");
    element.className = "pill pop";
    element.style.setProperty("--person-color", member.color);
    element.innerHTML = `<span class="avatar">${name.slice(0, 2).toUpperCase()}</span><span class="pill-name">${name}</span>`;
    return element;
  };

  // Scene 1: fill in the form, with the deck dropped onto Source
  const typed = q(".typed");
  const tokens = q(".demo-tokens");
  const stepValue = q(".step-value");
  const file = q(".demo-file");
  const fileKind = q(".file-kind");
  const fileName = q(".file-name");
  const source = q(".demo-source");
  const KINDS = [["PPTX", "pitch.pptx"], ["SLIDES", "Slides link"], ["HTML", "deck link"], ["PDF", "pitch.pdf"]] as const;
  const dropFile = async (signal: AbortSignal): Promise<void> => {
    const box = source.getBoundingClientRect();
    const frame = stage.getBoundingClientRect();
    const x = box.right - frame.left - file.offsetWidth - 64;
    const y = box.top - frame.top - 14;
    file.style.setProperty("--x", `${x}px`);
    file.style.setProperty("--y", `${y}px`);
    file.style.setProperty("--from-x", `${x + 40}px`);
    file.style.setProperty("--from-y", `${y - 150}px`);
    file.dataset.shown = "true";
    // the file names each kind of deck on the way down, and lands as the PDF
    for (const [kind, name] of KINDS) {
      fileKind.textContent = kind;
      fileName.textContent = name;
      await wait(170, signal);
    }
    await wait(260, signal);
    file.dataset.landed = "true";
    source.textContent = "PDF";
    source.dataset.flash = "true";
    await wait(300, signal);
  };
  const make: Scene = {
    reset() {
      typed.textContent = "";
      tokens.replaceChildren();
      stepValue.textContent = "1";
      source.textContent = "Manual";
      source.dataset.flash = "false";
      file.dataset.shown = "false";
      file.dataset.landed = "false";
      place("you", 300, 360, false);
    },
    async play(signal) {
      place("you", 300, 360);
      await moveTo("you", typed, signal, 500);
      for (const character of typed.dataset.typed!) {
        typed.textContent += character;
        await wait(55, signal);
      }
      for (const member of MEMBERS) {
        const token = document.createElement("span");
        token.className = "token pop";
        token.textContent = member.name;
        tokens.append(token);
        await wait(220, signal);
      }
      await dropFile(signal);
      for (let count = 2; count <= 8; count += 1) {
        stepValue.textContent = String(count);
        await wait(90, signal);
      }
      await moveTo("you", q(".demo-create"), signal);
      await click("you", signal);
      q(".demo-create").dataset.press = "true";
      await wait(350, signal);
      q(".demo-create").dataset.press = "false";
    },
    finish() {
      typed.textContent = typed.dataset.typed!;
      tokens.replaceChildren(...MEMBERS.map(member => Object.assign(document.createElement("span"), { className: "token", textContent: member.name })));
      stepValue.textContent = "8";
      source.textContent = "PDF";
      file.dataset.shown = "false";
      hideCursors();
    },
  };

  // Scene 2: copy the member link
  const share: Scene = {
    reset() {
      toast.dataset.visible = "false";
    },
    async play(signal) {
      place("you", 260, 330);
      await wait(300, signal);
      await moveTo("you", q(".demo-copy"), signal);
      await click("you", signal);
      await showToast("Copied. Paste it in the group chat.", signal);
    },
    finish() {
      hideCursors();
    },
  };

  // Scene 3: the link lands in a group chat
  const bubbles = qa(".bubble");
  const chat: Scene = {
    reset() {
      bubbles.forEach(bubble => { bubble.dataset.shown = "false"; });
    },
    async play(signal) {
      hideCursors();
      for (const bubble of bubbles) {
        await wait(bubble.dataset.step === "1" ? 400 : 700, signal);
        bubble.dataset.shown = "true";
      }
      await wait(500, signal);
      place("ana", 320, 380);
      await moveTo("ana", q(".link-card"), signal);
      await click("ana", signal);
      await wait(250, signal);
    },
    finish() {
      bubbles.forEach(bubble => { bubble.dataset.shown = "true"; });
      hideCursors();
    },
  };

  // Scene 4: three people claim slides at once
  const rows = qa(".demo-slides .row");
  const count = q(".demo-count");
  const PICKS: [string, number][] = [["ana", 1], ["ben", 5], ["cy", 3], ["ana", 2], ["ben", 6], ["cy", 8]];
  const claimRow = (slide: number, name: string): void => {
    const row = rows[slide - 1];
    row.querySelector(".claim, .pill")?.remove();
    row.append(pill(name));
    row.dataset.claimed = "true";
  };
  const resetRows = (): void => {
    for (const row of rows) {
      row.querySelector(".pill")?.remove();
      if (!row.querySelector(".claim")) row.append(Object.assign(document.createElement("span"), { className: "claim", textContent: "Claim" }));
      row.dataset.claimed = "false";
    }
  };
  const claim: Scene = {
    reset() {
      resetRows();
      count.textContent = "0 of 8 claimed · 4 people";
    },
    async play(signal) {
      place("ana", 40, 40);
      place("ben", 330, 120);
      place("cy", 80, 400);
      await wait(300, signal);
      let done = 0;
      // two cursors move together, so claims land almost at the same time, like a real group
      for (let index = 0; index < PICKS.length; index += 2) {
        const pair = PICKS.slice(index, index + 2);
        await Promise.all(pair.map(([who, slide], offset) => (async () => {
          await wait(offset * 180, signal);
          await moveTo(who, rows[slide - 1].querySelector<HTMLElement>(".row-title")!, signal, 600);
          await click(who, signal);
          claimRow(slide, who[0].toUpperCase() + who.slice(1));
          done += 1;
          count.textContent = `${done} of 8 claimed · 4 people`;
        })()));
      }
      await wait(700, signal);
    },
    finish() {
      resetRows();
      for (const [who, slide] of PICKS) claimRow(slide, who[0].toUpperCase() + who.slice(1));
      rows.forEach(row => row.querySelector(".pill")?.classList.remove("pop"));
      count.textContent = "6 of 8 claimed · 4 people";
      hideCursors();
    },
  };

  // Scene 5: Ben starts a poll and votes come in
  const pollBox = q(".demo-poll");
  const options = qa(".demo-poll .option");
  const voted = q(".demo-voted");
  const votes = [0, 0, 0];
  const tally = (mine: number | null): void => {
    const total = votes.reduce((sum, value) => sum + value, 0);
    options.forEach((option, index) => {
      option.style.setProperty("--share", total ? `${(votes[index] / total) * 100}%` : "0%");
      option.querySelector(".value")!.textContent = String(votes[index]);
      if (mine === index) option.setAttribute("aria-checked", "true");
    });
    voted.textContent = `Ben · ${total} of 4 voted`;
  };
  const poll: Scene = {
    reset() {
      votes.fill(0);
      options.forEach(option => option.removeAttribute("aria-checked"));
      pollBox.dataset.shown = "false";
      tally(null);
    },
    async play(signal) {
      place("ben", 120, 380);
      await moveTo("ben", q(".demo-new-poll"), signal);
      await click("ben", signal);
      await wait(200, signal);
      pollBox.dataset.shown = "true";
      await wait(600, signal);
      for (const [who, choice] of [["ana", 0], ["cy", 0], ["ben", 1], ["you", 0]] as const) {
        place(who, who === "you" ? 330 : 60, 420);
        await moveTo(who, options[choice].querySelector<HTMLElement>(".row-title")!, signal, 550);
        await click(who, signal);
        votes[choice] += 1;
        tally(who === "you" ? choice : null);
        await wait(150, signal);
      }
      await wait(1400, signal);
    },
    finish() {
      votes.splice(0, 3, 3, 1, 0);
      pollBox.dataset.shown = "true";
      tally(0);
      hideCursors();
    },
  };

  const scenes = [make, share, chat, claim, poll];
  const sceneElements = qa(".scene");
  const steps = [...demo.querySelectorAll<HTMLButtonElement>("[data-goto]")];
  const pauseButton = demo.querySelector<HTMLButtonElement>(".demo-pause")!;
  let current = 0;
  let run: AbortController | null = null;
  let userPaused = false;
  let visible = false;

  const show = (index: number): void => {
    current = index;
    sceneElements.forEach((element, position) => { element.dataset.active = String(position === index); });
    steps.forEach((step, position) => {
      step.setAttribute("aria-current", position === index ? "step" : "false");
      step.dataset.done = String(position < index);
    });
  };

  const stop = (): void => {
    run?.abort();
    run = null;
  };

  const play = (from: number): void => {
    stop();
    if (reduced.matches) {
      show(from);
      scenes[from].finish();
      return;
    }
    const controller = new AbortController();
    run = controller;
    void (async () => {
      try {
        for (let index = from; ; index = (index + 1) % scenes.length) {
          hideCursors();
          scenes[index].reset();
          show(index);
          await wait(450, controller.signal);
          await scenes[index].play(controller.signal);
        }
      } catch (error) {
        if (!(error instanceof Stopped)) throw error;
      }
    })();
  };

  const resume = (): void => {
    if (userPaused || !visible || document.hidden) return;
    if (!run) play(current);
  };

  pauseButton.addEventListener("click", () => {
    userPaused = !userPaused;
    pauseButton.textContent = userPaused ? "Play" : "Pause";
    pauseButton.setAttribute("aria-label", userPaused ? "Play the demo" : "Pause the demo");
    if (userPaused) {
      stop();
      scenes[current].finish();
    } else play(current);
  });
  for (const step of steps) {
    step.addEventListener("click", () => {
      const index = Number(step.dataset.goto);
      if (userPaused || reduced.matches) {
        stop();
        scenes.forEach(scene => scene.reset());
        show(index);
        scenes[index].finish();
      } else play(index);
    });
  }

  // reduced motion shows the finished frame of each step, chosen with the step buttons
  if (reduced.matches) {
    pauseButton.hidden = true;
    show(3);
    scenes[3].finish();
    return;
  }

  scenes.forEach(scene => scene.reset());
  show(0);
  new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting);
    if (visible) resume();
    else stop();
  }, { threshold: 0.3 }).observe(stage);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else resume();
  });
}
