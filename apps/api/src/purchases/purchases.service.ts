import {
  Injectable,
  BadRequestException,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { and, asc, eq, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { pg } from "@ap-pos/db";
import { DatabaseService } from "../db/database.service";
import {
  normalizePurchaseKey,
  parsePurchaseText,
  PURCHASE_DAY_STATUSES,
  PURCHASE_GROUPS,
  isPurchaseDayStatus,
  type PurchaseDayStatus,
  type PurchaseGroupKey,
} from "./purchase-parse";

type SeedItem = { name: string; group: PurchaseGroupKey; aliases?: string };

const SEED: SeedItem[] = [
  // ลูกชิ้น
  { name: "ปูอัด", group: "meatball", aliases: "ปูอัด|ทาอิจิ" },
  { name: "จานเด็ดหมู", group: "meatball", aliases: "จานเด็ด" },
  { name: "คอมโบ", group: "meatball" },
  { name: "หมึกกรอบ", group: "meatball" },
  { name: "แมงกะพรุน", group: "meatball" },
  { name: "ปูอัดชีส", group: "meatball" },
  { name: "อังคณา", group: "meatball", aliases: "อังคณาสุกี้|อังคนะ|อังคนา|อังคณา" },
  { name: "เด้งใหญ่", group: "meatball", aliases: "เด้งใหญ่|เดงใหญ่" },
  { name: "เด้งล้อ", group: "meatball" },
  { name: "เต้าหู้ไข่", group: "meatball", aliases: "เต้าหู้ไข่หลอด|เต้าหู้ไข่" },
  { name: "เต้าหู้หมู", group: "meatball" },
  { name: "ไก่อร่อย", group: "meatball" },
  { name: "หมูอร่อย", group: "meatball" },
  { name: "กุ้งพันสาหร่าย", group: "meatball" },
  { name: "เบคอน", group: "meatball", aliases: "เบคอล|เบคอน" },
  { name: "กุ้งทั้งตัว", group: "meatball", aliases: "กุ้งแม็กนัม|กุ้งทั้งตัว" },
  { name: "เต้าหู้ชีส", group: "meatball" },
  { name: "เกี๊ยวซ่า", group: "meatball" },
  { name: "ไส้กรอกไก่", group: "meatball", aliases: "ใส้กรอกไก่|ไส้กรอกไก่" },
  { name: "ไส้กรอกหมู", group: "meatball" },
  // ตลาด
  { name: "ข้าวโพดอ่อน", group: "market" },
  { name: "ข้าวโพดฟัก", group: "market" },
  { name: "น่องไก่", group: "market" },
  { name: "สะโพกไก่", group: "market" },
  { name: "เห็ดหูหนูขาว", group: "market" },
  { name: "เส้นเล็กสีเขียว", group: "market", aliases: "เส้นมันม่วง|เส้นเล็กสีเขียว" },
  { name: "ชีสดิป", group: "market" },
  { name: "ถุงร้อน 6*9", group: "market", aliases: "ถุงร้อน6*9|ถุงร้อน6x9" },
  { name: "ถุงร้อน 7*11", group: "market", aliases: "ถุงร้อน7*11|ถุงร้อน7x11" },
  { name: "ถ้วย 4oz", group: "market", aliases: "ถ้วย4oz|4oz" },
  { name: "มะนาว", group: "market" },
  { name: "ฟ้าไทยซอง", group: "market", aliases: "ฟ้าไทย" },
  { name: "ชุบน้ำดำ", group: "market", aliases: "ชุปน้ำดำ|ชุบน้ำดำ" },
  // ผัก
  { name: "ผักบุ้ง", group: "veg" },
  { name: "ผักชีล้อม", group: "veg", aliases: "ชีล้อม|ผักชีล้อม" },
  { name: "แครอท", group: "veg" },
  { name: "เห็ดออรินจิ", group: "veg", aliases: "เห็ดโอริญจิ|ออรินจิ" },
  { name: "ยอแท่ง", group: "veg", aliases: "ยอ|แฮะ" },
  { name: "เห็ดชิเมจิ", group: "veg", aliases: "เห็ดชิมิจิ|ชิเมจิ" },
  { name: "ผักกาด", group: "veg", aliases: "กาดขาว|ผักกาดขาว" },
  { name: "เห็ดเข็มทอง", group: "veg", aliases: "เห็ดเข็ม|เข็มทอง" },
  { name: "ผักชุด", group: "veg" },
  { name: "ผักโอ๊ค", group: "veg", aliases: "โอ๊ค|ผักโฮ" },
  // ร้าน = ส่งหลุมดิน
  { name: "ชีสยืด", group: "transfer", aliases: "มอสซาเรลล่า|ชีสยืด" },
  { name: "ปลาดอลลี่", group: "transfer", aliases: "ดอลลี่" },
  { name: "หมึกวง", group: "transfer" },
  { name: "หมูสับ", group: "transfer" },
  { name: "ตับ", group: "transfer" },
  { name: "เนื้อหมูสไลด์", group: "transfer", aliases: "หมูหั่น|หมูสไลด์" },
  { name: "สะโพกหมู", group: "transfer" },
  { name: "สันคอสไลด์", group: "transfer", aliases: "สันคอ" },
  { name: "สาหร่ายวากาเมะ", group: "transfer", aliases: "ว่ากาเมะ|วากาเมะ|ส่าหร่ายว่ากาเมะ" },
  { name: "น้ำจิ้มแจ่ว", group: "transfer", aliases: "น้ำจิ้มแจ๋ว|แจ่ว" },
  { name: "งาขาว", group: "transfer" },
  { name: "ซอสหอยนางรม", group: "transfer", aliases: "ซอลหอยนางลม|ซอสหอย" },
];

function now() {
  return new Date();
}

function todayBangkok() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

@Injectable()
export class PurchasesService implements OnModuleInit {
  constructor(private readonly database: DatabaseService) {}

  async onModuleInit() {
    await this.ensureSeed();
  }

  private async ensureSeed() {
    const existing = await this.database.db
      .select({ id: pg.purchaseCatalog.id })
      .from(pg.purchaseCatalog)
      .limit(1);
    if (existing.length) return;
    let i = 0;
    for (const item of SEED) {
      i += 1;
      await this.database.db.insert(pg.purchaseCatalog).values({
        id: `pcat-${randomUUID().slice(0, 8)}`,
        name: item.name,
        aliases: item.aliases ?? "",
        groupKey: item.group,
        unit: null,
        sortOrder: i * 10,
        active: 1,
        updatedAt: now(),
        deletedAt: null,
      });
    }
  }

  groups() {
    return { groups: PURCHASE_GROUPS, statuses: PURCHASE_DAY_STATUSES };
  }

  async updateDayStatus(dayOrId: string, status: string) {
    if (!isPurchaseDayStatus(status)) {
      throw new BadRequestException("สถานะไม่ถูกต้อง");
    }
    let rows = await this.database.db
      .select()
      .from(pg.purchaseDays)
      .where(eq(pg.purchaseDays.id, dayOrId))
      .limit(1);
    if (!rows[0]) {
      rows = await this.database.db
        .select()
        .from(pg.purchaseDays)
        .where(eq(pg.purchaseDays.day, dayOrId))
        .limit(1);
    }
    if (!rows[0]) {
      // สร้างวันถ้ายังไม่มี แล้วตั้งสถานะ
      const created = await this.getOrCreateDay(dayOrId);
      await this.database.db
        .update(pg.purchaseDays)
        .set({ status, updatedAt: now() })
        .where(eq(pg.purchaseDays.id, created.id));
      return this.board(created.id);
    }
    await this.database.db
      .update(pg.purchaseDays)
      .set({ status: status as PurchaseDayStatus, updatedAt: now() })
      .where(eq(pg.purchaseDays.id, rows[0].id));
    return this.board(rows[0].id);
  }

  async listCatalog() {
    const rows = await this.database.db
      .select()
      .from(pg.purchaseCatalog)
      .where(isNull(pg.purchaseCatalog.deletedAt))
      .orderBy(asc(pg.purchaseCatalog.sortOrder), asc(pg.purchaseCatalog.name));
    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        aliases: r.aliases,
        groupKey: r.groupKey,
        unit: r.unit,
        sortOrder: r.sortOrder,
        active: Boolean(r.active),
      })),
    };
  }

  async upsertCatalog(dto: {
    id?: string;
    name: string;
    aliases?: string;
    groupKey: string;
    unit?: string | null;
    sortOrder?: number;
    active?: boolean;
  }) {
    const id = dto.id ?? `pcat-${randomUUID().slice(0, 8)}`;
    if (dto.id) {
      await this.database.db
        .update(pg.purchaseCatalog)
        .set({
          name: dto.name.trim(),
          aliases: dto.aliases ?? "",
          groupKey: dto.groupKey,
          unit: dto.unit ?? null,
          sortOrder: dto.sortOrder ?? 0,
          active: dto.active === false ? 0 : 1,
          updatedAt: now(),
        })
        .where(eq(pg.purchaseCatalog.id, id));
    } else {
      await this.database.db.insert(pg.purchaseCatalog).values({
        id,
        name: dto.name.trim(),
        aliases: dto.aliases ?? "",
        groupKey: dto.groupKey,
        unit: dto.unit ?? null,
        sortOrder: dto.sortOrder ?? 999,
        active: 1,
        updatedAt: now(),
        deletedAt: null,
      });
    }
    const { items } = await this.listCatalog();
    return items.find((x) => x.id === id)!;
  }

  private async matchCatalog(name: string) {
    const { items } = await this.listCatalog();
    const key = normalizePurchaseKey(name);
    let best: (typeof items)[0] | null = null;
    let bestScore = 0;
    for (const item of items) {
      if (!item.active) continue;
      const candidates = [item.name, ...item.aliases.split("|").filter(Boolean)];
      for (const c of candidates) {
        const ck = normalizePurchaseKey(c);
        if (!ck) continue;
        if (key === ck) return item;
        if (key.includes(ck) || ck.includes(key)) {
          const score = Math.min(key.length, ck.length);
          if (score > bestScore) {
            bestScore = score;
            best = item;
          }
        }
      }
    }
    return best;
  }

  async getOrCreateDay(day?: string) {
    const d = day || todayBangkok();
    const rows = await this.database.db
      .select()
      .from(pg.purchaseDays)
      .where(eq(pg.purchaseDays.day, d))
      .limit(1);
    if (rows[0]) {
      return {
        id: rows[0].id,
        day: rows[0].day,
        note: rows[0].note,
        status: rows[0].status,
      };
    }
    const id = `pday-${randomUUID().slice(0, 8)}`;
    await this.database.db.insert(pg.purchaseDays).values({
      id,
      day: d,
      note: null,
      status: "open",
      updatedAt: now(),
    });
    return { id, day: d, note: null, status: "open" };
  }

  async listDays() {
    const rows = await this.database.db
      .select()
      .from(pg.purchaseDays)
      .orderBy(asc(pg.purchaseDays.day));
    return {
      days: rows
        .map((r) => ({
          id: r.id,
          day: r.day,
          note: r.note,
          status: r.status,
        }))
        .reverse(),
    };
  }

  /** วางข้อความจากสาขา → parse → แทนที่บรรทัดของสาขานั้นในวันนั้น */
  async ingest(opts: {
    day?: string;
    branchId: string;
    branchLabel?: string;
    rawText: string;
  }) {
    const day = await this.getOrCreateDay(opts.day);
    const parsed = parsePurchaseText(opts.rawText);

    const rawRows = await this.database.db
      .select()
      .from(pg.purchaseRaw)
      .where(
        and(
          eq(pg.purchaseRaw.dayId, day.id),
          eq(pg.purchaseRaw.branchId, opts.branchId),
        ),
      )
      .limit(1);

    if (rawRows[0]) {
      await this.database.db
        .update(pg.purchaseRaw)
        .set({
          rawText: opts.rawText,
          branchLabel: opts.branchLabel ?? rawRows[0].branchLabel,
          updatedAt: now(),
        })
        .where(eq(pg.purchaseRaw.id, rawRows[0].id));
    } else {
      await this.database.db.insert(pg.purchaseRaw).values({
        id: `praw-${randomUUID().slice(0, 8)}`,
        dayId: day.id,
        branchId: opts.branchId,
        branchLabel: opts.branchLabel ?? null,
        rawText: opts.rawText,
        updatedAt: now(),
      });
    }

    // ลบเส้นเก่าของสาขานี้แล้วใส่ใหม่
    const old = await this.database.db
      .select({ id: pg.purchaseLines.id })
      .from(pg.purchaseLines)
      .where(
        and(
          eq(pg.purchaseLines.dayId, day.id),
          eq(pg.purchaseLines.branchId, opts.branchId),
          isNull(pg.purchaseLines.deletedAt),
        ),
      );
    for (const row of old) {
      await this.database.db
        .update(pg.purchaseLines)
        .set({ deletedAt: now(), updatedAt: now() })
        .where(eq(pg.purchaseLines.id, row.id));
    }

    let i = 0;
    for (const line of parsed) {
      i += 1;
      const cat = await this.matchCatalog(line.name);
      await this.database.db.insert(pg.purchaseLines).values({
        id: `pline-${randomUUID().slice(0, 10)}`,
        dayId: day.id,
        branchId: opts.branchId,
        catalogId: cat?.id ?? null,
        name: cat?.name ?? line.name,
        qtyText: line.qtyText,
        note: line.note,
        groupKey: (cat?.groupKey as string) ?? "market",
        matched: cat ? 1 : 0,
        sortOrder: i,
        updatedAt: now(),
        deletedAt: null,
      });
    }

    return this.board(day.id);
  }

  async updateLine(
    id: string,
    dto: {
      name?: string;
      qtyText?: string | null;
      note?: string | null;
      groupKey?: string;
      catalogId?: string | null;
    },
  ) {
    const rows = await this.database.db
      .select()
      .from(pg.purchaseLines)
      .where(and(eq(pg.purchaseLines.id, id), isNull(pg.purchaseLines.deletedAt)))
      .limit(1);
    if (!rows[0]) throw new NotFoundException("ไม่พบรายการ");
    const cur = rows[0];
    await this.database.db
      .update(pg.purchaseLines)
      .set({
        name: dto.name?.trim() ?? cur.name,
        qtyText: dto.qtyText === undefined ? cur.qtyText : dto.qtyText,
        note: dto.note === undefined ? cur.note : dto.note,
        groupKey: dto.groupKey ?? cur.groupKey,
        catalogId:
          dto.catalogId === undefined ? cur.catalogId : dto.catalogId,
        matched: dto.catalogId || dto.groupKey ? 1 : cur.matched,
        updatedAt: now(),
      })
      .where(eq(pg.purchaseLines.id, id));

    // ย้ายคอลัมน์ → อัปเดตแมปชื่อสินค้าด้วย เพื่อครั้งหน้าจัดถูกกลุ่ม
    if (dto.groupKey && cur.catalogId) {
      await this.database.db
        .update(pg.purchaseCatalog)
        .set({ groupKey: dto.groupKey, updatedAt: now() })
        .where(eq(pg.purchaseCatalog.id, cur.catalogId));
    }

    return this.board(cur.dayId);
  }

  async removeLine(id: string) {
    const rows = await this.database.db
      .select()
      .from(pg.purchaseLines)
      .where(and(eq(pg.purchaseLines.id, id), isNull(pg.purchaseLines.deletedAt)))
      .limit(1);
    if (!rows[0]) throw new NotFoundException("ไม่พบรายการ");
    await this.database.db
      .update(pg.purchaseLines)
      .set({ deletedAt: now(), updatedAt: now() })
      .where(eq(pg.purchaseLines.id, id));
    return this.board(rows[0].dayId);
  }

  /**
   * กรอกจำนวนบนแผงสรุปต่อสาขา
   * - มีบรรทัดแล้ว → อัปเดต qty
   * - ยังไม่มี → สร้างใหม่
   * - qty ว่าง → ลบบรรทัดสาขานั้น
   */
  async setBoardQty(dto: {
    day?: string;
    dayId?: string;
    branchId: string;
    name: string;
    groupKey: string;
    catalogId?: string | null;
    lineId?: string | null;
    qtyText?: string | null;
  }) {
    const day = dto.dayId
      ? (
          await this.database.db
            .select()
            .from(pg.purchaseDays)
            .where(eq(pg.purchaseDays.id, dto.dayId))
            .limit(1)
        )[0]
      : await this.getOrCreateDay(dto.day);
    if (!day) throw new NotFoundException("ไม่พบวัน");

    const dayId = day.id;
    const name = dto.name.trim();
    // จำนวนบนแผงรับเฉพาะตัวเลข (ทศนิยมได้)
    const qtyRaw = (dto.qtyText ?? "").trim();
    const qty = qtyRaw.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
    const nameKey = normalizePurchaseKey(name);

    const lines = await this.database.db
      .select()
      .from(pg.purchaseLines)
      .where(
        and(
          eq(pg.purchaseLines.dayId, dayId),
          eq(pg.purchaseLines.branchId, dto.branchId),
          isNull(pg.purchaseLines.deletedAt),
        ),
      );

    let existing =
      (dto.lineId
        ? lines.find((l) => l.id === dto.lineId)
        : undefined) ??
      lines.find(
        (l) =>
          l.groupKey === dto.groupKey &&
          normalizePurchaseKey(l.name) === nameKey,
      );

    if (!qty) {
      if (existing) {
        await this.database.db
          .update(pg.purchaseLines)
          .set({ deletedAt: now(), updatedAt: now() })
          .where(eq(pg.purchaseLines.id, existing.id));
      }
      return this.board(dayId);
    }

    if (existing) {
      await this.database.db
        .update(pg.purchaseLines)
        .set({
          qtyText: qty,
          note: null,
          name,
          groupKey: dto.groupKey,
          catalogId:
            dto.catalogId === undefined
              ? existing.catalogId
              : dto.catalogId,
          matched:
            dto.catalogId || existing.catalogId || existing.matched
              ? 1
              : 0,
          updatedAt: now(),
        })
        .where(eq(pg.purchaseLines.id, existing.id));
      return this.board(dayId);
    }

    const cat =
      dto.catalogId != null
        ? (
            await this.database.db
              .select()
              .from(pg.purchaseCatalog)
              .where(eq(pg.purchaseCatalog.id, dto.catalogId))
              .limit(1)
          )[0]
        : await this.matchCatalog(name);

    await this.database.db.insert(pg.purchaseLines).values({
      id: `pline-${randomUUID().slice(0, 10)}`,
      dayId,
      branchId: dto.branchId,
      catalogId: cat?.id ?? dto.catalogId ?? null,
      name: cat?.name ?? name,
      qtyText: qty,
      note: null,
      groupKey: dto.groupKey,
      matched: cat || dto.catalogId ? 1 : 0,
      sortOrder: 900 + lines.length,
      updatedAt: now(),
      deletedAt: null,
    });
    return this.board(dayId);
  }

  /** ลบสินค้าทั้งรายการออกจากแผงวันนั้น (ทุกสาขา) */
  async removeBoardItem(dto: {
    dayId?: string;
    day?: string;
    name: string;
    groupKey: string;
    lineIds?: string[];
  }) {
    const day = dto.dayId
      ? (
          await this.database.db
            .select()
            .from(pg.purchaseDays)
            .where(eq(pg.purchaseDays.id, dto.dayId))
            .limit(1)
        )[0]
      : await this.getOrCreateDay(dto.day);
    if (!day) throw new NotFoundException("ไม่พบวัน");

    const dayId = day.id;
    const nameKey = normalizePurchaseKey(dto.name.trim());
    const ids = new Set(dto.lineIds ?? []);

    const lines = await this.database.db
      .select()
      .from(pg.purchaseLines)
      .where(
        and(eq(pg.purchaseLines.dayId, dayId), isNull(pg.purchaseLines.deletedAt)),
      );

    const targets = lines.filter(
      (l) =>
        ids.has(l.id) ||
        (l.groupKey === dto.groupKey &&
          normalizePurchaseKey(l.name) === nameKey),
    );

    for (const line of targets) {
      await this.database.db
        .update(pg.purchaseLines)
        .set({ deletedAt: now(), updatedAt: now() })
        .where(eq(pg.purchaseLines.id, line.id));
    }

    return this.board(dayId);
  }

  /** แก้ชื่อสินค้าทั้งแถว (ทุกสาขาวันนั้น) */
  async renameBoardItem(dto: {
    dayId?: string;
    day?: string;
    name: string;
    newName: string;
    groupKey: string;
    lineIds?: string[];
  }) {
    const day = dto.dayId
      ? (
          await this.database.db
            .select()
            .from(pg.purchaseDays)
            .where(eq(pg.purchaseDays.id, dto.dayId))
            .limit(1)
        )[0]
      : await this.getOrCreateDay(dto.day);
    if (!day) throw new NotFoundException("ไม่พบวัน");

    const dayId = day.id;
    const oldKey = normalizePurchaseKey(dto.name.trim());
    const newName = dto.newName.trim();
    if (!newName) throw new BadRequestException("ใส่ชื่อสินค้า");
    const ids = new Set(dto.lineIds ?? []);

    const lines = await this.database.db
      .select()
      .from(pg.purchaseLines)
      .where(
        and(eq(pg.purchaseLines.dayId, dayId), isNull(pg.purchaseLines.deletedAt)),
      );

    const targets = lines.filter(
      (l) =>
        ids.has(l.id) ||
        (l.groupKey === dto.groupKey &&
          normalizePurchaseKey(l.name) === oldKey),
    );

    const cat = await this.matchCatalog(newName);
    for (const line of targets) {
      await this.database.db
        .update(pg.purchaseLines)
        .set({
          name: newName,
          catalogId: cat?.id ?? null,
          matched: cat ? 1 : 0,
          updatedAt: now(),
        })
        .where(eq(pg.purchaseLines.id, line.id));
    }

    return this.board(dayId);
  }

  async board(dayId: string) {
    const dayRows = await this.database.db
      .select()
      .from(pg.purchaseDays)
      .where(eq(pg.purchaseDays.id, dayId))
      .limit(1);
    if (!dayRows[0]) throw new NotFoundException("ไม่พบวัน");

    const lines = await this.database.db
      .select()
      .from(pg.purchaseLines)
      .where(
        and(eq(pg.purchaseLines.dayId, dayId), isNull(pg.purchaseLines.deletedAt)),
      )
      .orderBy(asc(pg.purchaseLines.sortOrder));

    const raws = await this.database.db
      .select()
      .from(pg.purchaseRaw)
      .where(eq(pg.purchaseRaw.dayId, dayId));

    const branches = await this.database.db
      .select()
      .from(pg.branches)
      .where(isNull(pg.branches.deletedAt));
    const branchName = (id: string) =>
      branches.find((b) => b.id === id)?.name ??
      raws.find((r) => r.branchId === id)?.branchLabel ??
      id;

    type BoardItem = {
      key: string;
      name: string;
      groupKey: string;
      catalogId: string | null;
      matched: boolean;
      byBranch: Array<{
        branchId: string;
        branchName: string;
        lineId: string;
        qtyText: string | null;
        note: string | null;
      }>;
      summary: string;
    };

    const map = new Map<string, BoardItem>();
    for (const line of lines) {
      const key = `${line.groupKey}::${normalizePurchaseKey(line.name)}`;
      let item = map.get(key);
      if (!item) {
        item = {
          key,
          name: line.name,
          groupKey: line.groupKey,
          catalogId: line.catalogId,
          matched: Boolean(line.matched),
          byBranch: [],
          summary: "",
        };
        map.set(key, item);
      }
      item.byBranch.push({
        branchId: line.branchId,
        branchName: branchName(line.branchId),
        lineId: line.id,
        qtyText: line.qtyText,
        note: line.note,
      });
    }

    for (const item of map.values()) {
      // เรียงสาขา: หลุมดิน → เจ็ดเสมียน → อื่นๆ
      item.byBranch.sort((a, b) => {
        const rank = (n: string) =>
          /หลุมดิน/.test(n) ? 0 : /เจ็ดเสมียน/.test(n) ? 1 : 2;
        const d = rank(a.branchName) - rank(b.branchName);
        return d !== 0 ? d : a.branchName.localeCompare(b.branchName, "th");
      });

      const short = (n: string) => {
        if (/หลุมดิน/.test(n)) return "หลุมดิน";
        if (/เจ็ดเสมียน/.test(n)) return "เจ็ดเสมียน";
        return n.replace(/^สาขา\s*/u, "").trim() || n;
      };
      const qtyOf = (b: (typeof item.byBranch)[0]) => {
        if (b.qtyText && b.note && b.qtyText !== b.note) {
          return `${b.qtyText} ${b.note}`.trim();
        }
        return (b.qtyText || b.note || "").trim();
      };

      // จำนวน = ยอดที่ต้องซื้อ แยกให้สาขา (เช่น หลุมดิน 4 · เจ็ดเสมียน 2 = ซื้อรวม 6)
      const parts = item.byBranch.map((b) => {
        const q = qtyOf(b);
        return q ? `ให้${short(b.branchName)} ${q}` : `ให้${short(b.branchName)}`;
      });
      const nums = item.byBranch
        .map((b) => {
          const q = qtyOf(b);
          const m = q.match(/^(\d+(?:\.\d+)?)/);
          return m ? Number(m[1]) : null;
        })
        .filter((n): n is number => n != null && Number.isFinite(n));
      if (
        nums.length >= 2 &&
        nums.length === item.byBranch.filter((b) => qtyOf(b)).length
      ) {
        const sum = nums.reduce((a, n) => a + n, 0);
        const t = Number.isInteger(sum)
          ? String(sum)
          : String(Math.round(sum * 100) / 100);
        item.summary = `ซื้อ ${t} · ${parts.join(" · ")}`;
      } else {
        item.summary = parts.join(" · ");
      }
    }

    const columns = PURCHASE_GROUPS.map((g) => ({
      ...g,
      items: [...map.values()]
        .filter((i) => i.groupKey === g.key)
        .sort((a, b) => a.name.localeCompare(b.name, "th")),
    }));

    const unmatched = lines.filter((l) => !l.matched).length;

    return {
      day: {
        id: dayRows[0].id,
        day: dayRows[0].day,
        note: dayRows[0].note,
        status: dayRows[0].status,
      },
      raws: raws.map((r) => ({
        id: r.id,
        branchId: r.branchId,
        branchLabel: r.branchLabel ?? branchName(r.branchId),
        rawText: r.rawText,
      })),
      columns,
      unmatched,
      lineCount: lines.length,
    };
  }

  async boardByDay(day?: string) {
    const d = await this.getOrCreateDay(day);
    return this.board(d.id);
  }
}
