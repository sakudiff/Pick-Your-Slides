# Renders the committed brand PNGs from web/shared/brand/mark.svg and og.html, so the Netlify build needs no browser.
# Run by hand after changing the mark: uv run --with playwright==1.57.0 python scripts/render-brand.py
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

BRAND = Path(__file__).resolve().parent.parent / "web" / "shared" / "brand"
PAPER = "#fff4df"

# name, pixel size, padding as a share of the size, background
ICONS: list[tuple[str, int, float, str]] = [
    ("icon-32.png", 32, 0.0, "transparent"),
    ("apple-touch-icon.png", 180, 0.14, PAPER),
    ("icon-192.png", 192, 0.12, PAPER),
    ("icon-512.png", 512, 0.12, PAPER),
]


def render_icon(page: Page, source: str, name: str, size: int, padding: float, background: str) -> None:
    inner = size - 2 * round(size * padding)
    svg = source.replace("<svg ", f'<svg width="{inner}" height="{inner}" ', 1)
    page.set_viewport_size({"width": size, "height": size})
    page.set_content(
        f'<body style="margin:0;width:{size}px;height:{size}px;display:grid;place-items:center;overflow:hidden;background:{background}">{svg}</body>'
    )
    page.screenshot(path=BRAND / name, omit_background=background == "transparent")


def main() -> None:
    mark = (BRAND / "mark.svg").read_text()
    favicon = (BRAND / "favicon.svg").read_text()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True)
        # a fresh page per image, since a page resized smaller keeps painting what was below its old edge
        for name, size, padding, background in ICONS:
            page = browser.new_page()
            render_icon(page, favicon if size <= 32 else mark, name, size, padding, background)
            page.close()
        page = browser.new_page(viewport={"width": 1200, "height": 630})
        page.goto((BRAND / "og.html").as_uri())
        page.evaluate("document.fonts.ready")
        page.screenshot(path=BRAND / "og.png")
        browser.close()


if __name__ == "__main__":
    main()
