import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" makes the build work from any URL path,
// including https://<user>.github.io/<repo>/
export default defineConfig({
  plugins: [react()],
  base: "./",
});
