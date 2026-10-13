import { toPng } from "html-to-image";

/** The recipe in a URL hash, as base64url UTF-8: '#src=…'. */
export const encode = (source: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(source)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** The recipe of a '#src=…' hash, or null when it cannot be read. */
export const decode = (hash: string): string | null => {
  try {
    const base64 = hash.replace(/-/g, "+").replace(/_/g, "/");
    return new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
};

/** A link that opens this recipe in the playground; nothing is uploaded. */
export const shareUrl = (source: string) => `${location.origin}${location.pathname}#src=${encode(source)}`;

/// What an SVG drawing needs from its CSS: html-to-image copies the computed styles of HTML elements, not of SVG ones
const SVG_STYLES = ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-dasharray", "stroke-linejoin", "vector-effect", "shape-rendering", "font-family", "font-size", "font-weight"];

/// Writes the computed styles of every SVG shape inline, so the image keeps the chart's colors
function inlineSvgStyles(node: HTMLElement) {
  for (const el of node.querySelectorAll<SVGElement>("svg *")) {
    const computed = getComputedStyle(el);
    for (const name of SVG_STYLES) el.style.setProperty(name, computed.getPropertyValue(name));
  }
}

/** Saves an element as a PNG at its own size, by default twice as sharp for retina screens. */
export async function downloadSnapshot(node: HTMLElement, filename: string, pixelRatio = 2) {
  inlineSvgStyles(node);
  const link = document.createElement("a");
  link.href = await toPng(node, { pixelRatio, cacheBust: true });
  link.download = filename;
  link.click();
}

/** Saves text as a file. */
export function downloadText(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
