import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  // GitHub Pages serves the site at brewlang.github.io/playground/
  base: command === "build" ? "/playground/" : "/",
  // The examples are read from the brewlang repo next to this one
  server: { fs: { allow: [".."] } },
}));
