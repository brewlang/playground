/// <reference types="node" />
import { readFileSync } from "node:fs";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

/// llms.txt describes the language, so it lives in the brewlang repo next to this one: served in dev, emitted at build
function llmsTxt(): Plugin {
  const read = () => readFileSync(new URL("../brewlang/docs/llms.txt", import.meta.url), "utf8");
  return {
    name: "brewlang-llms-txt",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== "/llms.txt") return next();
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(read());
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "llms.txt", source: read() });
    },
  };
}

export default defineConfig(({ command, isPreview }) => ({
  // GitHub Pages serves the site at brewlang.github.io/playground/; the dev server stays at the root
  base: command === "build" || isPreview ? "/playground/" : "/",
  // The examples and llms.txt are read from the brewlang repo next to this one
  server: { fs: { allow: [".."] } },
  plugins: [llmsTxt()],
}));
