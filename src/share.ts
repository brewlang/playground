import { toCanvas } from "html-to-image";

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

/** Saves an element as a PNG of the given size; a taller element is scaled down to fit, centered. */
export async function downloadPng(node: HTMLElement, filename: string, width: number, height: number) {
  const natural = Math.max(height, node.scrollHeight);
  const shot = await toCanvas(node, { width, height: natural, pixelRatio: 1, cacheBust: true });

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  context.fillStyle = getComputedStyle(node).backgroundColor;
  context.fillRect(0, 0, width, height);
  const scale = height / natural;
  context.drawImage(shot, (width - width * scale) / 2, 0, width * scale, height);

  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
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
