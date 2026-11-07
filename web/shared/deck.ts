// One list of slide elements shared by the deck importer and the presenter bar, so both count slides the same way.
export type DeckSlides = { slides: Element[]; stacks: { first: number; count: number }[] };

export function deckSlides(doc: ParentNode): DeckSlides {
  const kit = [...doc.querySelectorAll("section.slide")].filter(slide => !slide.parentElement?.closest("section.slide"));
  if (kit.length > 0) return { slides: kit, stacks: [] };

  const reveal = [...doc.querySelectorAll(".reveal .slides > section")];
  if (reveal.length > 0) {
    const slides: Element[] = [];
    const stacks: { first: number; count: number }[] = [];
    for (const top of reveal) {
      const stack = [...top.children].filter(child => child.localName === "section");
      if (stack.length > 1) stacks.push({ first: slides.length, count: stack.length });
      slides.push(...(stack.length ? stack : [top]));
    }
    return { slides, stacks };
  }

  const loose = [...doc.querySelectorAll("body section, body article")]
    .filter(block => !block.parentElement?.closest("section, article") && block.querySelector("h1, h2, h3"));
  return { slides: loose, stacks: [] };
}
