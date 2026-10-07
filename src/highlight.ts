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

/// Color every word; lines and columns are 1-based, CodeMirror positions are offsets
function decorate(view: EditorView): DecorationSet {
  const { doc } = view.state;
  const builder = new RangeSetBuilder<Decoration>();
  const offset = (t: Token) => doc.line(t.line).from + t.column - 1;

  const tokens = lex(doc.toString()).tokens.filter((t) => t.text && t.kind !== "NEWLINE" && t.line <= doc.lines);
  let i = 0;

  while (i < tokens.length) {
    const first = tokens[i]!;

    // The metadata block: '---' lines, then 'key: value'
    if (first.kind === "FRONTMATTER") {
      let from = offset(first);
      for (const line of first.text.split("\n")) {
        const key = /^([\w-]+)(:)/.exec(line);
        if (/^---\s*$/.test(line)) builder.add(from, from + 3, MARKS.punct!);
        else if (key) {
          builder.add(from, from + key[1]!.length, MARKS.fmkey!);
          if (line.length > key[0].length) builder.add(from + key[0].length, from + line.length, MARKS.fmval!);
        } else if (line.trim()) builder.add(from, from + line.length, MARKS.fmval!);
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
    if (name) builder.add(offset(first), Math.min(end, doc.length), MARKS[name]!);
    i += word.length;
  }

  return builder.finish();
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
