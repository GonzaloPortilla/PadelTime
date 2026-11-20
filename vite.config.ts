import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // PT_STATE_DIR permite usar una base local aislada (la usan las pruebas E2E).
    cloudflare(process.env.PT_STATE_DIR ? { persistState: { path: process.env.PT_STATE_DIR } } : {}),
  ],
  // Pre-optimiza Tesseract.js para que Vite no recargue la página la primera vez que se usa el OCR.
  optimizeDeps: { include: ["tesseract.js"] },
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
