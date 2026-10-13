// The code as an image, like carbon.now.sh: the editor's colors in a window, on the card's accent or on nothing

import { highlightLines } from "./highlight";

export interface SnippetLook {
  background: "accent" | "none" | string; // The card's accent, nothing, or a '#rrggbb' color
  window: "auto" | "light" | "dark"; // 'auto' follows the playground's theme
  bar: boolean; // The title bar: three dots and the file name
  numbers: boolean;
  format: Format;
}

/// The background swatches besides the accent and nothing; any other color comes from the picker
export const BACKGROUNDS: Record<string, string> = {
  "#141210": "Ink",
  "#f4f3ef": "Paper",
  "#3d6584": "Slate",
  "#17795e": "Pine",
  "#c08a2e": "Honey",
};

const HEX = /^#[0-9a-f]{6}$/i;

/// The image's size: 'auto' fits the code; the others are social formats, in pixels
export type Format = "auto" | "square" | "portrait" | "story" | "wide";
export const FORMATS: Record<Exclude<Format, "auto">, { label: string; width: number; height: number }> = {
  square: { label: "1:1", width: 1080, height: 1080 },
  portrait: { label: "4:5", width: 1080, height: 1350 },
  story: { label: "9:16", width: 1080, height: 1920 },
  wide: { label: "16:9", width: 1920, height: 1080 },
};

export const DEFAULT_LOOK: SnippetLook = { background: "accent", window: "auto", bar: true, numbers: false, format: "auto" };

/** A look as short parameters, for storage: only what differs from the default. */
export function lookToParams(look: SnippetLook): string {
  const params = new URLSearchParams();
  if (look.background !== DEFAULT_LOOK.background) params.set("bg", look.background.replace(/^#/, ""));
  if (look.window !== DEFAULT_LOOK.window) params.set("w", look.window);
  if (look.bar !== DEFAULT_LOOK.bar) params.set("bar", look.bar ? "1" : "0");
  if (look.numbers !== DEFAULT_LOOK.numbers) params.set("n", look.numbers ? "1" : "0");
  if (look.format !== DEFAULT_LOOK.format) params.set("f", look.format);
  return params.toString();
}

/** A look from its parameters; unknown values fall back to the default. */
export function lookFromParams(text: string | null): SnippetLook {
  const params = new URLSearchParams(text ?? "");
  const look = { ...DEFAULT_LOOK };
  const bg = params.get("bg");
  if (bg === "accent" || bg === "none") look.background = bg;
  else if (bg && HEX.test(`#${bg}`)) look.background = `#${bg.toLowerCase()}`;
  const w = params.get("w");
  if (w === "auto" || w === "light" || w === "dark") look.window = w;
  if (params.has("bar")) look.bar = params.get("bar") === "1";
  if (params.has("n")) look.numbers = params.get("n") === "1";
  const f = params.get("f");
  if (f && f in FORMATS) look.format = f as Format;
  return look;
}

/** The code image as an element, to show or to save; `accent` is the card's, when it sets one, for the accent background. */
export function snippet(code: string, file: string, look: SnippetLook, accent?: string): HTMLElement {
  const root = document.createElement("div");
  root.className = `snippet${look.background === "none" ? " clear" : ""}`;
  if (look.window !== "auto") root.dataset.window = look.window;
  const color = look.background.startsWith("#") ? look.background : accent;
  if (color) root.style.setProperty("--snippet-accent", color);
  // A format is drawn at half its size, saved twice as sharp: the exact pixels
  if (look.format !== "auto") {
    const { width, height } = FORMATS[look.format];
    root.classList.add("framed");
    root.style.width = `${width / 2}px`;
    root.style.height = `${height / 2}px`;
    // Narrower lines in tall frames, so the code wraps and fills them with bigger text
    root.style.setProperty("--snippet-max", `${Math.min(960, width * 0.6)}px`);
  }

  const frame = root.appendChild(document.createElement("div"));
  frame.className = "snippet-window";
  if (look.bar) {
    const bar = frame.appendChild(document.createElement("div"));
    bar.className = "snippet-bar";
    bar.innerHTML = "<i></i><i></i><i></i><span></span>";
    bar.querySelector("span")!.textContent = file;
  }

  const lines = highlightLines(code);
  const width = String(lines.length).length;
  const body = frame.appendChild(document.createElement("div"));
  body.className = "snippet-code";
  body.innerHTML = lines
    .map(
      (line, i) =>
        `<div class="snippet-line">${look.numbers ? `<span class="snippet-num" style="width:${width}ch">${i + 1}</span>` : ""}<span class="snippet-text">${line}</span></div>`,
    )
    .join("");
  return root;
}

/** In a format, scales the window to fill the frame; call it once the image is in the page, so it can be measured. */
export function fitSnippet(root: HTMLElement) {
  const frame = root.querySelector<HTMLElement>(".snippet-window");
  if (!root.classList.contains("framed") || !frame) return;
  const room = Math.min(root.clientWidth, root.clientHeight) * 0.1; // The margin around the window
  const scale = Math.min((root.clientWidth - 2 * room) / frame.offsetWidth, (root.clientHeight - 2 * room) / frame.offsetHeight, 2);
  frame.style.transform = `scale(${scale})`;
}
