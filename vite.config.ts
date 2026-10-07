import { defineConfig } from "vite";

export default defineConfig(({ command, isPreview }) => ({
  // GitHub Pages serves the site at brewlang.github.io/playground/; the dev server stays at the root
  base: command === "build" || isPreview ? "/playground/" : "/",
  // The examples are read from the brewlang repo next to this one
  server: { fs: { allow: [".."] } },
}));
