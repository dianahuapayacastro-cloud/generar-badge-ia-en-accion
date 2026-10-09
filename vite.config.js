import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  optimizeDeps: {
    // Se pre-empaquetan al arrancar: si Vite las "descubriera" tarde (import dinámico),
    // re-optimizaría las dependencias y la página abierta fallaría con
    // "504 Outdated Optimize Dep" al exportar el PNG.
    include: ["html-to-image", "html2canvas", "qrcode-generator"],
  },
});
