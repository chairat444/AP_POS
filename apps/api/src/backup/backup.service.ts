import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type BackupStatus = {
  ok: boolean;
  at: string | null;
  file: string | null;
  size: string | null;
  path: string | null;
  trigger: string | null;
  running: boolean;
  driveConfigured: boolean;
  scriptPath: string;
};

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private running = false;

  private repoRoot() {
    if (process.env.AP_POS_ROOT) return process.env.AP_POS_ROOT;
    // pm2 cwd = apps/api → monorepo root
    return join(process.cwd(), "..", "..");
  }

  private scriptPath() {
    return join(this.repoRoot(), "scripts/backup/backup-db-gdrive.sh");
  }

  private statusPath() {
    return (
      process.env.BACKUP_STATUS_JSON ||
      join(homedir(), "backups", "last-backup.json")
    );
  }

  private rcloneConfPath() {
    return join(homedir(), ".config", "rclone", "rclone.conf");
  }

  driveConfigured() {
    const conf = this.rcloneConfPath();
    if (!existsSync(conf)) return false;
    try {
      return readFileSync(conf, "utf8").includes("[appos-gdrive]");
    } catch {
      return false;
    }
  }

  status(): BackupStatus {
    const script = this.scriptPath();
    let last: Partial<BackupStatus> = {};
    const statusFile = this.statusPath();
    if (existsSync(statusFile)) {
      try {
        last = JSON.parse(readFileSync(statusFile, "utf8")) as BackupStatus;
      } catch {
        last = {};
      }
    }
    return {
      ok: Boolean(last.ok),
      at: last.at ?? null,
      file: last.file ?? null,
      size: last.size ?? null,
      path: last.path ?? null,
      trigger: last.trigger ?? null,
      running: this.running,
      driveConfigured: this.driveConfigured(),
      scriptPath: script,
    };
  }

  async runManual(triggeredBy: string) {
    if (this.running) {
      throw new ConflictException("กำลังสำรองอยู่แล้ว — รอให้จบก่อน");
    }
    const script = this.scriptPath();
    if (!existsSync(script)) {
      throw new ServiceUnavailableException(`ไม่พบสคริปต์สำรอง: ${script}`);
    }
    if (!this.driveConfigured()) {
      throw new ServiceUnavailableException(
        "ยังไม่ได้เชื่อม Google Drive (rclone remote appos-gdrive) — ตั้งค่าตาม scripts/backup/README.md",
      );
    }

    this.running = true;
    const started = Date.now();
    this.logger.log(`manual backup by ${triggeredBy}`);
    try {
      const env = {
        ...process.env,
        PATH: `${join(homedir(), "bin")}:/usr/local/bin:/usr/bin:/bin:${process.env.PATH ?? ""}`,
        AP_POS_ROOT: this.repoRoot(),
        BACKUP_TRIGGER: `manual:${triggeredBy}`,
        HOME: homedir(),
      };
      await execFileAsync("bash", [script], {
        env,
        timeout: 15 * 60 * 1000,
        maxBuffer: 4 * 1024 * 1024,
      });
      const st = this.status();
      this.logger.log(
        `manual backup ok in ${Date.now() - started}ms file=${st.file}`,
      );
      return {
        ...st,
        ok: true as const,
        running: false,
        elapsedMs: Date.now() - started,
      };
    } catch (e) {
      const err = e as {
        message?: string;
        stderr?: string | Buffer;
        stdout?: string | Buffer;
      };
      let logTail = "";
      try {
        const logFile = join(homedir(), "backups", "backup-gdrive.log");
        if (existsSync(logFile)) {
          const raw = readFileSync(logFile, "utf8");
          logTail = raw.split("\n").slice(-25).join("\n");
        }
      } catch {
        /* ignore */
      }
      const detail = [
        err.message,
        err.stderr?.toString?.(),
        err.stdout?.toString?.(),
        logTail,
      ]
        .filter(Boolean)
        .join("\n")
        .slice(0, 2000);
      this.logger.error(`manual backup failed: ${detail}`);
      throw new ServiceUnavailableException(
        detail || "สำรองไม่สำเร็จ — ดู ~/backups/backup-gdrive.log",
      );
    } finally {
      this.running = false;
    }
  }
}
