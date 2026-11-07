import type { Snapshot } from "../web/shared/model.ts";

function escape(text: string): string {
  return text.replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`);
}

// Messenger reads these tags to draw the link card, so the card shows the deck and how far the split got.
// Link cards need an absolute image address, so the caller passes the site's origin.
export function injectPreview(html: string, snapshot: Snapshot | null, origin: string): string {
  const title = snapshot ? `${snapshot.meta.title} · Pick your slides` : "Pick your slides";
  const description = snapshot
    ? `${Object.keys(snapshot.claims).length} of ${snapshot.meta.slides.length} slides claimed. Pick yours.`
    : "This board is not here.";
  const tags = [
    `<meta property="og:title" content="${escape(title)}">`,
    `<meta property="og:description" content="${escape(description)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:image" content="${escape(`${origin}/og.png`)}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="Pick your slides: split the deck, not the group chat.">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ].join("\n  ");
  return html.replace(/<title>[^<]*<\/title>/, `<title>${escape(title)}</title>\n  ${tags}`);
}
