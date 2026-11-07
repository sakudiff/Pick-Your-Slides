# Contributing

Thanks for helping. Bug reports, small fixes and ideas are all welcome. Open an issue first for anything large, so we can agree on the shape before you build it.

## How contributions flow

This repository is a public copy of a private one that deploys the live site. Releases are pushed here automatically, so nothing is merged here directly.

1. Open an issue or a pull request here, as usual.
2. Once a pull request is accepted, the change is applied to the private repository, and the pull request is closed with a link to the release it ships in. The release notes credit you by your GitHub name.
3. The next release publishes it here.

## Setup

Follow "Run it locally" in the [README](README.md). The dev server runs the real Netlify Functions against a local Blobs sandbox.

## Before you open a pull request

```bash
npm run check
```

```bash
npm test
```

```bash
npm run build
```

- Add or update tests for behaviour you change. The API tests run the real handlers against an in-memory store (`tests/memory-kv.ts`).
- Keep files and screenshots on the device. Anything new that reads a user's file should run in the browser.
- Follow the design system in [`DESIGN.md`](DESIGN.md): colour is a fill, ink is the line, and text on a colour is always ink.
- Pin new dependencies to an exact version at least two weeks old.

By contributing you agree that your work is released under the [MIT License](LICENSE).
