# Security policy

## Reporting a vulnerability

Please report security problems privately through GitHub's private vulnerability reporting:
https://github.com/sakudiff/Pick-Your-Slides/security/advisories/new

Do not open a public issue for a vulnerability. Include the steps to reproduce, what an attacker could do, and the board or request involved if there is one (never include a real organizer link).

You can expect a first reply within a week. Fixes ship to the live site as soon as they are merged.

## In scope

- The live site at https://pick-your-slides.netlify.app and the code in this repository.
- Reading or changing a board without its link, or acting as an organizer without the organizer link.
- Server-side request forgery through deck link import.
- Leaks of Canva access tokens or other secrets.
- Cross-site scripting through board titles, names, polls or imported files.
- Ways around the storage limits or rate limits that would let someone fill storage or run up costs.

## Out of scope

- Anyone with a board's member link can claim, vote and read it. That is how sharing works, not a flaw.
- Denial of service by sheer request volume, beyond the rate limits Netlify enforces.
- Findings that need a compromised device or browser.
