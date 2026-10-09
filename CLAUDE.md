# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A browser playground for Brewlang, the `.brew` coffee recipe language. It is a static Vite + TypeScript site around a CodeMirror 6 editor. All language logic lives in the `brewlang` monorepo next to this repo (`../brewlang`): the language (`packages/brewlang`) and the recipe card (`packages/render`, `@brewlang/render`). The playground only displays what they return.

## Commands

- `npm run dev` — Vite dev server on http://localhost:5173
- `npm run build` — `tsc --noEmit`, then a static build in `dist/`
- `npm run typecheck` — types only
- `npm run preview` — serve `dist/`

There are no tests here: the language behavior is tested in `../brewlang`.

## Dependency on brewlang

- `"brewlang": "file:../brewlang/packages/brewlang"` and `"@brewlang/render": "file:../brewlang/packages/render"` make symlinks to the sibling repo's packages. Imports resolve through their `exports` to `dist/`, not `src/`, so run `npm run build` at the root of `../brewlang` after changing it.
- The examples are not part of the package: `src/main.ts` reads `../../brewlang/examples/*.brew` with `import.meta.glob` (`?raw`, eager). `server.fs.allow: [".."]` in `vite.config.ts` lets the dev server reach them.
- Need something from the language (a type, a helper)? Export it from `../brewlang/src/index.ts` rather than reimplementing it here. Example: `Token` and `TokenKind` were exported for the highlighter.

## Deployment

`.github/workflows/deploy.yml` builds the `brewlang` monorepo (both packages, `npm run build` at its root) then the playground side by side, as locally, and publishes `dist/` on GitHub Pages at `/playground/` (hence `base` in `vite.config.ts`, for builds and `vite preview`).

## Analytics

Cloudflare Web Analytics counts visits, without cookies: its script is at the end of `index.html`, with the same token as brewlang.github.io, so both show in one Cloudflare dashboard.

## Architecture

The layout follows the "Playground App" design (claude.ai/design): code and problems on the left, the recipe card on the right; below 860px, Code/Recipe tabs with the actions in a bottom bar and the menus as sheets.

- `src/main.ts` — creates the editor and recomputes everything on each change (`refresh()`): `check()` once, then the problems list and the recipe pane. The dose, the scale buttons (½× to 2×) and the units (weight g or oz, the water following with ml or fl oz when it is a volume; temperature °C or °F) only change what the card shows: the source keeps the author's units and amounts. The card is `render()` from `@brewlang/render` (check → scale → convert → card), so scaling and units need a valid recipe; with errors, the card shows the parsed recipe as is under an error note.
- The card is `@brewlang/render`: `render(source, { factor, weight, temp, title })` returns its HTML (escaped), the model and the scaling notes; `brew.css` is imported from the package, and `src/style.css` maps the playground's theme onto its `--brew-*` variables. Change the card itself in `../brewlang/packages/render`, not here.
- `src/highlight.ts` — colors words from brewlang's `lex()`: tokens without a gap between them form one word (`150g`, `~15s`, `90-93°C`), colored by role. There is no separate grammar.
- `src/marks.ts` — the worst diagnostic of each line colors its number with a dot (`gutterLineClass`), and an error tints the line.
- `src/lint.ts` — a CodeMirror `linter` over brewlang's `check()` for the wavy underlines and tooltips. `range()` turns a 1-based `line`/`column` into offsets; the problems list reuses it to jump to a diagnostic.
- `src/complete.ts` — the completion source: `@` → brewers, `/` → actions allowed for the header's brewer type, `grind ` → sizes, after a pour → qualifiers, after a number + a letter → units (`94c` → `°C`). All lists are imported from brewlang.
- `src/share.ts` — the `#src=` link (base64url UTF-8), the `.brew` download (`downloadText`) and the PNG export (`html-to-image`): `toHtml(model, { signed: true })` is rendered off screen in `#export` at 1080px wide (sizes in `style.css`, under `.export`), then scaled down to fit 1080 × 1350 when taller.
- `src/customize.ts` — the card's style: a theme (`auto` follows the playground; `paper`, `night`, `roaster` set every `--brew-*` color), an accent (a swatch or any `#rrggbb`) and a title font. `applyStyle()` sets the variables inline on the rendered card and on the exported image; `css()` is what "Copy CSS" gives a developer. The style is saved, and carried by the shared link as short parameters after `src` (`#src=…&t=roaster&a=cobalt&f=sans`); unknown values fall back to the default.
- `llms.txt` — the format for AI assistants; "Copy prompt for your AI" points to it. It lives in `../brewlang/docs/llms.txt`, next to the language it describes: a small plugin in `vite.config.ts` serves it in dev and emits it at the root of the build. Change it there, not here.
- A `.brew` file opens from the Examples menu (`#open-file`) or by dropping it anywhere (document-level drag events, files only); `load()` resets the scale and units like an example. The initial document comes from the URL hash (`src`, plus the card style), then `localStorage`, then the Chemex example. The theme is the system's until the reader picks one (`data-theme` on `<html>`, saved). Every storage access is wrapped in try/catch.
- `src/style.css` — the design's tokens on `:root` (oklch), redefined for dark under `prefers-color-scheme` and `[data-theme="dark"]`. Fonts: Newsreader, Instrument Sans, IBM Plex Mono (Google Fonts).

## Conventions

Same as `../brewlang`: strict TS with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`, `import type` for types (`verbatimModuleSyntax`), 2-space indent, `///` comments on internal members and `/** */` on exported ones, UI text in English. Commit messages are in English, Conventional Commits style (`feat: …`, `fix: …`). Imports between local files have no extension (`moduleResolution: bundler`).
