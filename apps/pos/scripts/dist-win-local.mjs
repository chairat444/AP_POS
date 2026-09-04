/**
 * Windows installer — default API = localhost (ทดสอบที่สาขา ไม่ยิง production)
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_API_BASE = "http://localhost:3000";

process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
process.env.ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES = "true";
process.env.VITE_API_BASE = LOCAL_API_BASE;
process.env.VITE_ADMIN_URL = process.env.VITE_ADMIN_URL || "http://127.0.0.1:3100";

console.log(`[dist-win-local] VITE_API_BASE=${LOCAL_API_BASE}`);

function run(cmd, args) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("pnpm", ["build"]);
run("pnpm", [
  "exec",
  "electron-builder",
  "--config",
  "electron-builder.yml",
  "--win",
]);
