import { EditorView, basicSetup } from "codemirror";
import type { Diagnostic, Recipe } from "brewlang";
import { check, toJson, totalWater } from "brewlang";
import type { RenderResult } from "@brewlang/render";
import { brewerKind, render, toHtml } from "@brewlang/render";
import "@brewlang/render/brew.css";
import { brewAutocomplete } from "./complete";
import { brewHighlight } from "./highlight";
import { brewLint, range } from "./lint";
import { brewMarks } from "./marks";
import type { CardStyle } from "./customize";
import { ACCENTS, DEFAULT_STYLE, FONTS, THEMES, applyStyle, css, fromParams, toParams } from "./customize";
import { decode, downloadPng, downloadText, shareUrl } from "./share";

// The real recipes of the brewlang repo, keyed by file name
const EXAMPLES = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>("../../brewlang/examples/*.brew", { query: "?raw", import: "default", eager: true }),
  ).map(([path, source]) => [path.split("/").pop()!, source]),
);
const DEFAULT_FILE = "chemex-hoffmann.brew";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// Storage can be missing or blocked (private windows): the playground works without it
const storage = {
  get: (key: string) => {
    try {
      return localStorage.getItem(`brewlang-playground:${key}`);
    } catch {
      return null;
    }
  },
  set: (key: string, value: string) => {
    try {
      localStorage.setItem(`brewlang-playground:${key}`, value);
    } catch {}
  },
};

/// What the reader chose; the source itself never changes with them
const state = {
  file: "recipe.brew",
  factor: 1,
  weight: undefined as "g" | "oz" | undefined, // Undefined: as the author wrote it
  temp: undefined as "°C" | "°F" | undefined,
  menu: undefined as "examples" | "share" | "customize" | "scale" | undefined,
};

// A shared link carries the recipe and the card's style: '#src=…&t=roaster&a=berry'
const hash = new URLSearchParams(location.hash.slice(1));
const fromHash = () => {
  const src = hash.get("src");
  return src ? decode(src) : null;
};

let style: CardStyle = hash.has("src") ? fromParams(hash) : fromParams(new URLSearchParams(storage.get("style") ?? ""));

/// The link to share: the recipe, then the style when it is not the default
const link = () => {
  const params = toParams(style).toString();
  return shareUrl(source()) + (params ? `&${params}` : "");
};

let initial = fromHash();
if (initial === null) {
  initial = storage.get("source");
  state.file = storage.get("file") ?? state.file;
}
if (initial === null) {
  initial = EXAMPLES[DEFAULT_FILE] ?? "@V60 15g 250g 94°C\n\n0:00 50g bloom\n0:45 250g\n";
  state.file = DEFAULT_FILE;
}

const view = new EditorView({
  doc: initial,
  parent: $("editor"),
  extensions: [
    basicSetup,
    brewHighlight,
    brewAutocomplete,
    brewLint,
    brewMarks,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) refresh();
    }),
  ],
});

const source = () => view.state.doc.toString();
const replace = (text: string) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });

// Toast

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(text: string) {
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3200);
}

// Tabs, on narrow screens: the code or the recipe

function showTab(tab: "code" | "recipe") {
  $("editor").closest(".panes")!.setAttribute("data-tab", tab);
  $("tab-code").classList.toggle("on", tab === "code");
  $("tab-recipe").classList.toggle("on", tab === "recipe");
}
$("tab-code").addEventListener("click", () => showTab("code"));
$("tab-recipe").addEventListener("click", () => showTab("recipe"));

// Layout, on wide screens: the code, the recipe, or both with a gutter between them

type Layout = "code" | "split" | "recipe";
const LAYOUTS: readonly Layout[] = ["code", "split", "recipe"];
const panes = $("editor").closest<HTMLElement>(".panes")!;
const gutter = $("gutter");

function setLayout(layout: Layout) {
  panes.dataset.layout = layout;
  for (const button of document.querySelectorAll<HTMLButtonElement>("#layout button")) {
    button.classList.toggle("on", button.dataset.layout === layout);
  }
  storage.set("layout", layout);
}

/// The narrowest each pane may get: the recipe's tools must fit on their line
const MIN_CODE = 280;
const MIN_RECIPE = 440;

/// The code pane's share of the width, in percent: 20 to 80, and never below the panes' minimums
let split = 50;
function setSplit(percent: number, save = false) {
  const width = panes.getBoundingClientRect().width || window.innerWidth;
  const low = Math.max(20, (MIN_CODE / width) * 100);
  const high = Math.max(low, Math.min(80, 100 - (MIN_RECIPE / width) * 100));
  gutter.setAttribute("aria-valuemin", String(Math.ceil(low)));
  gutter.setAttribute("aria-valuemax", String(Math.floor(high)));
  split = Math.round(Math.min(high, Math.max(low, percent)));
  panes.style.setProperty("--code", `${split}fr`);
  panes.style.setProperty("--recipe", `${100 - split}fr`);
  gutter.setAttribute("aria-valuenow", String(split));
  if (save) storage.set("split", String(split));
}

for (const button of document.querySelectorAll<HTMLButtonElement>("#layout button")) {
  button.addEventListener("click", () => setLayout(button.dataset.layout as Layout));
}

gutter.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  gutter.setPointerCapture(event.pointerId);
  gutter.classList.add("dragging");
  document.documentElement.classList.add("resizing");
});
gutter.addEventListener("pointermove", (event) => {
  if (!gutter.hasPointerCapture(event.pointerId)) return;
  const { left, width } = panes.getBoundingClientRect();
  setSplit(((event.clientX - left) / width) * 100);
});
const endDrag = (event: PointerEvent) => {
  if (!gutter.hasPointerCapture(event.pointerId)) return;
  gutter.releasePointerCapture(event.pointerId);
  gutter.classList.remove("dragging");
  document.documentElement.classList.remove("resizing");
  setSplit(split, true);
  wanted = split;
};
gutter.addEventListener("pointerup", endDrag);
gutter.addEventListener("pointercancel", endDrag);
gutter.addEventListener("dblclick", () => {
  setSplit(50, true);
  wanted = split;
});
gutter.addEventListener("keydown", (event) => {
  const keys: Record<string, number> = { ArrowLeft: split - 5, ArrowRight: split + 5, Home: 20, End: 80 };
  const next = keys[event.key];
  if (next === undefined) return;
  event.preventDefault();
  setSplit(next, true);
  wanted = split;
});

const savedLayout = storage.get("layout") as Layout | null;
setLayout(savedLayout && LAYOUTS.includes(savedLayout) ? savedLayout : "split");
/// What the reader chose, applied again when the window changes; the minimums may move it
let wanted = Number(storage.get("split")) || 50;
setSplit(wanted);
window.addEventListener("resize", () => setSplit(wanted));

/// Select the word a diagnostic points at
function jumpTo(d: Diagnostic) {
  showTab("code");
  const { from, to } = range(view.state.doc, d);
  view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
  view.focus();
}

// Problems

const SEVERITY_LABELS = { error: "Error", warning: "Warning", suggestion: "Suggestion" };
const SEVERITY_RANK = { error: 0, warning: 1, suggestion: 2 };

/// Split a message into what is wrong and what to do: 'The scale is already at 150g: pour higher' -> two lines
function splitMessage(message: string): [string, string] {
  const match = /^(.+?)(?:: |\. )(?=[A-Za-z'])(.+)$/.exec(message);
  if (!match) return [message, ""];
  const [, what, fix] = match as unknown as [string, string, string];
  return [what.endsWith("?") ? what : `${what}.`, fix.charAt(0).toUpperCase() + fix.slice(1)];
}

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;

function renderProblems(diagnostics: Diagnostic[]) {
  const counts = { error: 0, warning: 0, suggestion: 0 };
  for (const d of diagnostics) counts[d.severity]++;

  const parts = [];
  if (counts.error) parts.push(plural(counts.error, "error"));
  if (counts.warning) parts.push(plural(counts.warning, "warning"));
  if (counts.suggestion) parts.push(plural(counts.suggestion, "suggestion"));

  const status = $("status");
  status.textContent = parts.length ? parts.join(" · ") : "Valid recipe";
  status.dataset.severity = counts.error ? "error" : counts.warning ? "warning" : counts.suggestion ? "suggestion" : "ok";

  $("count").textContent = diagnostics.length ? String(diagnostics.length) : "";
  const badge = $("badge");
  badge.hidden = counts.error + counts.warning === 0;
  badge.textContent = String(counts.error + counts.warning);

  const list = $("problems");
  if (diagnostics.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No problems. This recipe is ready to share.";
    list.replaceChildren(li);
    return;
  }

  const sorted = [...diagnostics].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.line - b.line);
  list.replaceChildren(
    ...sorted.map((d) => {
      const [what, fix] = splitMessage(d.message);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `problem ${d.severity}`;
      button.innerHTML = `<span class="severity"><span class="shape"></span><span class="name"></span></span><span class="text"><strong></strong><span class="fix"></span></span><span class="where mono"></span>`;
      button.querySelector(".name")!.textContent = SEVERITY_LABELS[d.severity];
      button.querySelector("strong")!.textContent = what;
      button.querySelector(".fix")!.textContent = fix;
      button.querySelector(".where")!.textContent = `Line ${d.line}, col ${d.column}`;
      button.addEventListener("click", () => jumpTo(d));

      const li = document.createElement("li");
      li.append(button);
      return li;
    }),
  );
}

// Recipe: scaled and converted for display only

const OUNCE = 28.349523125;

const tempOf = (recipe: Recipe) => recipe.header?.temp ?? recipe.steps.find((s) => s.kind === "TempChange")?.temp;

/// A dose typed in the displayed unit, back in the recipe's unit
const FLUID_OUNCE = 29.5735295625;

/// An amount typed in the shown unit, in the unit the recipe is written in: oz -> g, floz -> ml and back
function toSourceUnit(value: number, unit: string, written: string) {
  if (unit === written) return value;
  if (unit === "oz") return value * OUNCE;
  if (written === "oz") return value / OUNCE;
  return unit === "floz" ? value * FLUID_OUNCE : value / FLUID_OUNCE;
}

let shown: RenderResult | undefined; // The card on screen, reused for the image

/// Scaled and converted by @brewlang/render, for display only: the source never changes
function renderRecipePane(recipe: Recipe, diagnostics: Diagnostic[]) {
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const notes = $("notes");
  notes.replaceChildren();

  const note = (text: string, onClick?: () => void) => {
    const el = document.createElement(onClick ? "button" : "div");
    el.className = "note error";
    el.textContent = text;
    if (onClick) el.addEventListener("click", onClick);
    notes.append(el);
  };

  if (errors) {
    note(`${plural(errors, "error")} in the code. The recipe below may not brew as written.`, () =>
      jumpTo(diagnostics.find((d) => d.severity === "error")!),
    );
  }

  shown = render(source(), {
    factor: state.factor,
    ...(state.weight && { weight: state.weight }),
    ...(state.temp && { temp: state.temp }),
    title: state.file.replace(/\.brew$/, ""),
  });
  // Only failures: the scaling warning ("Amounts ×1.5, times unchanged") is left out
  for (const d of shown.notes) if (d.severity === "error") note(d.message);

  renderTools(recipe, shown.recipe, errors === 0);

  const container = $("recipe");
  if (!shown.html) {
    const empty = document.createElement("p");
    empty.className = "empty-recipe";
    empty.textContent = "Start with a brewer line, like @V60 15g 250g 94°C.";
    container.replaceChildren(empty);
    return;
  }
  container.innerHTML = shown.html; // Escaped by toHtml
  applyStyle(container.firstElementChild, style);
}

/// The segmented buttons: [value, label, active]
function segmented(id: string, items: [string, string, boolean][], pick: (value: string) => void, disabled: boolean) {
  $(id).replaceChildren(
    ...items.map(([value, label, active]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.classList.toggle("on", active);
      button.disabled = disabled;
      button.addEventListener("click", () => pick(value));
      return button;
    }),
  );
}

function renderTools(recipe: Recipe, shown: Recipe, ok: boolean) {
  const dose = recipe.header?.dose;
  const shownDose = shown.header?.dose;
  const canScale = ok && dose !== undefined && dose.amount.max === undefined;

  // The coffee and the water as shown; a field being typed in keeps its text
  const doseInput = $<HTMLInputElement>("dose");
  doseInput.disabled = !canScale;
  if (document.activeElement !== doseInput) doseInput.value = shownDose ? String(shownDose.amount.value) : "";
  $("dose-unit").textContent = shownDose?.unit ?? "g";

  const water = ok ? totalWater(shown) : undefined;
  const waterInput = $<HTMLInputElement>("water");
  waterInput.disabled = !canScale || !water || water.low !== water.high;
  if (document.activeElement !== waterInput) waterInput.value = water && !waterInput.disabled ? String(water.low) : "";
  $("water-unit").textContent = water?.unit ?? "g";

  // Scale: a button showing the factor, and its menu of usual factors
  $<HTMLButtonElement>("scale-button").disabled = !canScale;
  $("scale-value").textContent = factorLabel(state.factor);
  $("scales").replaceChildren(
    ...SCALES.map(([value, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.classList.toggle("on", Math.abs(state.factor - value) < 1e-6);
      button.addEventListener("click", () => {
        setFactor(value);
        openMenu(undefined);
      });
      return button;
    }),
  );

  // Without a choice, the units are the author's: the dose's for the weight, the first temperature's
  const weight = state.weight ?? dose?.unit;
  segmented(
    "weights",
    [
      ["g", "g", weight === "g"],
      ["oz", "oz", weight === "oz"],
    ],
    (value) => {
      state.weight = value as "g" | "oz";
          refresh();
    },
    !ok || !recipe.header,
  );

  const writtenTemp = tempOf(recipe)?.unit;
  const temp = state.temp ?? writtenTemp;
  segmented(
    "temps",
    [
      ["°C", "°C", temp === "°C"],
      ["°F", "°F", temp === "°F"],
    ],
    (value) => {
      state.temp = value as "°C" | "°F";
      refresh();
    },
    !ok || !writtenTemp,
  );
}

/// The usual factors of the scale menu; under them, the coffee or the water to scale to
const SCALES: readonly [number, string][] = [
  [0.5, "½×"],
  [1, "1×"],
  [1.5, "1.5×"],
  [2, "2×"],
];

/// Two decimals at most: 1.333… -> 1.33
const round = (n: number) => Math.round(n * 100) / 100;

/// 0.5 -> '½×', 1.25 -> '1.25×'
const factorLabel = (factor: number) => SCALES.find(([value]) => Math.abs(value - factor) < 1e-6)?.[1] ?? `${round(factor)}×`;

function setFactor(factor: number) {
  state.factor = factor;
  refresh();
}

/// Scale to an amount typed in the menu: the factor is the typed amount over the recipe's own
function scaleTo(input: HTMLInputElement, unit: string, written: { value: number; unit: string } | undefined) {
  const typed = parseFloat(input.value.replace(",", "."));
  if (!written || !(typed > 0)) return;
  const factor = toSourceUnit(typed, unit, written.unit) / written.value;
  if (factor <= 20) setFactor(factor);
}

$("dose").addEventListener("input", () => {
  const dose = check(source()).recipe.header?.dose;
  scaleTo($("dose"), $("dose-unit").textContent ?? "", dose && { value: dose.amount.value, unit: dose.unit });
});
$("water").addEventListener("input", () => {
  const water = totalWater(check(source()).recipe);
  scaleTo($("water"), $("water-unit").textContent ?? "", water && { value: water.low, unit: water.unit });
});
for (const id of ["dose", "water"]) {
  // Leaving a field shows the amount as the card does, rounded
  $(id).addEventListener("blur", () => refresh());
  $(id).addEventListener("keydown", (event) => {
    if (event.key === "Enter") openMenu(undefined);
  });
}

// Menus: dropdowns on wide screens, sheets on narrow ones

/// The menus that open under their button on wide screens, wherever the gutter puts it
const ANCHORED = { customize: "[data-action=customize]", scale: "#scale-button" } as const;
const wide = window.matchMedia("(min-width: 861px)");

function openMenu(menu: typeof state.menu) {
  state.menu = state.menu === menu ? undefined : menu;
  $("examples-menu").hidden = state.menu !== "examples";
  $("share-menu").hidden = state.menu !== "share";
  $("customize-menu").hidden = state.menu !== "customize";
  $("scale-menu").hidden = state.menu !== "scale";
  $("scrim").hidden = !state.menu;
  if (state.menu === "share") $("share-url").textContent = link();

  for (const [name, selector] of Object.entries(ANCHORED)) {
    const el = $(`${name}-menu`);
    if (state.menu !== name || !wide.matches) {
      el.style.removeProperty("top");
      el.style.removeProperty("left");
      continue;
    }
    const button = document.querySelector(selector)!.getBoundingClientRect();
    const width = el.getBoundingClientRect().width;
    el.style.top = `${button.bottom + 6}px`;
    el.style.left = `${Math.max(8, Math.min(button.left, window.innerWidth - width - 8))}px`;
  }
}
$("scrim").addEventListener("click", () => openMenu(undefined));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.menu) openMenu(undefined);
});

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-action]")) {
  button.addEventListener("click", () => {
    const action = button.dataset.action;
    if (action === "examples" || action === "share" || action === "customize" || action === "scale") openMenu(action);
    if (action === "prompt") copyPrompt();
  });
}

/// Show another recipe, in its own units and amounts
function load(text: string, file: string) {
  state.file = file;
  state.factor = 1;
  state.weight = undefined;
  state.temp = undefined;
  replace(text);
}

/// Open a file from the computer; a .brew file is plain UTF-8 text
async function openFile(file: File | undefined) {
  if (!file) return;
  if (file.size > 1_000_000) return toast(`${file.name} is too big for a recipe.`);
  load(await file.text(), file.name);
  showTab("code");
  toast(`Opened ${file.name}.`);
}

$<HTMLInputElement>("open-file").addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  openMenu(undefined);
  void openFile(input.files?.[0]);
  input.value = ""; // Opening the same file again still fires 'change'
});

// Drop a file anywhere on the page; dragging text or links does nothing
const hasFile = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;
let dragDepth = 0;
document.addEventListener("dragenter", (event) => {
  if (!hasFile(event)) return;
  dragDepth++;
  $("drop").hidden = false;
});
document.addEventListener("dragleave", (event) => {
  if (!hasFile(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) $("drop").hidden = true;
});
document.addEventListener("dragover", (event) => {
  if (hasFile(event)) event.preventDefault();
});
document.addEventListener("drop", (event) => {
  if (!hasFile(event)) return;
  event.preventDefault();
  dragDepth = 0;
  $("drop").hidden = true;
  void openFile(event.dataTransfer?.files[0]);
});

// Examples, named by their title, with the kind of brewer
const examples = Object.entries(EXAMPLES)
  .map(([file, text]) => {
    const { recipe } = check(text);
    const title = toJson(recipe).json?.metadata?.title ?? file.replace(/\.brew$/, "");
    return { file, text, title, kind: recipe.header ? brewerKind(recipe.header.brewer) : "" };
  })
  .sort((a, b) => a.title.localeCompare(b.title));

$("examples").replaceChildren(
  ...examples.map((example) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "example";
    button.innerHTML = `<strong></strong><span class="muted"></span>`;
    button.querySelector("strong")!.textContent = example.title;
    button.querySelector("span")!.textContent = example.kind;
    button.addEventListener("click", () => {
      openMenu(undefined);
      load(example.text, example.file);
    });
    return button;
  }),
);

// Share

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

$("copy-link").addEventListener("click", async () => {
  const url = link();
  history.replaceState(null, "", url);
  openMenu(undefined);
  toast((await copy(url)) ? "Link copied. Anyone who opens it sees this recipe." : "The link is in the address bar.");
});

$("download").addEventListener("click", async () => {
  openMenu(undefined);
  if (!shown?.model) return toast("Write a recipe first: it starts with a brewer line.");

  const name = `${state.file.replace(/\.brew$/, "")}.png`;
  const exportBox = $("export");
  exportBox.innerHTML = toHtml(shown.model, { signed: true });
  applyStyle(exportBox.firstElementChild, style);
  try {
    await document.fonts.ready;
    await downloadPng(exportBox.firstElementChild as HTMLElement, name, 1080, 1350);
    toast(`Saved ${name} (1080 × 1350).`);
  } catch {
    toast("The image could not be made in this browser.");
  } finally {
    exportBox.replaceChildren();
  }
});

$("download-brew").addEventListener("click", () => {
  openMenu(undefined);
  const name = state.file.endsWith(".brew") ? state.file : `${state.file}.brew`;
  downloadText(source(), name);
  toast(`Saved ${name}.`);
});

async function copyPrompt() {
  const spec = new URL(`${import.meta.env.BASE_URL}llms.txt`, location.origin).href;
  const prompt = `Write my coffee recipe in Brewlang. The format is described at ${spec}. Reply with the .brew file only.\n\nMy recipe: `;
  toast((await copy(prompt)) ? `Prompt copied. It points your AI to ${spec}.` : "The clipboard is blocked in this browser.");
}

// Customize: the card's theme, accent and title font, saved and carried by the shared link

/// A row of choices: [value, label, active], built as buttons with an optional look
function choices(id: string, items: [string, string, boolean][], pick: (value: string) => void, decorate?: (button: HTMLButtonElement, value: string) => void) {
  $(id).replaceChildren(
    ...items.map(([value, label, active]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.title = label;
      button.classList.toggle("on", active);
      button.setAttribute("aria-pressed", String(active));
      decorate?.(button, value);
      button.addEventListener("click", () => pick(value));
      return button;
    }),
  );
}

function setStyle(next: CardStyle) {
  style = next;
  storage.set("style", toParams(style).toString());
  renderCustomize();
  refresh();
}

function renderCustomize() {
  choices(
    "custom-themes",
    [["auto", "Auto", style.theme === "auto"], ...Object.entries(THEMES).map(([key, t]): [string, string, boolean] => [key, t.label, style.theme === key])],
    (value) => setStyle({ ...style, theme: value as CardStyle["theme"] }),
    (button, value) => {
      // A small preview of the card: its paper, its ink and its accent
      const palette = value === "auto" ? undefined : THEMES[value as keyof typeof THEMES].palette;
      button.style.setProperty("--tile-bg", palette?.bg ?? "var(--card)");
      button.style.setProperty("--tile-ink", palette?.ink ?? "var(--ink)");
      button.style.setProperty("--tile-accent", palette?.accent ?? "var(--accent)");
    },
  );

  const custom = style.accent?.startsWith("#") ? style.accent : undefined;
  choices(
    "custom-accents",
    [["", "Theme", style.accent === undefined], ...Object.entries(ACCENTS).map(([key, a]): [string, string, boolean] => [key, a.label, style.accent === key])],
    (value) => {
      const { accent: _, ...rest } = style;
      setStyle(value ? { ...rest, accent: value } : rest);
    },
    (button, value) => button.style.setProperty("--swatch", value ? ACCENTS[value]!.color : "transparent"),
  );
  const picker = document.createElement("label");
  picker.className = `swatch-custom${custom ? " on" : ""}`;
  picker.title = "Any color";
  picker.innerHTML = `<input type="color" aria-label="Any accent color" />`;
  const input = picker.querySelector("input")!;
  input.value = custom ?? "#b5542e";
  if (custom) picker.style.setProperty("--swatch", custom);
  input.addEventListener("input", () => setStyle({ ...style, accent: input.value }));
  $("custom-accents").append(picker);

  choices(
    "custom-fonts",
    Object.entries(FONTS).map(([key, f]): [string, string, boolean] => [key, f.label, style.font === key]),
    (value) => setStyle({ ...style, font: value as CardStyle["font"] }),
    (button, value) => (button.style.fontFamily = FONTS[value as keyof typeof FONTS].family),
  );
}

$("copy-css").addEventListener("click", async () => {
  toast((await copy(css(style))) ? "CSS copied: paste it next to brew.css to get this card." : "The clipboard is blocked in this browser.");
});
$("reset-style").addEventListener("click", () => setStyle({ ...DEFAULT_STYLE }));

renderCustomize();

// Theme: the system's until the reader picks one

$("theme").addEventListener("click", () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  storage.set("theme", root.dataset.theme);
});

function refresh() {
  const text = source();
  storage.set("source", text);
  storage.set("file", state.file);

  const { recipe, diagnostics } = check(text);
  $("file").textContent = state.file;
  renderProblems(diagnostics);
  renderRecipePane(recipe, diagnostics);
}

refresh();
