import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq, isNull } from "drizzle-orm";
import { pg } from "@ap-pos/db";
import { DatabaseService } from "../db/database.service";
import {
  normalizeBranchPromptPayId,
  normalizeBranchPromptPayName,
  normalizeDiscordWebhookUrl,
  type BranchRecord,
  type UpsertBranchDto,
} from "./branch.types";

function now() {
  return new Date();
}

function parseDiscordWebhookInput(
  raw: string | null | undefined,
): string | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  const normalized = normalizeDiscordWebhookUrl(trimmed);
  if (!normalized) {
    throw new BadRequestException(
      "Discord webhook ต้องเป็น URL รูปแบบ https://discord.com/api/webhooks/...",
    );
  }
  return normalized;
}

function toRecord(row: typeof pg.branches.$inferSelect): BranchRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    active: Boolean(row.active),
    promptPayId: normalizeBranchPromptPayId(row.promptPayId),
    promptPayName: normalizeBranchPromptPayName(row.promptPayName),
    discordWebhookUrl: normalizeDiscordWebhookUrl(row.discordWebhookUrl),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class BranchesService {
  constructor(private readonly database: DatabaseService) {}

  async list(opts: { activeOnly?: boolean } = {}) {
    const rows = await this.database.db
      .select()
      .from(pg.branches)
      .where(isNull(pg.branches.deletedAt))
      .orderBy(asc(pg.branches.code));
    const list = rows.map(toRecord);
    return {
      branches: opts.activeOnly ? list.filter((b) => b.active) : list,
    };
  }

  async nextCode() {
    const rows = await this.database.db
      .select({ code: pg.branches.code })
      .from(pg.branches);
    let max = 0;
    for (const row of rows) {
      const m = /^(\d+)$/.exec((row.code ?? "").trim());
      if (!m) continue;
      const n = Number(m[1]);
      if (n > max) max = n;
    }
    return { code: String(max + 1).padStart(3, "0") };
  }

  async get(id: string) {
    const rows = await this.database.db
      .select()
      .from(pg.branches)
      .where(and(eq(pg.branches.id, id), isNull(pg.branches.deletedAt)))
      .limit(1);
    if (!rows[0]) throw new NotFoundException("Branch not found");
    return toRecord(rows[0]);
  }

  async create(dto: UpsertBranchDto) {
    if (!dto.name?.trim()) throw new BadRequestException("กรุณาระบุชื่อสาขา");
    const code = (dto.code?.trim() || (await this.nextCode()).code).padStart(
      3,
      "0",
    );
    const existing = await this.database.db
      .select({ id: pg.branches.id })
      .from(pg.branches)
      .where(eq(pg.branches.code, code))
      .limit(1);
    if (existing[0]) throw new BadRequestException("รหัสสาขาซ้ำ");

    const id = `branch-${code}`;
    const ts = now();
    await this.database.db.insert(pg.branches).values({
      id,
      code,
      name: dto.name.trim(),
      active: dto.active === false ? 0 : 1,
      promptPayId: normalizeBranchPromptPayId(dto.promptPayId),
      promptPayName: normalizeBranchPromptPayName(dto.promptPayName),
      discordWebhookUrl: parseDiscordWebhookInput(dto.discordWebhookUrl),
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
    });
    return this.get(id);
  }

  async update(id: string, dto: Partial<UpsertBranchDto>) {
    const current = await this.get(id);
    const code = dto.code?.trim() ?? current.code;
    if (code !== current.code) {
      const clash = await this.database.db
        .select({ id: pg.branches.id })
        .from(pg.branches)
        .where(eq(pg.branches.code, code))
        .limit(1);
      if (clash[0] && clash[0].id !== id) {
        throw new BadRequestException("รหัสสาขาซ้ำ");
      }
    }
    await this.database.db
      .update(pg.branches)
      .set({
        code,
        name: dto.name?.trim() ?? current.name,
        active:
          dto.active == null ? (current.active ? 1 : 0) : dto.active ? 1 : 0,
        promptPayId:
          dto.promptPayId === undefined
            ? current.promptPayId
            : normalizeBranchPromptPayId(dto.promptPayId),
        promptPayName:
          dto.promptPayName === undefined
            ? current.promptPayName
            : normalizeBranchPromptPayName(dto.promptPayName),
        discordWebhookUrl:
          dto.discordWebhookUrl === undefined
            ? current.discordWebhookUrl
            : parseDiscordWebhookInput(dto.discordWebhookUrl),
        updatedAt: now(),
      })
      .where(eq(pg.branches.id, id));
    return this.get(id);
  }

  async remove(id: string) {
    const current = await this.get(id);
    if (current.id === "branch-001" || current.code === "001") {
      throw new BadRequestException("ห้ามลบสาขาหลัก");
    }
    await this.database.db
      .update(pg.branches)
      .set({ deletedAt: now(), updatedAt: now(), active: 0 })
      .where(eq(pg.branches.id, id));
    return current;
  }
}
