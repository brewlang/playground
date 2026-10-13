// The code as an image, like carbon.now.sh: the editor's colors in a window, on the card's accent or on nothing

import { highlightLines } from "./highlight";

export interface SnippetLook {
  background: "accent" | "none";
  window: "auto" | "light" | "dark"; // 'auto' follows the playground's theme
  bar: boolean; // The title bar: three dots and the file name
  numbers: boolean;
}

export const DEFAULT_LOOK: SnippetLook = { background: "accent", window: "auto", bar: true, numbers: false };

/** A look as short parameters, for storage: only what differs from the default. */
export function lookToParams(look: SnippetLook): string {
  const params = new URLSearchParams();
  if (look.background !== DEFAULT_LOOK.background) params.set("bg", look.background);
  if (look.window !== DEFAULT_LOOK.window) params.set("w", look.window);
  if (look.bar !== DEFAULT_LOOK.bar) params.set("bar", look.bar ? "1" : "0");
  if (look.numbers !== DEFAULT_LOOK.numbers) params.set("n", look.numbers ? "1" : "0");
  return params.toString();
}

/** A look from its parameters; unknown values fall back to the default. */
export function lookFromParams(text: string | null): SnippetLook {
  const params = new URLSearchParams(text ?? "");
  const look = { ...DEFAULT_LOOK };
  const bg = params.get("bg");
  if (bg === "accent" || bg === "none") look.background = bg;
  const w = params.get("w");
  if (w === "auto" || w === "light" || w === "dark") look.window = w;
  if (params.has("bar")) look.bar = params.get("bar") === "1";
  if (params.has("n")) look.numbers = params.get("n") === "1";
  return look;
}

/** The code image as an element, to show or to save; `accent` is the card's, when it sets one. */
export function snippet(code: string, file: string, look: SnippetLook, accent?: string): HTMLElement {
  const root = document.createElement("div");
  root.className = `snippet${look.background === "none" ? " clear" : ""}`;
  if (look.window !== "auto") root.dataset.window = look.window;
  if (accent) root.style.setProperty("--snippet-accent", accent);

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
