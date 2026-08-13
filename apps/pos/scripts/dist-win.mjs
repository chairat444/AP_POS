/**
 * Build Windows installer พร้อมฝัง icon + รายละเอียดแอปลง .exe
 * (ต้องเปิด signAndEditExecutable — ปิดการค้นหา certificate อัตโนมัติ)
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
process.env.ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES = "true";

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
