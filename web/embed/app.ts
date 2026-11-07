// The presenter bar: one script tag in a deck shows who presents the slide on screen.
//   <script src="https://<site>/embed.js" data-board="<board id>" defer></script>
import { deckSlides } from "../shared/deck.ts";

type Feed = { title: string; slides: number; claims: Record<string, string>; roster: { name: string; color: string }[] };

const script = document.currentScript as HTMLScriptElement | null;
const board = script?.dataset.board ?? "";
const origin = script ? new URL(script.src, location.href).origin : "";
const REFRESH = 8000;

let feed: Feed | null = null;

function activeSlide(): number | null {
  const { slides } = deckSlides(document);
  const reveal = slides.findIndex(slide => slide.classList.contains("present") && !slide.querySelector("section.present"));
  if (reveal !== -1) return reveal + 1;
  const marked = slides.findIndex(slide => slide.matches(".active, .is-active, .current, [aria-current]"));
  if (marked !== -1) return marked + 1;
  const hash = location.hash.match(/^#\/?(\d+)\/?$/);
  if (hash && Number(hash[1]) >= 1) return Number(hash[1]);
  // a deck that scrolls shows the slide under the middle of the screen
  const middle = innerHeight / 2;
  const scrolled = slides.findIndex(slide => {
    const box = slide.getBoundingClientRect();
    return box.height > 0 && box.top <= middle && box.bottom >= middle;
  });
  return scrolled === -1 ? null : scrolled + 1;
}

function mount(): { host: HTMLElement; dot: HTMLElement; text: HTMLElement } {
  const host = document.createElement("div");
  host.setAttribute("data-pick-your-slides", "");
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>
    :host { all: initial; position: fixed; top: 10px; left: 50%; z-index: 2147483647; transform: translateX(-50%); pointer-events: none; }
    .bar { display: flex; align-items: center; gap: 8px; max-width: calc(100vw - 24px); padding: 5px 12px 5px 8px; border-radius: 16px;
      background: rgb(28 28 30 / .82); color: #f2f2f7; box-shadow: 0 4px 16px rgb(0 0 0 / .25);
      backdrop-filter: blur(20px) saturate(1.6); -webkit-backdrop-filter: blur(20px) saturate(1.6);
      font: 500 13px/1.25 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; white-space: nowrap; }
    .dot { flex: 0 0 auto; width: 10px; height: 10px; border-radius: 50%; background: #8e8e93; }
    .text { overflow: hidden; text-overflow: ellipsis; }
    @media print { :host { display: none; } }
  </style><div class="bar" role="status" aria-live="polite"><span class="dot"></span><span class="text"></span></div>`;
  host.hidden = true;
  document.body.append(host);
  return { host, dot: root.querySelector<HTMLElement>(".dot")!, text: root.querySelector<HTMLElement>(".text")! };
}

function start(): void {
  if (!/^[0-9a-hjkmnp-tv-z]{10}$/.test(board) || !origin) return;
  const view = mount();
  let shown = "";
  const draw = (): void => {
    const slide = activeSlide();
    if (!feed || slide === null || slide > feed.slides) {
      view.host.hidden = true;
      shown = "";
      return;
    }
    const owner = feed.claims[slide];
    const label = owner ? `Presenting · ${owner}` : `Slide ${slide} · open`;
    const color = feed.roster.find(member => member.name === owner)?.color ?? "#8e8e93";
    if (label + color === shown) return;
    shown = label + color;
    view.text.textContent = label;
    view.dot.style.background = color;
    view.host.title = `Slide ${slide} of ${feed.slides}`;
    view.host.hidden = false;
  };
  const load = async (): Promise<void> => {
    if (document.hidden) return;
    try {
      const response = await fetch(`${origin}/api/boards/${board}/presenters`, { credentials: "omit" });
      feed = response.ok ? await response.json() as Feed : null;
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
    draw();
  };
  addEventListener("hashchange", draw);
  addEventListener("scroll", draw, { passive: true });
  addEventListener("keyup", draw);
  addEventListener("click", draw);
  // decks switch slides by toggling classes, which no event announces
  setInterval(draw, 400);
  setInterval(() => { void load(); }, REFRESH);
  document.addEventListener("visibilitychange", () => { void load(); });
  void load();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();
