import type { Diagnostic as LintDiagnostic } from "@codemirror/lint";
import { linter } from "@codemirror/lint";
import type { Text } from "@codemirror/state";
import type { Diagnostic } from "brewlang";
import { check } from "brewlang";

/// Where a brewlang diagnostic starts, and the word it points at
export function range(doc: Text, { line, column }: Diagnostic): { from: number; to: number } {
  const { from: start, to: end, text } = doc.line(Math.min(Math.max(line, 1), doc.lines));
  const offset = Math.min(column - 1, text.length);
  const word = /\S+/y;
  word.lastIndex = offset;
  const match = word.exec(text);

  return { from: start + offset, to: match ? start + offset + match[0].length : end };
}

/** Underlines every diagnostic of brewlang's check; suggestions show as info. */
export const brewLint = linter(
  (view): LintDiagnostic[] =>
    check(view.state.doc.toString()).diagnostics.map((d) => ({
      ...range(view.state.doc, d),
      severity: d.severity === "suggestion" ? "info" : d.severity,
      message: d.message,
    })),
  { delay: 150 },
);
