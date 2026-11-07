<img src="web/shared/brand/mark.svg" alt="" width="72" height="72">

# Pick your slides

Split a group presentation without the group chat copy-paste. Make a board, send one link, and everyone claims their slides. The organizer can split what is left evenly in one tap, and anyone can run a poll. No sign-in.

Live at **https://pick-your-slides.netlify.app**

## What it does

- **Boards from any deck.** Type a slide count, or read the titles from a PDF exported from any app (Canva, Google Slides, Keynote, Overleaf for Beamer), a PowerPoint file, a Google Slides link shared with anyone who has the link, or an HTML deck link (reveal.js, Netlify-hosted decks). PDF bookmarks become sections, Beamer PDFs can merge overlay pages into one slide, and a portrait PDF is flagged as a likely report rather than slides.
- **Members from a screenshot.** Drop a screenshot of a Messenger member list or a Canvas group, and the names are read on the device with Tesseract.js.
- **Claiming.** First come, first served, live for everyone, with taps that show at once and save in the background.
- **Split Evenly.** Hands out the open slides so everyone ends up within one slide of each other, keeping every claim already made.
- **Polls.** A poll can ask several questions at once, single or multiple choice.
- **Presenter bar.** One script tag on a self-hosted HTML deck shows who presents the slide on screen.
- **My Boards.** The browser remembers boards it made or opened.

## Privacy model

There are no accounts. A board stores its title, slide titles and sections, the member names, claims, poll votes, optional slide previews, and a hash of the organizer secret (the secret itself lives only in the organizer link). Anyone with a board link can read it.

Files and screenshots are read in the browser and never uploaded. Boards are deleted 90 days after their last change, and slide previews 30 days after the presentation date, by a daily scheduled function. The full notice is at [`/privacy`](https://pick-your-slides.netlify.app/privacy/).

## How it is built

| Path | What lives there |
| --- | --- |
| `web/` | The static site: landing and create page (`create/`), board (`board/`), about, privacy, the presenter bar (`embed/`), and shared modules (`shared/`) |
| `server/` | Request handling and storage logic, written against a small key-value interface so it runs the same in tests |
| `netlify/functions/` | Thin Netlify Functions wrappers that connect `server/` to Netlify Blobs, with per-IP rate limits |
| `scripts/build-site.ts` | Bundles with esbuild into `dist/` and copies the vendored pdf.js and Tesseract files |
| `tests/` | `node:test` suites for the API, importers, the split, the deck fetcher, Canva and the board list |

The design system (tokens, components, rules, contrast results) is in [`DESIGN.md`](DESIGN.md).

## Run it locally

Requires Node 22.18 or newer and the Netlify CLI.

```bash
npm install
```

```bash
npm run build
```

```bash
netlify dev --offline --dir dist --functions netlify/functions --port 8931 --staticServerPort 3998
```

Then open http://127.0.0.1:8931. In environments that set `NODE_OPTIONS=--use-openssl-ca` (some cloud containers), Netlify's function workers refuse that flag, so clear it and pass the CA bundle instead.

```bash
NODE_OPTIONS= NODE_EXTRA_CA_CERTS=/path/to/ca-bundle.crt netlify dev --offline --dir dist --functions netlify/functions --port 8931 --staticServerPort 3998
```

## Checks

```bash
npm run check
```

```bash
npm test
```

CI runs the type check, the tests and the build on every push and pull request.

## Repositories and releases

| Repository | Visibility | Role |
| --- | --- | --- |
| `sakudiff/pick-your-slides-prod` | private | where work happens, and what Netlify deploys from `main` |
| `sakudiff/Pick-Your-Slides` | public | a read-only copy for audit and contributions, updated only by releases |

Publishing a GitHub release in the private repository runs `.github/workflows/publish.yml`. It checks that the tagged commit is on `main`, then copies that commit's files to the public repository as one new commit, tagged with the release, using a write-only deploy key. The private history never goes public: the public repository starts with an initial commit and gains one commit per release. The push is never a force, so the public history can grow but never be rewritten. Fixes reach the live site as soon as they merge, and reach the public repository at the next release.

## Deploying

Netlify builds `main` with `npm run build` and publishes `dist/`. Functions and the daily cleanup deploy with it.

Canva import is optional and stays off until these are set in the Netlify environment. An unreviewed Canva app only signs in its owner's account, so keep `CANVA_ENABLED` unset until Canva approves the public review:

| Variable | Value |
| --- | --- |
| `CANVA_CLIENT_ID` | from the Canva Developer Portal |
| `CANVA_CLIENT_SECRET` | from the Canva Developer Portal, marked secret |
| `CANVA_REDIRECT_URI` | `https://<your-site>/api/canva/callback`, also registered in the portal |
| `CANVA_ENABLED` | `true`, once Canva has approved the app |

## Security notes

- **Organizer secret.** Only its SHA-256 hash is stored, and it is compared in constant time.
- **Deck fetching** (`server/fetch-deck.ts`).
  - https only, port 443 only, no credentials in the link and no IP literals.
  - The public-address check runs inside the socket's own DNS lookup, so the address checked is the address connected to. Every redirect hop is checked again, up to 3.
  - The fetch has an 8 s timeout and a 3 MB cap, takes HTML only, and stores nothing.
  - A Google Slides link becomes a fixed `docs.google.com/presentation/d/<id>/export/pdf` request, so only the deck ID comes from the link. Redirects may go only to `*.googleusercontent.com`, and the PDF is streamed back with a 20 MB cap.
- **Canva** (`server/canva.ts`).
  - OAuth with PKCE (S256) and a single-use state.
  - Only the access token is kept, for at most an hour, in its own store. It is never sent to the browser, and it is deleted after the export. The refresh token is discarded.
  - Exports are fetched only from Canva hosts, with a 20 MB cap.
- **Presenter feed.** It is the only cross-origin endpoint, and it serves only the title, slide count, claims and roster.

Report a vulnerability privately, as described in [`SECURITY.md`](SECURITY.md).

## Related

From the creator of [AnimoSort](https://animosort.sakuen.org) ([code](https://github.com/sakudiff/Animo-Sort)), which turns a DLSU Archershub EAF into a weekly timetable on your device.

## License

[MIT](LICENSE). Independent project, not affiliated with De La Salle University, Canva, Microsoft, Google or Meta.
