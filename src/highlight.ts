import { RangeSetBuilder } from "@codemirror/state";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { Token } from "brewlang";
import { GRIND_SIZES, QUALIFIERS, lex } from "brewlang";

// The brewlang lexer is the only grammar, so the colors never drift from it. Tokens written
// without a space between them ('150g', '~15s', '90-93°C') form one word, colored by its role

const mark = (name: string) => Decoration.mark({ class: `tok-${name}` });
const MARKS = Object.fromEntries(
  ["brewer", "amount", "temp", "time", "dur", "qual", "action", "kw", "grind", "comment", "punct", "fmkey", "fmval", "error"].map(
    (name) => [name, mark(name)],
  ),
);

/// The role of a word from its tokens: '150g' is an amount, '90°C' a temperature, '~15s' a duration
function role(word: Token[]): string | undefined {
  const [first] = word;
  if (!first) return undefined;
  if (word.some((t) => t.kind === "ERROR")) return "error";

  switch (first.kind) {
    case "BREWER":
      return "brewer";
    case "ACTION":
      return "action";
    case "TIME":
      return "time";
    case "TILDE":
      return "dur";
    case "COMMENT":
      return "comment";
    case "PLUS":
    case "NUMBER":
      return word.some((t) => t.kind === "UNIT" && t.text.startsWith("°")) ? "temp" : "amount";
    case "WORD":
      if (first.text === "grind" || first.text === "target") return "kw";
      if ((QUALIFIERS as readonly string[]).includes(first.text)) return "qual";
      if ((GRIND_SIZES as readonly string[]).includes(first.text)) return "grind";
      return undefined;
    default:
      return undefined;
  }
}

/// A colored range of the source: offsets, and the role that names its 'tok-' class
interface Span {
  from: number;
  to: number;
  role: string;
}

/// Every colored word of a source, in order; lines and columns are 1-based
function spans(source: string): Span[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") starts.push(i + 1);
  const offset = (t: Token) => starts[t.line - 1]! + t.column - 1;
  const out: Span[] = [];
  const add = (from: number, to: number, role: string) => out.push({ from, to: Math.min(to, source.length), role });

  const tokens = lex(source).tokens.filter((t) => t.text && t.kind !== "NEWLINE" && t.line <= starts.length);
  let i = 0;

  while (i < tokens.length) {
    const first = tokens[i]!;

    // The metadata block: '---' lines, then 'key: value'
    if (first.kind === "FRONTMATTER") {
      let from = offset(first);
      for (const line of first.text.split("\n")) {
        const key = /^([\w-]+)(:)/.exec(line);
        if (/^---\s*$/.test(line)) add(from, from + 3, "punct");
        else if (key) {
          add(from, from + key[1]!.length, "fmkey");
          if (line.length > key[0].length) add(from + key[0].length, from + line.length, "fmval");
        } else if (line.trim()) add(from, from + line.length, "fmval");
        from += line.length + 1;
      }
      i++;
      continue;
    }

    // A word: the tokens that follow each other without a gap, a comment always on its own
    const word = [first];
    let end = offset(first) + first.text.length;
    while (first.kind !== "COMMENT" && i + word.length < tokens.length) {
      const next = tokens[i + word.length]!;
      if (next.kind === "COMMENT" || offset(next) !== end) break;
      word.push(next);
      end += next.text.length;
    }

    const name = role(word);
    if (name) add(offset(first), end, name);
    i += word.length;
  }

  return out;
}

/// The editor's decorations, from the spans
function decorate(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to, role } of spans(view.state.doc.toString())) builder.add(from, to, MARKS[role]!);
  return builder.finish();
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A .brew source as HTML, colored like the editor: escaped text and 'tok-' spans. */
export function highlightHtml(source: string): string {
  let html = "";
  let at = 0;
  for (const { from, to, role } of spans(source)) {
    html += escape(source.slice(at, from)) + `<span class="tok-${role}">${escape(source.slice(from, to))}</span>`;
    at = to;
  }
  return html + escape(source.slice(at));
}

/** Colors a .brew document with the brewlang lexer. */
export const brewHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = decorate(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged) this.decorations = decorate(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
