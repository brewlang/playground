// The card as an image: filling a social format, or on a background like the code image

/// The image's size: 'auto' is the card's own; the others are social formats, in pixels
export type CardFormat = "auto" | "square" | "portrait" | "story";
export const CARD_FORMATS: Record<Exclude<CardFormat, "auto">, { label: string; width: number; height: number }> = {
  square: { label: "1:1", width: 1080, height: 1080 },
  portrait: { label: "4:5", width: 1080, height: 1350 },
  story: { label: "9:16", width: 1080, height: 1920 },
};

export interface CardLook {
  format: CardFormat;
  background: "card" | "none" | "accent" | string; // The card fills the image, nothing, the card's accent, or a '#rrggbb' color
  solid: boolean; // A plain background instead of the gradient
  signed: boolean; // 'Brewlang' at the bottom of the card
}

export const DEFAULT_CARD_LOOK: CardLook = { format: "portrait", background: "card", solid: false, signed: true };

/// The card's width in the image, the size its export styles are made for (style.css, under .card-shot)
const CARD_WIDTH = 1080;

const HEX = /^#[0-9a-f]{6}$/i;

/** A look as short parameters, for storage: only what differs from the default. */
export function cardLookToParams(look: CardLook): string {
  const params = new URLSearchParams();
  if (look.format !== DEFAULT_CARD_LOOK.format) params.set("f", look.format);
  if (look.background !== DEFAULT_CARD_LOOK.background) params.set("bg", look.background.replace(/^#/, ""));
  if (look.solid !== DEFAULT_CARD_LOOK.solid) params.set("s", look.solid ? "1" : "0");
  if (look.signed !== DEFAULT_CARD_LOOK.signed) params.set("sig", look.signed ? "1" : "0");
  return params.toString();
}

/** A look from its parameters; unknown values fall back to the default. */
export function cardLookFromParams(text: string | null): CardLook {
  const params = new URLSearchParams(text ?? "");
  const look = { ...DEFAULT_CARD_LOOK };
  const f = params.get("f");
  if (f === "auto" || (f && f in CARD_FORMATS)) look.format = f as CardFormat;
  const bg = params.get("bg");
  if (bg === "card" || bg === "none" || bg === "accent") look.background = bg;
  else if (bg && HEX.test(`#${bg}`)) look.background = `#${bg.toLowerCase()}`;
  if (params.has("s")) look.solid = params.get("s") === "1";
  if (params.has("sig")) look.signed = params.get("sig") === "1";
  return look;
}

/** The pixel ratio to save an image at: a format is its exact pixels, the card's own size twice as sharp. */
export const cardRatio = (look: CardLook) => (look.format === "auto" ? 2 : 1);

/**
 * The card image as an element, to show or to save, around the card's HTML from toHtml(). `accent` is the card's,
 * when it sets one, for the accent background. Call fitCard() once it is in the page.
 */
export function cardShot(html: string, look: CardLook, accent?: string): HTMLElement {
  const root = document.createElement("div");
  const bare = look.background === "card";
  root.className = `card-shot${bare ? " bare" : look.background === "none" ? " clear" : look.solid ? " solid" : ""}`;
  const color = look.background.startsWith("#") ? look.background : accent;
  if (color) root.style.setProperty("--snippet-accent", color);
  root.innerHTML = html;

  if (look.format !== "auto") {
    const { width, height } = CARD_FORMATS[look.format];
    root.classList.add("framed");
    root.style.width = `${width}px`;
    root.style.height = `${height}px`;
    // Filling the image, the card is as tall as the format at least, so the signature sits at the bottom
    const card = root.querySelector<HTMLElement>(".brew-card");
    if (bare && card) card.style.minHeight = `${(CARD_WIDTH * height) / width}px`;
  }
  return root;
}

/** In a format, scales the card down to fit the frame: whole, with a margin on a background. Filling the image,
 *  the card's color shows on its sides when it is scaled down. */
export function fitCard(root: HTMLElement) {
  const card = root.querySelector<HTMLElement>(".brew-card");
  if (!root.classList.contains("framed") || !card) return;
  const bare = root.classList.contains("bare");
  if (bare) root.style.backgroundColor = getComputedStyle(card).backgroundColor;
  const room = bare ? 0 : Math.min(root.clientWidth, root.clientHeight) * 0.08;
  const scale = Math.min(1, (root.clientWidth - 2 * room) / card.offsetWidth, (root.clientHeight - 2 * room) / card.offsetHeight);
  card.style.transform = `scale(${scale})`;
}
