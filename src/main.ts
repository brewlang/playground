import { EditorView, basicSetup } from "codemirror";
import type { Diagnostic, Recipe } from "brewlang";
import { check, toJson } from "brewlang";
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
  doseText: undefined as string | undefined, // The dose being typed, kept as is until it changes
  menu: undefined as "examples" | "share" | "customize" | undefined,
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
const toSourceDose = (value: number, unit: string, written: string) =>
  unit === written ? value : unit === "oz" ? value * OUNCE : value / OUNCE;

let shown: RenderResult | undefined; // The card on screen, reused for the image

/// Scaled and converted by @brewlang/render, for display only: the source never changes
function renderRecipePane(recipe: Recipe, diagnostics: Diagnostic[]) {
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const notes = $("notes");
  notes.replaceChildren();

  const note = (text: string, kind: "error" | "info", onClick?: () => void) => {
    const el = document.createElement(onClick ? "button" : "div");
    el.className = `note ${kind}`;
    el.textContent = text;
    if (onClick) el.addEventListener("click", onClick);
    notes.append(el);
  };

  if (errors) {
    note(`${plural(errors, "error")} in the code. The recipe below may not brew as written.`, "error", () =>
      jumpTo(diagnostics.find((d) => d.severity === "error")!),
    );
  }

  shown = render(source(), {
    factor: state.factor,
    ...(state.weight && { weight: state.weight }),
    ...(state.temp && { temp: state.temp }),
    title: state.file.replace(/\.brew$/, ""),
  });
  for (const d of shown.notes) note(d.message, d.severity === "error" ? "error" : "info");

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

  const input = $<HTMLInputElement>("dose");
  input.disabled = !canScale;
  if (document.activeElement !== input || state.doseText === undefined) {
    input.value = shownDose ? String(shownDose.amount.value) : "";
  }
  $("dose-unit").textContent = shownDose?.unit ?? "g";

  segmented(
    "scales",
    [
      ["0.5", "½×", Math.abs(state.factor - 0.5) < 1e-6],
      ["1", "1×", Math.abs(state.factor - 1) < 1e-6],
      ["1.5", "1.5×", Math.abs(state.factor - 1.5) < 1e-6],
      ["2", "2×", Math.abs(state.factor - 2) < 1e-6],
    ],
    (value) => {
      state.factor = Number(value);
      state.doseText = undefined;
      refresh();
    },
    !canScale,
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
      state.doseText = undefined;
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

$("dose").addEventListener("input", () => {
  const input = $<HTMLInputElement>("dose");
  state.doseText = input.value;
  const { recipe } = check(source());
  const dose = recipe.header?.dose;
  const typed = parseFloat(input.value.replace(",", "."));
  if (!dose || !(typed > 0)) return;

  const shownUnit = $("dose-unit").textContent ?? dose.unit;
  state.factor = toSourceDose(typed, shownUnit, dose.unit) / dose.amount.value;
  refresh();
});
$("dose").addEventListener("blur", () => {
  state.doseText = undefined;
  refresh();
});

// Menus: dropdowns on wide screens, sheets on narrow ones

function openMenu(menu: typeof state.menu) {
  state.menu = state.menu === menu ? undefined : menu;
  $("examples-menu").hidden = state.menu !== "examples";
  $("share-menu").hidden = state.menu !== "share";
  $("customize-menu").hidden = state.menu !== "customize";
  $("scrim").hidden = !state.menu;
  if (state.menu === "share") $("share-url").textContent = link();
}
$("scrim").addEventListener("click", () => openMenu(undefined));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.menu) openMenu(undefined);
});

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-action]")) {
  button.addEventListener("click", () => {
    const action = button.dataset.action;
    if (action === "examples" || action === "share" || action === "customize") openMenu(action);
    if (action === "prompt") copyPrompt();
  });
}

/// Show another recipe, in its own units and amounts
function load(text: string, file: string) {
  state.file = file;
  state.factor = 1;
  state.weight = undefined;
  state.temp = undefined;
  state.doseText = undefined;
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
