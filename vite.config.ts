import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Dev Container 内から VS Code のポート転送で開けるようにする
  server: { host: true, port: 5173 },
});
