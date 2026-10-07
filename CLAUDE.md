# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A browser playground for Brewlang, the `.brew` coffee recipe language. It is a static Vite + TypeScript site around a CodeMirror 6 editor. All language logic lives in the `brewlang` library next to this repo (`../brewlang`); the playground only displays what it returns.

## Commands

- `npm run dev` — Vite dev server on http://localhost:5173
- `npm run build` — `tsc --noEmit`, then a static build in `dist/`
- `npm run typecheck` — types only
- `npm run preview` — serve `dist/`

There are no tests here: the language behavior is tested in `../brewlang`.

## Dependency on brewlang

- `"brewlang": "file:../brewlang"` makes `node_modules/brewlang` a symlink to the sibling repo. Imports resolve through its `exports` to `dist/`, not `src/`, so run `npm run build` in `../brewlang` after changing it.
- The examples are not part of the package: `src/main.ts` reads `../../brewlang/examples/*.brew` with `import.meta.glob` (`?raw`, eager). `server.fs.allow: [".."]` in `vite.config.ts` lets the dev server reach them.
- Need something from the language (a type, a helper)? Export it from `../brewlang/src/index.ts` rather than reimplementing it here. Example: `Token` and `TokenKind` were exported for the highlighter.

## Deployment

`.github/workflows/deploy.yml` builds `brewlang` then the playground side by side, as locally, and publishes `dist/` on GitHub Pages at `/playground/` (hence `base` in `vite.config.ts`, for builds only).

## Architecture

- `src/highlight.ts` — a `ViewPlugin` that runs brewlang's `lex()` on every change and marks each token with a `tok-*` CSS class. There is no separate grammar: the colors follow the lexer.
- `src/complete.ts` — the completion source, plugged in as `languageData` so `basicSetup`'s autocompletion uses it. Context comes from regexes on the text before the cursor: `@` → brewers, `/` → actions allowed for the header's brewer type (aliases included), `grind ` → sizes, after a pour → qualifiers (one technique max), after a number + a letter → units for that position (`94c` → `°C`). All lists are imported from brewlang (`BREWERS`, `ACTIONS`, `GRIND_SIZES`, `QUALIFIERS`, `*_UNITS`).
- `src/lint.ts` — a CodeMirror `linter` over brewlang's `check()`. Suggestions map to CodeMirror's `info` severity. `range()` turns a 1-based `line`/`column` into document offsets, extending to the end of the word at that position; the side panel reuses it to jump to a diagnostic.
- `src/main.ts` — creates the editor and recomputes everything on each change (`refresh()`): `check()` once, then the recipe summary, the diagnostics list and the scale panel. Formatting and scaling are disabled while the recipe has errors, since `format` and `scale*` need a valid recipe. The ratio is shown only when dose and water use the same unit (Brewlang never converts).
- The initial document comes from the URL hash (`#src=` + base64url UTF-8, written by "Copy link"), then `localStorage`, then the Chemex example. Every storage access is wrapped in try/catch so the page works without it.
- `src/style.css` — CSS variables on `:root`, redefined under `prefers-color-scheme: dark`; the editor and token colors use them. One column below 860px.

## Conventions

Same as `../brewlang`: strict TS with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`, `import type` for types (`verbatimModuleSyntax`), 2-space indent, `///` comments on internal members and `/** */` on exported ones, UI text in English. Commit messages are in English, Conventional Commits style (`feat: …`, `fix: …`). Imports between local files have no extension (`moduleResolution: bundler`).
