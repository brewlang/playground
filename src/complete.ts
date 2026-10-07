import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import type { EditorState } from "@codemirror/state";
import { EditorState as State } from "@codemirror/state";
import type { BrewerType } from "brewlang";
import {
  ACTION_ALIASES,
  ACTIONS,
  BREWERS,
  DOSE_UNITS,
  GRIND_SIZES,
  QUALIFIERS,
  TEMP_UNITS,
  WATER_UNITS,
  findBrewer,
} from "brewlang";

// Every list comes from brewlang: the completion never offers what the checker would refuse

const BREWER_OPTIONS: Completion[] = BREWERS.map((brewer) => ({
  label: `@${brewer.name}`,
  detail: brewer.type,
  type: "class",
}));

const GRIND_OPTIONS: Completion[] = GRIND_SIZES.map((size) => ({ label: size, type: "constant" }));

const KEYWORD_OPTIONS: Completion[] = [
  { label: "grind", detail: "grind size", type: "keyword", apply: "grind " },
  { label: "target", detail: "end time", type: "keyword", apply: "target " },
];

/// Pour qualifiers that say how to pour; only one per pour
const TECHNIQUES: readonly string[] = ["spiral", "center", "pulse"];

const units = (list: readonly string[], detail: string): Completion[] =>
  list.map((unit) => ({ label: unit, detail, type: "unit" }));

const DOSE = units(DOSE_UNITS, "dose");
const WATER = units(WATER_UNITS, "water");
const TEMP = units(TEMP_UNITS, "temperature");
const DURATION = units(["s", "m"], "duration");

/// The type of the brewer named in the header; undefined when absent or unknown
function brewerType(state: EditorState): BrewerType | undefined {
  const match = /^\s*@(\S+)/m.exec(state.doc.toString());
  return match?.[1] ? findBrewer(match[1])?.type : undefined;
}

/// Known actions allowed with this brewer type, aliases included; an unknown brewer allows them all
function actionOptions(type: BrewerType | undefined): Completion[] {
  const allowed = (name: string) => {
    const types = ACTIONS[name]?.types;
    return !type || !types || types.includes(type);
  };

  const options = Object.keys(ACTIONS)
    .filter(allowed)
    .map((name): Completion => {
      const types = ACTIONS[name]?.types;
      return types ? { label: `/${name}`, detail: types.join(", "), type: "function" } : { label: `/${name}`, type: "function" };
    });

  for (const [alias, name] of Object.entries(ACTION_ALIASES)) {
    if (allowed(name)) options.push({ label: `/${alias}`, detail: `= /${name}`, type: "function" });
  }

  return options;
}

/// True inside the '---' frontmatter at the top of the file
function inFrontmatter(state: EditorState, lineNumber: number): boolean {
  const { doc } = state;
  if (doc.line(1).text.trim() !== "---") return false;
  for (let n = 2; n < lineNumber; n++) {
    if (doc.line(n).text.trim() === "---") return false;
  }
  return lineNumber > 1;
}

/** Completes brewers, actions, grind sizes, qualifiers, keywords and units, from the brewlang vocabulary. */
export function brewCompletions(context: CompletionContext): CompletionResult | null {
  const { state, pos } = context;
  const line = state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);

  if (before.includes("--") || inFrontmatter(state, line.number)) return null;

  const result = (word: string, options: Completion[], validFor: RegExp): CompletionResult => ({
    from: pos - word.length,
    options,
    validFor,
  });

  // '@V' at the start of a line: the brewer of the header
  let match = /^\s*(@[\w-]*)$/.exec(before);
  if (match) return result(match[1]!, BREWER_OPTIONS, /^@[\w-]*$/);

  // '/sw', alone or after a time: an action, filtered by the brewer
  match = /^\s*(?:\d+:\d\d\s+)?(\/[\w-]*)$/.exec(before);
  if (match) return result(match[1]!, actionOptions(brewerType(state)), /^\/[\w-]*$/);

  // 'grind me'
  match = /^\s*grind\s+([\w-]*)$/.exec(before);
  if (match) return result(match[1]!, GRIND_OPTIONS, /^[\w-]*$/);

  // A unit right after a number, once a letter is typed ('94c' -> '°C'): which ones depends on the line
  match = /(~?)\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?([a-z°]*)$/i.exec(before);
  if (match) {
    const [, tilde, unit = ""] = match;
    if (!unit && !context.explicit) return null;

    let options: Completion[];
    if (tilde) {
      options = DURATION;
    } else if (/^\s*@/.test(before)) {
      // Header: the dose comes first, then the water or the temperature
      const written = before.match(/\d[\d.\-]*[a-z°]+/gi)?.length ?? 0;
      options = written - (unit ? 1 : 0) === 0 ? DOSE : [...WATER, ...TEMP];
    } else if (/^\s*(?:\d+:\d\d\s|\+)/.test(before)) {
      // A time or a '+' makes it a pour: a temperature line has neither
      options = WATER;
    } else {
      options = [...WATER, ...TEMP];
    }

    return result(unit, options, /^[a-z°]*$/i);
  }

  // A word after a pour amount: its qualifiers, without the ones already there
  const pour = /^\s*(?:\d+:\d\d\s+)?\+?\d[\d.\-]*(?:g|ml|oz|floz)\b(.*?)([a-z]*)$/i.exec(before);
  if (pour) {
    const written = (pour[1] ?? "").split(/\s+/);
    const hasTechnique = written.some((word) => TECHNIQUES.includes(word));
    const options = QUALIFIERS.filter(
      (q) => !written.includes(q) && !(hasTechnique && TECHNIQUES.includes(q)),
    ).map((q): Completion => ({ label: q, detail: TECHNIQUES.includes(q) ? "technique" : "qualifier", type: "keyword" }));

    const word = pour[2] ?? "";
    if (!word && !context.explicit) return null;
    return result(word, options, /^[a-z]*$/i);
  }

  // A word at the start of a line, before any header or step keyword
  match = /^\s*([a-z]*)$/.exec(before);
  if (match && (match[1] || context.explicit)) return result(match[1]!, KEYWORD_OPTIONS, /^[a-z]*$/);

  return null;
}

/** The completion source as language data, so basicSetup's autocompletion picks it up. */
export const brewAutocomplete = State.languageData.of(() => [{ autocomplete: brewCompletions }]);
