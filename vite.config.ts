import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  base: "./",
  plugins: [react()],
  // ESM workers allow subsequent dynamic chunks (the PDF library) to be
  // fetched only when the user exports a report (RNF-8).
  worker: { format: "es" },
  build: {
    outDir: path.join(__dirname, "dist", "web"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/test/**/*.test.{js,ts,tsx}"],
  },
});
