# Design: Sticker

Pick Your Slides looks like a group project board: cream paper, cards outlined in ink, hard offset shadows, and member colours as stickers. It is meant to feel made by students for students, loud enough to be fun but still compact enough to manage a 40-slide deck on a phone.

The look comes from one rule.

> Colour is a fill. Ink is the line. Text on a colour is always ink.

Every component follows from that. Outlines and shadows are drawn in `--ink`, colour appears only as a flat fill behind ink text, and nothing uses gradients, glows, blur or soft shadows.

## Tokens

All tokens live on `:root` in `web/shared/base.css`. The site is light only: there is no dark theme or theme switch, and every page declares `<meta name="color-scheme" content="light">` so browsers with forced dark modes leave the design alone.

### Surfaces and text

| Token | Value | Use |
| --- | --- | --- |
| `--background` | `#fff4df` cream paper | page, toolbar, sheets |
| `--surface` | `#fffdf7` | cards and groups |
| `--fill` | `#f3e6c9` | controls, inactive segments |
| `--fill-strong` | `#e9d6ad` | switch track off, hover |
| `--ink` | `#141414` | every outline and hard shadow |
| `--label` | `#141414` | body text |
| `--secondary` | `#4f4a42` | captions, footers |
| `--tertiary` | `#6f6759` | placeholders, untitled slides |
| `--tint` | `#b83418` | links, Claim, text actions |
| `--destructive` | `#b3261e` | destructive text |

### Fills

These always carry ink text (`--on-fill: #141414`).

| Token | Value | Use |
| --- | --- | --- |
| `--yellow` | `#ffd23f` | primary button, identity, toast, your own claims, selected chips, focus ring |
| `--coral` | `#ff6b4a` | destructive buttons, error toast, the headline underline bar |
| `--mint` | `#8ee3c8` | switch on, chat avatar, step 2 |
| `--sky` | `#c7e7ff` | name tokens, the landing preview card, poll share |

Member colours are the pastels in `COLORS` (`web/shared/model.ts`). Pills fill with the full colour and always use `#141414` text.

Mixed fills are tokens too: `--mine-fill` (your claimed rows), `--vote-fill` and `--vote-mine-fill` (poll share bars). Use these rather than mixing yellow or sky over `--surface` yourself.

### Lines, shadows and shape

| Token | Value |
| --- | --- |
| `--border` | `2px`, for card, button and control outlines |
| `--hairline` | `1.5px`, for row dividers, pills and small controls |
| `--shadow-hard` | `4px 4px 0 var(--ink)`, for cards and menus |
| `--shadow-small` | `3px 3px 0 var(--ink)`, for buttons and FAQ cards |
| `--shadow-press` | `1px 1px 0 var(--ink)`, for the pressed state |
| `--radius` | `14px`, for cards (pills and tags are fully round) |

Row dividers run edge to edge in `--ink`, so a card reads as one ruled sheet, not a list of floating rows.

## Type

- **Face:** Bricolage Grotesque, variable weight 200 to 800, self-hosted from `@fontsource-variable/bricolage-grotesque` as `dist/fonts/bricolage-latin.woff2` (41 KB) and `bricolage-latin-ext.woff2` (18 KB, for names with accents). It is preloaded on every page, and no font CDN is contacted.
- **Weights:** body text is 500. Labels and buttons are 700. Headings, slide numbers, group headers and the selected segment are 800.
- **Display:** the landing headline is 56px on desktop and 40px on phones, with letter-spacing -.035em and line-height 1. Section titles are 30px at 800.
- **Group headers:** 13px, 800, uppercase, letter-spacing .07em, in `--label` (not grey).

## Components

- **Cards (`.group`):** surface fill, `--border` ink outline, `--shadow-hard`.
- **Primary button:** yellow, ink outline, `--shadow-small`, 800 weight. On press it moves 2px down and right and the shadow shrinks to `--shadow-press`, like pressing a sticker flat.
- **Plain buttons and links:** `--tint`, bold, never underlined except "Claim", which is underlined so it reads as an action in a list of names.
- **Segmented control:** ink outline on fill. The selected segment is solid ink with paper text.
- **Inputs, stepper, pop-up:** a hairline ink outline on fill. Focus is a 3px yellow outline with an ink halo.
- **Switch:** ink-outlined track, mint when on, ink-outlined knob.
- **Pills and avatars:** member colour, hairline ink outline, a white avatar with ink initials. Tight spots (toolbar, slide rows, people chips, order rows) show `shortName()` from `web/shared/ui.ts`: the first name, or the first name and last initial when two members share one. The full name stays in `title` and `aria-label`.
- **Your claims:** `--mine-fill` behind the row and a 5px yellow bar on the left edge.
- **Mark:** three stacked slide cards, sky at the back, paper in the middle, and the front one pulled up and tilted -12deg in yellow with two title lines, like a claimed slide. Each card has an ink outline and its own hard shadow. `web/shared/brand/mark.svg` is the only source. The favicon is a two-card cut of it with thicker lines, so it reads at 16 px. The PNG icons and the 1200x630 link-preview image are rendered from these files by `scripts/render-brand.py` and committed, so rerun it after changing the mark.
- **Home mark:** the mark is the way home. It leads the board toolbar and, beside the name, the top bar. It tips -6deg on hover.
- **Top bar:** the same on every page: the mark and name, then About, My Boards (when this browser has any) and New Board. On phones About and My Boards fold into one menu. `web/shared/nav.ts` runs it, and builds the My Boards sheet.
- **Split Evenly sheet:** one row per member with their pill, their slides after the split, and "+N new" for what the split adds.
- **My Boards sheet:** boards this browser made or opened, newest first, each with its role and when it was opened. The row's ⋯ menu offers only what that role can do: an organizer can edit and delete, everyone can open, copy and forget.
- **Polls:** the vote share fills the row from the left behind the text. Your choice gets a yellow check box with an ink tick.
- **Menus, alerts, sheets:** solid surface (no frosted glass), ink outline, hard shadow. The menu hover is yellow. Destructive alert buttons are coral. Sheets slide up with a slight overshoot.
- **Toast:** a yellow sticker tilted -1deg, coral for errors.
- **Empty states:** a dashed tertiary outline, so they read as a gap waiting to be filled.

- **Multi-line fields (`textarea.field`):** always visible, with a 2px ink outline, a surface fill and an inset fill-strong shadow, so they read as somewhere to type. An optional field says "optional" in tertiary text beside its label.
- **Typing bubble:** while a multi-line field is focused and has fewer than two lines, a yellow sticker bubble sits under it, tail pointing up. It plays someone typing the first example, pressing a Return key chip, then typing the second, and loops. It never moves the field, hides on blur, on Escape or once two lines exist, and shows its finished frame under reduced motion. The real placeholder carries the words for screen readers.
- **Screenshot bubble:** while the member field is focused and empty, or the pointer is on Import from Screenshot, a yellow bubble under it acts out the import. A phone shows a member list, the screen flashes white, the shot shrinks to a tilted thumbnail with a white border, a mint line scans it, and the names pop in as chips. It alternates a group chat member list (round avatars, an Admin tag) with a class People page (square avatars, a search field, Student roles), with generic names and no app branding. Reduced motion shows the finished frame.
- **Walkthrough:** the page dims with a yellow-ringed cut-out around one control, the ink cursor glides in and pretends to tap with a yellow ripple, and a sticker card explains it with Skip, Back and Next. Nothing is really claimed or voted. It plays once per browser for the board and once for polls. The toolbar's "?" button shines with a sweeping white bar until it has been seen, then replays it on demand.

### Landing page

- **Demo stage:** a sky-blue card, tilted -1.2deg with a 6px ink shadow, that acts out the whole flow with the real component markup: a deck file drops onto Source (it names PDF, PowerPoint, Slides link and HTML on the way down), make the board, copy the link, paste it in a group chat, three people claim slides, then a poll. Scenes fade the old one out fast and the new one in just after, so they never blur together. Cursors are member-coloured arrows with a name tag. Yours is the ink one. Only transform and opacity animate. The demo stops off screen and in hidden tabs, and under reduced motion shows still frames chosen with the step cards.
- **Step cards:** the demo's five chapters (Make, Share, Chat, Claim, Poll), each a numbered card with one line. They sit in a column beside the stage from 1000 px and in a swipeable row under it below that. The playing scene's card is yellow and lifted. Tapping a card jumps to its scene. They replace the old How it works and Works with sections.
- **Headline:** sits over a coral underline bar.
- **New Board card:** the whole form sits on one paper sheet with a 2px ink outline, a 22px radius and a 6px ink shadow. The title is a yellow tab on its top edge, tilted -1.5deg. The groups inside keep their outlines with the smaller shadow.
- **FAQ (About page):** separate cards with a +/− badge that turns yellow when open.

## Rules

1. Text on a fill is `#141414`. Never put `--secondary` grey on coral (3.1:1).
2. One accent per element. A card is outlined or filled, and never given a second shadow colour.
3. Tilt only decorative cards (the preview, step cards, toast), never a card someone types or taps in, so hit areas stay true.
4. Motion is short and physical (press, slide, overshoot) and is turned off under `prefers-reduced-motion`.
5. Print drops the toolbar chrome and the hard shadows.
6. The presenter bar (`embed.js`) keeps its neutral dark pill, because it draws on other people's decks.
7. Examples use everyday content (the "Product Launch Pitch" deck, members Ana, Ben, Cy and Dee), never one course's material.

## Accessibility checks

Contrast was measured against the tokens above with the WCAG relative luminance formula.

- `--label`, `--secondary`, `--tint` and `--destructive` clear 4.5:1 on `--background`, `--surface` and `--fill`. `--tint` is 5.4:1 on cream.
- `--tertiary` is at least 4.51:1, so placeholders pass as text.
- Ink text on every fill and member colour clears 4.5:1. Ink on yellow is 12.8:1.
- Ink outlines clear 3:1 against the background, as non-text contrast requires.

## Where it lives

- `web/shared/base.css`: tokens, font faces, shared components.
- `web/board/style.css`: board toolbar and home mark, rows, polls, empty state.
- `web/create/landing.css`: nav, hero, demo stage and cursors, steps, tags, FAQ, My Boards rows.
- `web/create/demo.ts`: the demo's timeline.
- `web/board/coach.ts`: the walkthrough.
- `web/about/`: the About page.
- `scripts/build-site.ts`: copies the font files into `dist/fonts`.
