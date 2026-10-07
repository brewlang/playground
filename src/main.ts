import { lintGutter } from "@codemirror/lint";
import { EditorView, basicSetup } from "codemirror";
import type { Diagnostic, Recipe, ScaleResult } from "brewlang";
import { check, format, scaleToDose, scaleToWater } from "brewlang";
import { brewAutocomplete } from "./complete";
import { brewHighlight } from "./highlight";
import { brewLint, range } from "./lint";

// The real recipes of the brewlang repo, keyed by file name
const EXAMPLES = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>("../../brewlang/examples/*.brew", { query: "?raw", import: "default", eager: true }),
  ).map(([path, source]) => [path.split("/").pop()!.replace(/\.brew$/, ""), source]),
);

const STORAGE_KEY = "brewlang-playground:source";
const DEFAULT = EXAMPLES["chemex-hoffmann"] ?? "@V60 15g 250g 94°C\n\n0:00 50g bloom\n0:45 250g\n";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// Storage can be missing or blocked (private windows): the playground works without it
const storage = {
  get: () => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  },
  set: (value: string) => {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {}
  },
};

/// A shared link carries the recipe in its hash, as base64url UTF-8
const encode = (source: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(source)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const decode = (hash: string): string | null => {
  try {
    const base64 = hash.replace(/-/g, "+").replace(/_/g, "/");
    return new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
};

const fromHash = () => {
  const match = /^#src=(.+)$/.exec(location.hash);
  return match?.[1] ? decode(match[1]) : null;
};

const view = new EditorView({
  doc: fromHash() ?? storage.get() ?? DEFAULT,
  parent: $("editor"),
  extensions: [
    basicSetup,
    brewHighlight,
    brewAutocomplete,
    brewLint,
    lintGutter(),
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) refresh();
    }),
  ],
});

const source = () => view.state.doc.toString();
const replace = (text: string) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });

/// Water on the scale at the end: the header total, or where the pours end
function totalWater(recipe: Recipe): { value: number; unit: string } | undefined {
  if (recipe.header?.water) return { value: recipe.header.water.amount.value, unit: recipe.header.water.unit };

  let total: { value: number; unit: string } | undefined;
  for (const step of recipe.steps) {
    if (step.kind !== "Pour") continue;
    const value = step.water.amount.value;
    total = { value: step.mode === "add" ? (total?.value ?? 0) + value : value, unit: step.water.unit };
  }
  return total;
}

const quantity = ({ value, max }: { value: number; max?: number }, unit: string) =>
  `${value}${max === undefined ? "" : `-${max}`}${unit}`;

function renderSummary(recipe: Recipe, ok: boolean) {
  const summary = $("summary");
  const { header } = recipe;
  if (!header) {
    summary.innerHTML = `<dt>Brewer</dt><dd class="muted">Start with a header, like @V60 15g 250g 94°C</dd>`;
    return;
  }

  const rows: [string, string][] = [
    ["Brewer", `@${header.brewer}`],
    ["Dose", quantity(header.dose.amount, header.dose.unit)],
  ];

  const water = totalWater(recipe);
  if (water) rows.push(["Water", `${water.value}${water.unit}`]);

  // No mass to volume conversion: a ratio only between the same units
  if (ok && water && water.unit === header.dose.unit && header.dose.amount.max === undefined) {
    rows.push(["Ratio", `1:${Number((water.value / header.dose.amount.value).toFixed(1))}`]);
  }
  if (header.temp) rows.push(["Temperature", quantity(header.temp.amount, header.temp.unit)]);

  const grind = recipe.steps.find((step) => step.kind === "Grind");
  if (grind) rows.push(["Grind", grind.size]);

  const target = recipe.steps.find((step) => step.kind === "Target");
  if (target) {
    const s = target.time.seconds;
    rows.push(["Target", `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`]);
  }

  summary.replaceChildren(
    ...rows.flatMap(([term, value]) => {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = term;
      dd.textContent = value;
      return [dt, dd];
    }),
  );
}

function renderDiagnostics(diagnostics: Diagnostic[]) {
  $("count").textContent = diagnostics.length ? String(diagnostics.length) : "";

  if (diagnostics.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No problem found.";
    $("diagnostics").replaceChildren(li);
    return;
  }

  $("diagnostics").replaceChildren(
    ...diagnostics.map((d) => {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = `diagnostic ${d.severity}`;
      button.innerHTML = `<span class="badge"></span><span class="where"></span><span class="message"></span>`;
      button.querySelector(".badge")!.textContent = d.severity;
      button.querySelector(".where")!.textContent = `${d.line}:${d.column}`;
      button.querySelector(".message")!.textContent = d.message;

      // Jump to the word the diagnostic points at
      button.addEventListener("click", () => {
        const { from, to } = range(view.state.doc, d);
        view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
        view.focus();
      });

      li.append(button);
      return li;
    }),
  );
}

let scaled: ScaleResult | undefined;

function renderScale(recipe: Recipe, ok: boolean) {
  const message = $("scale-message");
  const output = $<HTMLPreElement>("scaled");
  const use = $<HTMLButtonElement>("scale-use");
  const wanted = $<HTMLInputElement>("scale-to").value.trim();
  const by = $<HTMLSelectElement>("scale-by").value;

  const show = (text: string, isError = false) => {
    message.textContent = text;
    message.className = isError ? "error-text" : "muted";
    output.hidden = use.hidden = true;
    scaled = undefined;
  };

  if (!wanted) return show(`Give a new ${by === "dose" ? "dose, like 25g" : "total water, like 400g"}.`);
  if (!ok) return show("Fix the errors first: only a valid recipe can be scaled.", true);

  const amount = /^(\d+(?:\.\d+)?)\s*([a-z]+)$/i.exec(wanted);
  if (!amount) return show(`Write the amount with its unit, like ${by === "dose" ? "25g" : "400g"}.`, true);

  const target = { value: Number(amount[1]), unit: amount[2]!.toLowerCase() };
  scaled = by === "dose" ? scaleToDose(recipe, target) : scaleToWater(recipe, target);

  const error = scaled.diagnostics.find((d) => d.severity === "error");
  if (error) return show(error.message, true);

  message.textContent = scaled.diagnostics.map((d) => d.message).join(" ");
  message.className = "warning-text";
  output.textContent = format(scaled.recipe);
  output.hidden = use.hidden = false;
}

function refresh() {
  const text = source();
  storage.set(text);

  const { recipe, diagnostics } = check(text);
  const ok = !diagnostics.some((d) => d.severity === "error");

  renderSummary(recipe, ok);
  renderDiagnostics(diagnostics);
  renderScale(recipe, ok);
  $<HTMLButtonElement>("format").disabled = !ok;
}

// Example picker
const examples = $<HTMLSelectElement>("examples");
for (const name of Object.keys(EXAMPLES).sort()) {
  const option = document.createElement("option");
  option.value = option.textContent = name;
  examples.append(option);
}
examples.addEventListener("change", () => {
  const example = EXAMPLES[examples.value];
  if (example !== undefined) replace(example);
  examples.value = "";
});

$("format").addEventListener("click", () => {
  const { recipe, diagnostics } = check(source());
  if (diagnostics.some((d) => d.severity === "error")) return;
  const formatted = format(recipe);
  if (formatted !== source()) replace(formatted);
});

$("share").addEventListener("click", async () => {
  const url = `${location.origin}${location.pathname}#src=${encode(source())}`;
  history.replaceState(null, "", url);
  const button = $<HTMLButtonElement>("share");
  try {
    await navigator.clipboard.writeText(url);
    button.textContent = "Link copied";
  } catch {
    button.textContent = "Link in the address bar";
  }
  setTimeout(() => (button.textContent = "Copy link"), 2000);
});

$("scale").addEventListener("submit", (event) => event.preventDefault());
$("scale-to").addEventListener("input", refresh);
$("scale-by").addEventListener("change", refresh);
$("scale-use").addEventListener("click", () => {
  if (scaled) replace(format(scaled.recipe));
  $<HTMLInputElement>("scale-to").value = "";
  refresh();
});

refresh();
