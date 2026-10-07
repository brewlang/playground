import type { Extension } from "@codemirror/state";
import { RangeSet, RangeSetBuilder, StateField } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { Decoration, EditorView, GutterMarker, gutterLineClass } from "@codemirror/view";
import type { Severity } from "brewlang";
import { check } from "brewlang";

// The most serious diagnostic of each line colors its number, with a dot; an error also tints the line

const RANK: Record<Severity, number> = { error: 3, warning: 2, suggestion: 1 };

class SeverityMarker extends GutterMarker {
  constructor(readonly severity: Severity) {
    super();
    this.elementClass = `sev-${severity}`;
  }
}

const MARKERS = { error: new SeverityMarker("error"), warning: new SeverityMarker("warning"), suggestion: new SeverityMarker("suggestion") };
const ERROR_LINE = Decoration.line({ class: "cm-errorLine" });

/// The worst severity per line number
function worst(doc: string): Map<number, Severity> {
  const lines = new Map<number, Severity>();
  for (const { line, severity } of check(doc).diagnostics) {
    const current = lines.get(line);
    if (!current || RANK[severity] > RANK[current]) lines.set(line, severity);
  }
  return lines;
}

interface Marks {
  gutter: RangeSet<GutterMarker>;
  lines: DecorationSet;
}

function build(state: EditorView["state"]): Marks {
  const gutter = new RangeSetBuilder<GutterMarker>();
  const lines = new RangeSetBuilder<Decoration>();
  const sorted = [...worst(state.doc.toString())].filter(([n]) => n <= state.doc.lines).sort(([a], [b]) => a - b);

  for (const [n, severity] of sorted) {
    const { from } = state.doc.line(n);
    gutter.add(from, from, MARKERS[severity]);
    if (severity === "error") lines.add(from, from, ERROR_LINE);
  }
  return { gutter: gutter.finish(), lines: lines.finish() };
}

const marks = StateField.define<Marks>({
  create: build,
  update: (value, tr) => (tr.docChanged ? build(tr.state) : value),
  provide: (field) => [
    gutterLineClass.from(field, (m) => m.gutter),
    EditorView.decorations.from(field, (m) => m.lines),
  ],
});

/** Marks the lines that have diagnostics, in the gutter and, for errors, on the line itself. */
export const brewMarks: Extension = marks;
