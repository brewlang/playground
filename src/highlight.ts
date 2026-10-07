import { RangeSetBuilder } from "@codemirror/state";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { TokenKind } from "brewlang";
import { lex } from "brewlang";

// One CSS class per token kind; the brewlang lexer is the only grammar, so the colors never drift from it
const CLASSES: Partial<Record<TokenKind, string>> = {
  FRONTMATTER: "tok-meta",
  BREWER: "tok-brewer",
  NUMBER: "tok-number",
  UNIT: "tok-unit",
  TIME: "tok-time",
  ACTION: "tok-action",
  WORD: "tok-word",
  COMMENT: "tok-comment",
  PLUS: "tok-punct",
  TILDE: "tok-punct",
  DASH: "tok-punct",
  ERROR: "tok-error",
};

const MARKS = new Map(
  Object.entries(CLASSES).map(([kind, className]) => [kind, Decoration.mark({ class: className })]),
);

/// Mark every token; lines and columns are 1-based, CodeMirror positions are offsets
function decorate(view: EditorView): DecorationSet {
  const { doc } = view.state;
  const builder = new RangeSetBuilder<Decoration>();

  for (const token of lex(doc.toString()).tokens) {
    const mark = MARKS.get(token.kind);
    if (!mark || !token.text || token.line > doc.lines) continue;

    const from = doc.line(token.line).from + token.column - 1;
    const to = Math.min(from + token.text.length, doc.length);
    if (to > from) builder.add(from, to, mark);
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
