import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const host = process.env.TAURI_DEV_HOST;

// Resolve the version from git so dev builds reflect the current code state
// (e.g. "0.1.5-6-g13bda02") instead of the baked-in tauri.conf.json version.
// Only consumed as a display override in dev; production still uses the
// compiled Tauri version via getVersion(). Falls back gracefully when git is
// unavailable (e.g. shallow CI checkout without tags).
function gitDescribe(): string {
  try {
    return execSync("git describe --tags --always --dirty", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim()
      .replace(/^v/, "");
  } catch {
    return "";
  }
}

// @see https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [react()],
  define: {
    __GIT_APP_VERSION__: JSON.stringify(gitDescribe()),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Tauri expects a fixed port and to fail if unavailable.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
