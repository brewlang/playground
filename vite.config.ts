import { defineConfig } from "vite";

export default defineConfig({
  // The examples are read from the brewlang repo next to this one
  server: { fs: { allow: [".."] } },
});
