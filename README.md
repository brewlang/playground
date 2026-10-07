# Brewlang playground

Try [Brewlang](../brewlang) in the browser: write a `.brew` recipe and see its diagnostics as you type, format it, and scale it to a new dose or total water.

- **Live checks:** every error, warning and suggestion from `check`, underlined in the editor and listed under it. Click one to jump to it.
- **Completion** for brewers (`@`), actions allowed with the brewer (`/`), grind sizes, pour qualifiers and units (type `94c` for `°C`). Ctrl+Space opens it anywhere.
- **Highlighting** from the brewlang lexer itself, so it never drifts from the language.
- **Recipe card:** the recipe as a reader follows it, with its dose, water, temperature, ratio, preparation and timed steps.
- **Dose, scale and units** (g or oz, °C or °F) change only what the card shows: the source keeps the author's amounts and units.
- **Share:** a link that carries the recipe itself, or a 1080 × 1350 image of the card.
- **Copy prompt for your AI:** asks an assistant to write a recipe in Brewlang, pointing it to [`llms.txt`](public/llms.txt).
- **Light and dark themes**, and a layout with tabs on phones.
- **Examples** come from `../brewlang/examples`.

## Development

The playground uses the brewlang repo next to it (`file:../brewlang`), built:

```sh
(cd ../brewlang && npm run build)
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck, then a static site in dist/
```

Rebuild brewlang after changing it: the playground reads its `dist/`.

## Deployment

Every push to `master` publishes the site on GitHub Pages, at https://brewlang.github.io/playground/ (`.github/workflows/deploy.yml`). The workflow checks out `brewlang/brewlang` next to the playground, as in development.
