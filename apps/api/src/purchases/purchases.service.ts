import {
  Injectable,
  BadRequestException,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { pg } from "@ap-pos/db";
import { DatabaseService } from "../db/database.service";
import { NotifyService } from "../notify/notify.service";
import {
  formatPurchaseLine,
  normalizePurchaseKey,
  parsePurchaseText,
  purchaseKeysCompatible,
  PURCHASE_DAY_STATUSES,
  PURCHASE_DEFAULT_GROUP,
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
  { name: "หมึกกรอบ", group: "meatball", aliases: "หมึกกรอบ|หมึกกรอบสำรอง" },
  { name: "แมงกะพรุน", group: "meatball", aliases: "แมงกะพรุน|แมงกะพรุนสำรอง" },
  { name: "ปูอัดชีส", group: "meatball" },
  { name: "อังคณา", group: "meatball", aliases: "อังคณาสุกี้|อังคนะ|อังคนา|อังคณา" },
  { name: "เด้งใหญ่", group: "meatball", aliases: "เด้งใหญ่|ใหย่|เด้งใหย่|เดงใหญ่" },
  { name: "เด้งเล็ก", group: "meatball", aliases: "เด้งเล็ก|เดงเล็ก" },
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
  { name: "น่องไก่", group: "market", aliases: "น่องไก่|สะโพกไก่|น่องสะโพก" },
  { name: "เห็ดหูหนูขาว", group: "market" },
  { name: "เส้นเล็กสีเขียว", group: "market", aliases: "เส้นมันม่วง|เส้นเล็กสีเขียว" },
  { name: "ชีสดิป", group: "market" },
  { name: "ถุงร้อน 6*9", group: "market", aliases: "ถุงร้อน6*9|ถุงร้อน6x9" },
  { name: "ถุงร้อน 7*11", group: "market", aliases: "ถุงร้อน7*11|ถุงร้อน7x11" },
  { name: "ถุงหิ้ว 9*18", group: "market", aliases: "ถุงหิ้ว9*18|ถุงหิว9*18|ถุงหิ้ว9x18|ถึงหิว9*18|ถึงหิว9x18" },
  { name: "ถ้วย 4oz", group: "market", aliases: "ถ้วย4oz|4oz" },
  { name: "ถ้วยใส่ชีสยืด", group: "market", aliases: "ถ้วยชีสยืด|ถ้วยใส่ชีส" },
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
  // ส่งสาขา (เดิมส่งหลุมดิน)
  { name: "ชีสยืด", group: "transfer", aliases: "มอสซาเรลล่า|ชีสยืด" },
  { name: "ปลาดอลลี่", group: "transfer", aliases: "ดอลลี่" },
  { name: "หมึกวง", group: "transfer" },
  { name: "หมูสับ", group: "transfer" },
  { name: "ตับ", group: "transfer" },
  { name: "เนื้อหมูสไลด์", group: "transfer", aliases: "หมูสไลด์|เนื้อหมูสไลด์" },
  { name: "หมูหั่น", group: "transfer", aliases: "หมูหั่น" },
  { name: "สะโพกหมู", group: "transfer", aliases: "สะโพกหมู|สะโพกหมูสำรอง" },
  { name: "ซี่โครง", group: "transfer", aliases: "ซี่โครง|ซี่โครงหมู|ชี่โครง|ซี่โครงสำรอง" },
  { name: "คอหมูย่าง", group: "transfer", aliases: "คอหมูย่าง|คอหมู|คอหมูย่างสำรอง" },
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

/** พักกลางเลิกใช้แล้ว — ของเก่า/ไม่รู้จัก → ร้านในตลาด */
function resolvePurchaseGroup(groupKey?: string | null): string {
  if (!groupKey || groupKey === "pending") return PURCHASE_DEFAULT_GROUP;
  if (PURCHASE_GROUPS.some((g) => g.key === groupKey)) return groupKey;
  return PURCHASE_DEFAULT_GROUP;
}

@Injectable()
export class PurchasesService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly notify: NotifyService,
  ) {}

  async onModuleInit() {
    await this.ensureSeed();
    await this.ensureCatalogFixes();
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

  /** แก้แคตตาล็อกที่มีอยู่แล้ว — กัน map ชื่อผิดซ้ำ */
  private async ensureCatalogFixes() {
    // เอา alias หมูหั่น ออกจากเนื้อหมูสไลด์
    const sliced = await this.database.db
      .select()
      .from(pg.purchaseCatalog)
      .where(
        and(
          eq(pg.purchaseCatalog.name, "เนื้อหมูสไลด์"),
          isNull(pg.purchaseCatalog.deletedAt),
        ),
      )
      .limit(1);
    if (sliced[0]) {
      const nextAliases = sliced[0].aliases
        .split("|")
        .map((s) => s.trim())
        .filter((s) => s && s !== "หมูหั่น" && normalizePurchaseKey(s) !== "หมูหั่น")
        .join("|");
      if (nextAliases !== sliced[0].aliases) {
        await this.database.db
          .update(pg.purchaseCatalog)
          .set({
            aliases: nextAliases || "หมูสไลด์|เนื้อหมูสไลด์",
            updatedAt: now(),
          })
          .where(eq(pg.purchaseCatalog.id, sliced[0].id));
      }
    }

    const upserts: SeedItem[] = [
      { name: "หมูหั่น", group: "transfer", aliases: "หมูหั่น" },
      {
        name: "ถ้วยใส่ชีสยืด",
        group: "market",
        aliases: "ถ้วยชีสยืด|ถ้วยใส่ชีส",
      },
      { name: "เด้งเล็ก", group: "meatball", aliases: "เด้งเล็ก|เดงเล็ก" },
      {
        name: "ถุงหิ้ว 9*18",
        group: "market",
        aliases: "ถุงหิ้ว9*18|ถุงหิว9*18|ถุงหิ้ว9x18|ถึงหิว9*18",
      },
      {
        name: "น่องไก่",
        group: "market",
        aliases: "น่องไก่|สะโพกไก่|น่องสะโพก",
      },
      {
        name: "สะโพกหมู",
        group: "transfer",
        aliases: "สะโพกหมู|สะโพกหมูสำรอง",
      },
      {
        name: "หมึกกรอบ",
        group: "meatball",
        aliases: "หมึกกรอบ|หมึกกรอบสำรอง",
      },
      {
        name: "ซี่โครง",
        group: "transfer",
        aliases: "ซี่โครง|ซี่โครงหมู|ชี่โครง|ซี่โครงสำรอง",
      },
      {
        name: "คอหมูย่าง",
        group: "transfer",
        aliases: "คอหมูย่าง|คอหมู|คอหมูย่างสำรอง",
      },
    ];
    for (const item of upserts) {
      const hit = await this.database.db
        .select()
        .from(pg.purchaseCatalog)
        .where(eq(pg.purchaseCatalog.name, item.name))
        .limit(1);
      if (hit[0]) {
        // ถูกลบเองแล้ว — ไม่สร้างใหม่ / ไม่คืนชีพ
        if (hit[0].deletedAt) continue;
        await this.database.db
          .update(pg.purchaseCatalog)
          .set({
            // ไม่ทับ groupKey ที่ผู้ใช้ย้ายเอง
            aliases: item.aliases ?? hit[0].aliases,
            active: 1,
            updatedAt: now(),
          })
          .where(eq(pg.purchaseCatalog.id, hit[0].id));
      } else {
        await this.database.db.insert(pg.purchaseCatalog).values({
          id: `pcat-${randomUUID().slice(0, 8)}`,
          name: item.name,
          aliases: item.aliases ?? "",
          groupKey: item.group,
          unit: null,
          sortOrder: 500,
          active: 1,
          updatedAt: now(),
          deletedAt: null,
        });
      }
    }

    // สะโพกไก่ = น่องไก่ → ปิดรายการซ้ำ แล้วชี้ alias ไปที่น่องไก่
    const thigh = await this.database.db
      .select()
      .from(pg.purchaseCatalog)
      .where(
        and(
          eq(pg.purchaseCatalog.name, "สะโพกไก่"),
          isNull(pg.purchaseCatalog.deletedAt),
        ),
      )
      .limit(1);
    if (thigh[0]) {
      await this.database.db
        .update(pg.purchaseCatalog)
        .set({ deletedAt: now(), active: 0, updatedAt: now() })
        .where(eq(pg.purchaseCatalog.id, thigh[0].id));
      const drum = await this.database.db
        .select()
        .from(pg.purchaseCatalog)
        .where(
          and(
            eq(pg.purchaseCatalog.name, "น่องไก่"),
            isNull(pg.purchaseCatalog.deletedAt),
          ),
        )
        .limit(1);
      if (drum[0]) {
        const aliases = new Set(
          [...drum[0].aliases.split("|"), "น่องไก่", "สะโพกไก่", "น่องสะโพก"]
            .map((s) => s.trim())
            .filter(Boolean),
        );
        await this.database.db
          .update(pg.purchaseCatalog)
          .set({
            aliases: [...aliases].join("|"),
            active: 1,
            updatedAt: now(),
          })
          .where(eq(pg.purchaseCatalog.id, drum[0].id));
      }
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

  async deleteCatalog(id: string) {
    const rows = await this.database.db
      .select()
      .from(pg.purchaseCatalog)
      .where(
        and(eq(pg.purchaseCatalog.id, id), isNull(pg.purchaseCatalog.deletedAt)),
      )
      .limit(1);
    if (!rows[0]) throw new NotFoundException("ไม่พบรายการ");
    await this.database.db
      .update(pg.purchaseCatalog)
      .set({ deletedAt: now(), active: 0, updatedAt: now() })
      .where(eq(pg.purchaseCatalog.id, id));
    return { ok: true, id };
  }

  async deleteCatalogMany(ids: string[]) {
    const unique = [
      ...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean)),
    ];
    if (!unique.length) throw new BadRequestException("เลือกรายการก่อน");
    await this.database.db
      .update(pg.purchaseCatalog)
      .set({ deletedAt: now(), active: 0, updatedAt: now() })
      .where(
        and(
          inArray(pg.purchaseCatalog.id, unique),
          isNull(pg.purchaseCatalog.deletedAt),
        ),
      );
    return { ok: true, deleted: unique.length };
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
        groupKey: resolvePurchaseGroup(r.groupKey),
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
    const trimmed = dto.name.trim();
    if (dto.id) {
      await this.database.db
        .update(pg.purchaseCatalog)
        .set({
          name: trimmed,
          aliases: dto.aliases ?? "",
          groupKey: resolvePurchaseGroup(dto.groupKey),
          unit: dto.unit ?? null,
          sortOrder: dto.sortOrder ?? 0,
          active: dto.active === false ? 0 : 1,
          updatedAt: now(),
        })
        .where(eq(pg.purchaseCatalog.id, dto.id));
      const { items } = await this.listCatalog();
      return items.find((x) => x.id === dto.id)!;
    }

    // ไม่ส่ง id → รวมกับชื่อเดิม หรือสร้างใหม่ (เฉพาะจากหน้าตั้งค่าแคตตาล็อก)
    if (!trimmed) throw new BadRequestException("ใส่ชื่อสินค้า");
    const groupKey = resolvePurchaseGroup(dto.groupKey);
    let id = await this.pinCatalogGroup(trimmed, groupKey, null);
    if (!id) {
      id = `pcat-${randomUUID().slice(0, 8)}`;
      await this.database.db.insert(pg.purchaseCatalog).values({
        id,
        name: trimmed,
        aliases: dto.aliases ?? trimmed,
        groupKey,
        unit: dto.unit ?? null,
        sortOrder: dto.sortOrder ?? 900,
        active: dto.active === false ? 0 : 1,
        updatedAt: now(),
        deletedAt: null,
      });
    } else if (
      dto.aliases != null ||
      dto.unit !== undefined ||
      dto.sortOrder != null
    ) {
      await this.database.db
        .update(pg.purchaseCatalog)
        .set({
          aliases: dto.aliases ?? trimmed,
          unit: dto.unit ?? null,
          sortOrder: dto.sortOrder ?? 900,
          updatedAt: now(),
        })
        .where(eq(pg.purchaseCatalog.id, id));
    }
    const { items } = await this.listCatalog();
    return items.find((x) => x.id === id)!;
  }

  private async matchCatalog(
    name: string,
    catalogItems?: Array<{
      id: string;
      name: string;
      aliases: string;
      groupKey: string;
      active: boolean;
    }>,
  ) {
    const items = catalogItems ?? (await this.listCatalog()).items;
    const tryNames = [name];
    // สะโพกหมู สำรอง / คอมโบ หมด → ลอง match ชื่อหลักด้วย
    const spare = name.match(/^(.*?)\s*สำรอง\s*$/u);
    if (spare?.[1]?.trim() && spare[1].trim().length >= 2) {
      tryNames.push(spare[1].trim());
    }
    const empty = name.match(/^(.*?)\s*หมด\s*$/u);
    if (empty?.[1]?.trim() && empty[1].trim().length >= 2) {
      tryNames.push(empty[1].trim());
    }

    const activeItems = items.filter((item) => {
      if (!item.active) return false;
      // ไม่ match กับแคตตาล็อกที่ชื่อเป็น「xxx สำรอง/หมด」เอง — ให้ไปรายการหลัก
      if (/\s*(สำรอง|หมด)\s*$/u.test(item.name.trim())) return false;
      return true;
    });

    // รอบ 1: ชื่อหลักตรงก่อน — กัน「น่องไก่」โดน alias ของ「นสไก่」(สะโพกไก่→น่องไก่)
    for (const tryName of tryNames) {
      const key = normalizePurchaseKey(tryName);
      if (!key) continue;
      for (const item of activeItems) {
        if (normalizePurchaseKey(item.name) === key) return item;
      }
    }

    // รอบ 2: aliases
    for (const tryName of tryNames) {
      const key = normalizePurchaseKey(tryName);
      if (!key) continue;
      for (const item of activeItems) {
        for (const alias of item.aliases.split("|").filter(Boolean)) {
          if (/\s*(สำรอง|หมด)\s*$/u.test(alias.trim())) continue;
          if (normalizePurchaseKey(alias) === key) return item;
        }
      }
    }
    return null;
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
    /** มือถือส่งรายการยาว — ไม่ต้องประกอบ board ทั้งก้อน */
    skipBoard?: boolean;
  }) {
    const day = await this.getOrCreateDay(opts.day);
    const parsed = parsePurchaseText(opts.rawText);
    const stamp = now();

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

    // อ่านข้อความเก่าก่อนทับ — ใช้แยกรายการจาก paste กับที่เพิ่มเองบนแผง
    const oldPasteKeys = new Set(
      parsePurchaseText(rawRows[0]?.rawText ?? "")
        .map((l) => normalizePurchaseKey(l.name))
        .filter(Boolean),
    );
    const newPasteKeys = new Set(
      parsed.map((l) => normalizePurchaseKey(l.name)).filter(Boolean),
    );

    if (rawRows[0]) {
      await this.database.db
        .update(pg.purchaseRaw)
        .set({
          rawText: opts.rawText,
          branchLabel: opts.branchLabel ?? rawRows[0].branchLabel,
          updatedAt: stamp,
        })
        .where(eq(pg.purchaseRaw.id, rawRows[0].id));
    } else {
      await this.database.db.insert(pg.purchaseRaw).values({
        id: `praw-${randomUUID().slice(0, 8)}`,
        dayId: day.id,
        branchId: opts.branchId,
        branchLabel: opts.branchLabel ?? null,
        rawText: opts.rawText,
        updatedAt: stamp,
      });
    }

    // จำคอลัมน์ที่ย้ายไว้ในวันนี้ — กันจัดเข้าแผงใหม่แล้วเด้งกลับ
    const prevLines = await this.database.db
      .select({
        name: pg.purchaseLines.name,
        groupKey: pg.purchaseLines.groupKey,
      })
      .from(pg.purchaseLines)
      .where(
        and(
          eq(pg.purchaseLines.dayId, day.id),
          isNull(pg.purchaseLines.deletedAt),
        ),
      );
    const prevGroupByKey = new Map<string, string>();
    for (const row of prevLines) {
      const k = normalizePurchaseKey(row.name);
      if (k && !prevGroupByKey.has(k)) prevGroupByKey.set(k, row.groupKey);
    }

    const old = await this.database.db
      .select()
      .from(pg.purchaseLines)
      .where(
        and(
          eq(pg.purchaseLines.dayId, day.id),
          eq(pg.purchaseLines.branchId, opts.branchId),
          isNull(pg.purchaseLines.deletedAt),
        ),
      );

    const lineMatchesPasteKey = (
      lineName: string,
      pasteKeys: Set<string>,
    ) => {
      const k = normalizePurchaseKey(lineName);
      if (k && pasteKeys.has(k)) return true;
      for (const pk of pasteKeys) {
        if (purchaseKeysCompatible(lineName, pk) !== "none") return true;
      }
      return false;
    };

    // รายการที่เพิ่มเองบนแผง (ไม่อยู่ในข้อความ paste เก่า) — คงไว้ถ้า paste ใหม่ก็ไม่มี
    const manualsToKeep = new Set(
      old
        .filter(
          (row) =>
            !lineMatchesPasteKey(row.name, oldPasteKeys) &&
            !lineMatchesPasteKey(row.name, newPasteKeys),
        )
        .map((row) => row.id),
    );

    const toDelete = old
      .filter((row) => !manualsToKeep.has(row.id))
      .map((row) => row.id);
    if (toDelete.length) {
      await this.database.db
        .update(pg.purchaseLines)
        .set({ deletedAt: stamp, updatedAt: stamp })
        .where(inArray(pg.purchaseLines.id, toDelete));
    }

    // โหลดแคตตาล็อกครั้งเดียว — รายการยาว (50+) เคยช้าเพราะ query ทุกรายการ
    const { items: catalogItems } = await this.listCatalog();
    const insertRows = [];
    let i = 0;
    for (const line of parsed) {
      i += 1;
      const cat = await this.matchCatalog(line.name, catalogItems);
      const storedName = cat?.name ?? line.name;
      const nameKey = normalizePurchaseKey(storedName);
      const pasteKey = normalizePurchaseKey(line.name);
      // ลำดับ: คอลัมน์ที่เคยย้ายวันนี้ → แคตตาล็อก → ร้านในตลาด
      const groupKey = resolvePurchaseGroup(
        (nameKey && prevGroupByKey.get(nameKey)) ||
          (pasteKey && prevGroupByKey.get(pasteKey)) ||
          (cat?.groupKey as string) ||
          PURCHASE_DEFAULT_GROUP,
      );
      insertRows.push({
        id: `pline-${randomUUID().slice(0, 10)}`,
        dayId: day.id,
        branchId: opts.branchId,
        catalogId: cat?.id ?? null,
        name: storedName,
        qtyText: line.qtyText,
        note: line.note,
        groupKey,
        matched: cat ? 1 : 0,
        sortOrder: i,
        updatedAt: stamp,
        deletedAt: null,
      });
    }
    if (insertRows.length) {
      await this.database.db.insert(pg.purchaseLines).values(insertRows);
    }

    if (opts.skipBoard) {
      return { day: { id: day.id, day: day.day } };
    }
    // คืนรายการที่เพิ่มเอง — ไม่ soft-delete ไว้แล้วด้านบน
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
    let nextCatalogId =
      dto.catalogId === undefined ? cur.catalogId : dto.catalogId;

    // ย้ายคอลัมน์ → จำกลุ่มลงแคตตาล็อก (ไม่มีชื่อนี้จะสร้างใหม่)
    const nextGroup = resolvePurchaseGroup(dto.groupKey ?? cur.groupKey);
    if (dto.groupKey && nextGroup !== resolvePurchaseGroup(cur.groupKey)) {
      nextCatalogId = await this.pinCatalogGroup(
        dto.name?.trim() || cur.name,
        nextGroup,
        nextCatalogId,
      );
    }

    await this.database.db
      .update(pg.purchaseLines)
      .set({
        name: dto.name?.trim() ?? cur.name,
        qtyText: dto.qtyText === undefined ? cur.qtyText : dto.qtyText,
        note: dto.note === undefined ? cur.note : dto.note,
        groupKey: nextGroup,
        catalogId: nextCatalogId,
        matched: nextCatalogId ? 1 : cur.matched,
        updatedAt: now(),
      })
      .where(eq(pg.purchaseLines.id, id));

    return this.board(cur.dayId);
  }

  /**
   * จำกลุ่มร้านลงแคตตาล็อก — มีอยู่แล้วอัปเดตกลุ่ม
   * ยังไม่มี → สร้างใหม่ (เช่น ย้ายจากพักกลางไปแผงร้าน)
   */
  private async pinCatalogGroup(
    name: string,
    groupKey: string,
    catalogId?: string | null,
  ) {
    const trimmed = name.trim();
    if (!trimmed) return catalogId ?? null;
    const pinnedGroup = resolvePurchaseGroup(groupKey);

    if (catalogId) {
      await this.database.db
        .update(pg.purchaseCatalog)
        .set({
          groupKey: pinnedGroup,
          updatedAt: now(),
          active: 1,
          deletedAt: null,
        })
        .where(eq(pg.purchaseCatalog.id, catalogId));
      return catalogId;
    }

    const key = normalizePurchaseKey(trimmed);
    const rows = await this.database.db.select().from(pg.purchaseCatalog);
    const byKey = (r: (typeof rows)[number]) =>
      normalizePurchaseKey(r.name) === key ||
      r.aliases
        .split("|")
        .some((a) => a.trim() && normalizePurchaseKey(a) === key);

    const activeHit = rows.find((r) => !r.deletedAt && byKey(r));
    if (activeHit) {
      await this.database.db
        .update(pg.purchaseCatalog)
        .set({ groupKey: pinnedGroup, updatedAt: now(), active: 1 })
        .where(eq(pg.purchaseCatalog.id, activeHit.id));
      return activeHit.id;
    }

    const deletedHit = rows.find((r) => r.deletedAt && byKey(r));
    if (deletedHit) {
      await this.database.db
        .update(pg.purchaseCatalog)
        .set({
          groupKey: pinnedGroup,
          name: trimmed,
          active: 1,
          deletedAt: null,
          updatedAt: now(),
        })
        .where(eq(pg.purchaseCatalog.id, deletedHit.id));
      return deletedHit.id;
    }

    const id = `pcat-${randomUUID().slice(0, 8)}`;
    await this.database.db.insert(pg.purchaseCatalog).values({
      id,
      name: trimmed,
      aliases: trimmed,
      groupKey: pinnedGroup,
      unit: null,
      sortOrder: 900,
      active: 1,
      updatedAt: now(),
      deletedAt: null,
    });
    return id;
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
   * - forceCreate + qty ว่าง → สร้างแถวว่างบนแผง (เพิ่มชื่อเอง)
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
    /** สร้างแถวบนแผงแม้ยังไม่มีจำนวน */
    forceCreate?: boolean;
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

    const wantGroup = resolvePurchaseGroup(dto.groupKey);
    let existing =
      (dto.lineId
        ? lines.find((l) => l.id === dto.lineId)
        : undefined) ??
      lines.find(
        (l) =>
          resolvePurchaseGroup(l.groupKey) === wantGroup &&
          normalizePurchaseKey(l.name) === nameKey,
      );

    if (!qty) {
      if (existing) {
        if (dto.forceCreate) {
          // มีแถวแล้ว + ไม่ใส่จำนวน = คงไว้บนแผง
          return this.board(dayId);
        }
        // กัน race: rename แล้ว blur จำนวนด้วยชื่อเก่า + draft ว่าง → อย่าลบ
        if (
          dto.lineId &&
          name &&
          normalizePurchaseKey(existing.name) !== nameKey
        ) {
          return this.board(dayId);
        }
        const hadQty = Boolean(
          (existing.qtyText ?? "").trim() || (existing.note ?? "").trim(),
        );
        // แถวที่เพิ่มชื่ออย่างเดียว (ยังไม่มีจำนวน) — ห้ามลบตอน blur/Enter ช่องว่าง
        if (!hadQty) {
          return this.board(dayId);
        }
        await this.database.db
          .update(pg.purchaseLines)
          .set({ deletedAt: now(), updatedAt: now() })
          .where(eq(pg.purchaseLines.id, existing.id));
        return this.board(dayId);
      }
      if (!dto.forceCreate) {
        return this.board(dayId);
      }
      // สร้างแถวว่างบนแผงวันนี้
      if (!name) throw new BadRequestException("ใส่ชื่อสินค้า");
      const emptyGroup = wantGroup;
      const pinnedCatalogId = await this.pinCatalogGroup(
        name,
        emptyGroup,
        dto.catalogId ?? null,
      );
      const catalogId = pinnedCatalogId ?? dto.catalogId ?? null;
      await this.database.db.insert(pg.purchaseLines).values({
        id: `pline-${randomUUID().slice(0, 10)}`,
        dayId,
        branchId: dto.branchId,
        catalogId,
        name,
        qtyText: null,
        note: null,
        groupKey: emptyGroup,
        matched: catalogId ? 1 : 0,
        sortOrder: 900 + lines.length,
        updatedAt: now(),
        deletedAt: null,
      });
      return this.board(dayId);
    }

    // เพิ่ม/แก้บนแผง → จำกลุ่มลงแคตตาล็อก
    if (!name) throw new BadRequestException("ใส่ชื่อสินค้า");
    const lineGroup = resolvePurchaseGroup(dto.groupKey);
    const pinnedCatalogId = await this.pinCatalogGroup(
      name,
      lineGroup,
      dto.catalogId ?? existing?.catalogId ?? null,
    );
    const catalogId =
      pinnedCatalogId ?? dto.catalogId ?? existing?.catalogId ?? null;

    if (existing) {
      await this.database.db
        .update(pg.purchaseLines)
        .set({
          qtyText: qty,
          note: null,
          name,
          groupKey: lineGroup,
          catalogId,
          matched: catalogId ? 1 : 0,
          updatedAt: now(),
        })
        .where(eq(pg.purchaseLines.id, existing.id));
      return this.board(dayId);
    }

    await this.database.db.insert(pg.purchaseLines).values({
      id: `pline-${randomUUID().slice(0, 10)}`,
      dayId,
      branchId: dto.branchId,
      catalogId,
      name,
      qtyText: qty,
      note: null,
      groupKey: lineGroup,
      matched: catalogId ? 1 : 0,
      sortOrder: 900 + lines.length,
      updatedAt: now(),
      deletedAt: null,
    });
    return this.board(dayId);
  }

  /** ล้างแผงทั้งวัน — รายการ + ข้อความที่วาง (เตรียมวางใหม่) */
  async clearBoardDay(dto: { dayId?: string; day?: string }) {
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
    const stamp = now();
    await this.database.db
      .update(pg.purchaseLines)
      .set({ deletedAt: stamp, updatedAt: stamp })
      .where(
        and(eq(pg.purchaseLines.dayId, dayId), isNull(pg.purchaseLines.deletedAt)),
      );
    await this.database.db
      .update(pg.purchaseRaw)
      .set({ rawText: "", updatedAt: stamp })
      .where(eq(pg.purchaseRaw.dayId, dayId));

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
      const groupKey = resolvePurchaseGroup(line.groupKey);
      const key = `${groupKey}::${normalizePurchaseKey(line.name)}`;
      let item = map.get(key);
      if (!item) {
        item = {
          key,
          name: line.name,
          groupKey,
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
      // เรียงสาขา: หลุมดิน → เจ็ดเสมียน → บ้านฆ้อง → อื่นๆ
      item.byBranch.sort((a, b) => {
        const rank = (n: string) =>
          /หลุมดิน/.test(n)
            ? 0
            : /เจ็ดเสมียน/.test(n)
              ? 1
              : /บ้านฆ้อง|ฆ้อง/.test(n)
                ? 2
                : 3;
        const d = rank(a.branchName) - rank(b.branchName);
        return d !== 0 ? d : a.branchName.localeCompare(b.branchName, "th");
      });

      const short = (n: string) => {
        if (/หลุมดิน/.test(n)) return "หลุมดิน";
        if (/เจ็ดเสมียน/.test(n)) return "เจ็ดเสมียน";
        if (/บ้านฆ้อง|ฆ้อง/.test(n)) return "บ้านฆ้อง";
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

  /** สาขาที่ใช้งาน — สำหรับหน้าสั่งของมือถือ */
  async orderBranches() {
    const rows = await this.database.db
      .select({
        id: pg.branches.id,
        code: pg.branches.code,
        name: pg.branches.name,
      })
      .from(pg.branches)
      .where(and(eq(pg.branches.active, 1), isNull(pg.branches.deletedAt)))
      .orderBy(asc(pg.branches.code));
    return { day: todayBangkok(), branches: rows };
  }

  /**
   * รายการแนะนำให้กรอกคงเหลือ
   * = ของที่สาขานี้เคยส่ง 7 วัน + แคตตาล็อกที่ active
   */
  async orderItemSuggestions(branchId: string) {
    if (!branchId) throw new BadRequestException("ระบุสาขา");
    const since = new Date();
    since.setDate(since.getDate() - 7);
    const sinceDay = since.toLocaleDateString("en-CA", {
      timeZone: "Asia/Bangkok",
    });

    const recent = await this.database.db
      .select({
        name: pg.purchaseLines.name,
        catalogId: pg.purchaseLines.catalogId,
        groupKey: pg.purchaseLines.groupKey,
        qtyText: pg.purchaseLines.qtyText,
        note: pg.purchaseLines.note,
        day: pg.purchaseDays.day,
      })
      .from(pg.purchaseLines)
      .innerJoin(
        pg.purchaseDays,
        eq(pg.purchaseLines.dayId, pg.purchaseDays.id),
      )
      .where(
        and(
          eq(pg.purchaseLines.branchId, branchId),
          isNull(pg.purchaseLines.deletedAt),
          gte(pg.purchaseDays.day, sinceDay),
        ),
      )
      .orderBy(desc(pg.purchaseDays.day));

    const { items: catalog } = await this.listCatalog();
    const catById = new Map(catalog.map((c) => [c.id, c]));
    const catByKey = new Map(
      catalog.map((c) => [normalizePurchaseKey(c.name), c]),
    );

    type Suggest = {
      key: string;
      name: string;
      catalogId: string | null;
      groupKey: string;
      aliases: string;
      recent: boolean;
      lastRemaining: string | null;
    };
    const map = new Map<string, Suggest>();

    for (const row of recent) {
      const cat =
        (row.catalogId && catById.get(row.catalogId)) ||
        catByKey.get(normalizePurchaseKey(row.name));
      const name = cat?.name ?? row.name;
      const key = normalizePurchaseKey(name);
      if (!key || map.has(key)) continue;
      const remaining =
        (row.qtyText || row.note || "").trim().replace(/^มี\s*/u, "") || null;
      map.set(key, {
        key,
        name,
        catalogId: cat?.id ?? row.catalogId ?? null,
        groupKey: resolvePurchaseGroup(
          cat?.groupKey ?? row.groupKey ?? PURCHASE_DEFAULT_GROUP,
        ),
        aliases: cat?.aliases ?? "",
        recent: true,
        lastRemaining: remaining,
      });
    }

    for (const cat of catalog) {
      if (!cat.active) continue;
      const key = normalizePurchaseKey(cat.name);
      if (!key || map.has(key)) continue;
      map.set(key, {
        key,
        name: cat.name,
        catalogId: cat.id,
        groupKey: resolvePurchaseGroup(cat.groupKey),
        aliases: cat.aliases,
        recent: false,
        lastRemaining: null,
      });
    }

    const groupOrder = new Map<string, number>(
      PURCHASE_GROUPS.map((g, i) => [g.key, i]),
    );
    const items = [...map.values()].sort((a, b) => {
      if (a.recent !== b.recent) return a.recent ? -1 : 1;
      const ga = groupOrder.get(a.groupKey) ?? 99;
      const gb = groupOrder.get(b.groupKey) ?? 99;
      if (ga !== gb) return ga - gb;
      return a.name.localeCompare(b.name, "th");
    });

    return {
      day: todayBangkok(),
      branchId,
      groups: PURCHASE_GROUPS,
      items,
    };
  }

  /** สถานะที่สาขาส่งวันนี้แล้วหรือยัง */
  async orderDraft(branchId: string, day?: string) {
    if (!branchId) throw new BadRequestException("ระบุสาขา");
    const d = await this.getOrCreateDay(day);
    const raw = (
      await this.database.db
        .select()
        .from(pg.purchaseRaw)
        .where(
          and(
            eq(pg.purchaseRaw.dayId, d.id),
            eq(pg.purchaseRaw.branchId, branchId),
          ),
        )
        .limit(1)
    )[0];
    const lines = await this.database.db
      .select()
      .from(pg.purchaseLines)
      .where(
        and(
          eq(pg.purchaseLines.dayId, d.id),
          eq(pg.purchaseLines.branchId, branchId),
          isNull(pg.purchaseLines.deletedAt),
        ),
      )
      .orderBy(asc(pg.purchaseLines.sortOrder));
    return {
      day: d.day,
      dayId: d.id,
      status: d.status,
      submitted: Boolean(raw?.rawText?.trim()),
      rawText: raw?.rawText ?? "",
      items: lines.map((l) => ({
        name: l.name,
        catalogId: l.catalogId,
        groupKey: l.groupKey,
        qtyText: l.qtyText,
        note: l.note,
      })),
      /** draft มือถือที่ยังไม่กดส่ง — แชร์ตามสาขา+วันนี้ ไม่แจ้งเตือน */
      mobileDraft: this.parseMobileDraft(raw?.draftJson ?? null, d.day),
    };
  }

  private parseMobileDraft(raw: string | null, expectDay?: string) {
    if (!raw?.trim()) return null;
    try {
      const parsed = JSON.parse(raw) as {
        savedAt?: number;
        day?: string;
        staffName?: string | null;
        lines?: Array<{
          id?: string;
          name?: string;
          catalogId?: string | null;
          groupKey?: string;
          mode?: string;
          remaining?: string;
        }>;
      };
      // กัน JSON เก่าที่ปนวันผิด (ถ้ามีฟิลด์ day)
      if (
        expectDay &&
        parsed.day &&
        parsed.day !== expectDay
      ) {
        return null;
      }
      if (!Array.isArray(parsed.lines) || !parsed.lines.length) return null;
      const lines = parsed.lines
        .map((l, i) => {
          const name = String(l?.name ?? "").trim();
          if (!name) return null;
          const mode = ["remain", "spare", "empty", "order"].includes(
            String(l?.mode ?? ""),
          )
            ? String(l.mode)
            : "remain";
          return {
            id: String(l?.id ?? `line-${i}-${name}`),
            name,
            catalogId: l?.catalogId ?? null,
            groupKey: String(l?.groupKey ?? "market"),
            mode,
            remaining: String(l?.remaining ?? ""),
          };
        })
        .filter(Boolean) as Array<{
        id: string;
        name: string;
        catalogId: string | null;
        groupKey: string;
        mode: string;
        remaining: string;
      }>;
      if (!lines.length) return null;
      return {
        savedAt: Number(parsed.savedAt) || 0,
        staffName: parsed.staffName?.trim() || null,
        lines,
      };
    } catch {
      return null;
    }
  }

  /**
   * เซฟ draft มือถือเงียบๆ ตามสาขา+วัน — ไม่ ingest / ไม่แจ้งเตือน
   * รับเฉพาะวันนี้ (Asia/Bangkok) — ไม่เขียนข้ามวัน
   */
  async saveMobileDraft(opts: {
    branchId: string;
    day?: string;
    staffName?: string;
    lines: Array<{
      id?: string;
      name: string;
      catalogId?: string | null;
      groupKey?: string;
      mode?: string;
      remaining?: string;
    }>;
  }) {
    if (!opts.branchId) throw new BadRequestException("ระบุสาขา");
    const branch = (
      await this.database.db
        .select()
        .from(pg.branches)
        .where(
          and(
            eq(pg.branches.id, opts.branchId),
            isNull(pg.branches.deletedAt),
          ),
        )
        .limit(1)
    )[0];
    if (!branch) throw new NotFoundException("ไม่พบสาขา");

    const today = todayBangkok();
    const requested = String(opts.day ?? "").trim();
    if (requested && !/^\d{4}-\d{2}-\d{2}$/.test(requested)) {
      throw new BadRequestException("วันไม่ถูกต้อง");
    }
    if (requested && requested !== today) {
      throw new BadRequestException("draft ใช้ได้เฉพาะวันนี้");
    }

    const cleaned = (opts.lines ?? [])
      .map((l, i) => {
        const name = String(l?.name ?? "").trim();
        if (!name) return null;
        const mode = ["remain", "spare", "empty", "order"].includes(
          String(l?.mode ?? ""),
        )
          ? String(l.mode)
          : "remain";
        return {
          id: String(l?.id ?? `line-${i}-${name}`),
          name,
          catalogId: l?.catalogId ?? null,
          groupKey: String(l?.groupKey ?? "market"),
          mode,
          remaining: String(l?.remaining ?? ""),
        };
      })
      .filter(Boolean);

    const d = await this.getOrCreateDay(today);
    const stamp = now();
    const savedAt = Date.now();
    const draftJson =
      cleaned.length === 0
        ? null
        : JSON.stringify({
            savedAt,
            day: today,
            staffName: opts.staffName?.trim() || null,
            lines: cleaned,
          });

    const rawRows = await this.database.db
      .select()
      .from(pg.purchaseRaw)
      .where(
        and(
          eq(pg.purchaseRaw.dayId, d.id),
          eq(pg.purchaseRaw.branchId, opts.branchId),
        ),
      )
      .limit(1);

    if (rawRows[0]) {
      await this.database.db
        .update(pg.purchaseRaw)
        .set({
          draftJson,
          draftUpdatedAt: draftJson ? stamp : null,
          updatedAt: stamp,
        })
        .where(eq(pg.purchaseRaw.id, rawRows[0].id));
    } else {
      await this.database.db.insert(pg.purchaseRaw).values({
        id: `praw-${randomUUID().slice(0, 8)}`,
        dayId: d.id,
        branchId: opts.branchId,
        branchLabel: branch.name,
        rawText: "",
        draftJson,
        draftUpdatedAt: draftJson ? stamp : null,
        updatedAt: stamp,
      });
    }

    return {
      ok: true,
      day: d.day,
      savedAt: draftJson ? savedAt : null,
      lineCount: cleaned.length,
    };
  }

  /**
   * น้องส่งคงเหลือจากมือถือ → แปลงเป็นข้อความแบบเดิม แล้ว ingest
   */
  async submitBranchOrder(opts: {
    branchId: string;
    day?: string;
    staffName?: string;
    items: Array<{
      name: string;
      catalogId?: string | null;
      remaining?: number | string | null;
      spare?: boolean;
      empty?: boolean;
      order?: boolean;
      touched?: boolean;
    }>;
  }) {
    if (!opts.branchId) throw new BadRequestException("ระบุสาขา");
    const branch = (
      await this.database.db
        .select()
        .from(pg.branches)
        .where(
          and(
            eq(pg.branches.id, opts.branchId),
            isNull(pg.branches.deletedAt),
          ),
        )
        .limit(1)
    )[0];
    if (!branch) throw new NotFoundException("ไม่พบสาขา");

    const lines: string[] = [];
    for (const item of opts.items) {
      const name = String(item.name ?? "").trim();
      if (!name) continue;
      if (
        !item.touched &&
        item.remaining == null &&
        !item.spare &&
        !item.empty &&
        !item.order
      ) {
        continue;
      }
      const line = formatPurchaseLine({
        name,
        remaining: item.remaining,
        spare: item.spare,
        empty: item.empty,
        order: item.order,
      });
      if (line) lines.push(line);
    }
    if (!lines.length) {
      throw new BadRequestException("ยังไม่ได้กรอกรายการ");
    }
    if (opts.staffName?.trim()) {
      lines.push(`# ส่งโดย ${opts.staffName.trim()}`);
    }

    // ingest เขียนแผงแล้ว — ข้าม board ทั้งก้อน (รายการยาวเคยช้าจนมือถือคิดว่าส่งไม่ติด)
    const board = await this.ingest({
      day: opts.day,
      branchId: opts.branchId,
      branchLabel: branch.name,
      rawText: lines.join("\n"),
      skipBoard: true,
    });
    const dayLabel = opts.day ?? board?.day?.day ?? null;
    const itemCount = lines.filter((l) => !l.startsWith("#")).length;

    // ส่งจริงแล้ว — เคลียร์ draft มือถือของสาขานี้
    try {
      const d = await this.getOrCreateDay(opts.day ?? dayLabel ?? undefined);
      await this.database.db
        .update(pg.purchaseRaw)
        .set({
          draftJson: null,
          draftUpdatedAt: null,
          updatedAt: now(),
        })
        .where(
          and(
            eq(pg.purchaseRaw.dayId, d.id),
            eq(pg.purchaseRaw.branchId, opts.branchId),
          ),
        );
    } catch {
      /* ignore — ส่งสำเร็จแล้ว อย่าให้เคลียร์ draft ทำให้ fail */
    }

    const notifyItems = opts.items.filter((item) => {
      const name = String(item.name ?? "").trim();
      if (!name) return false;
      return Boolean(
        item.touched ||
          item.remaining != null ||
          item.spare ||
          item.empty ||
          item.order,
      );
    });
    void this.notify.notifyPurchaseOrder({
      branchId: opts.branchId,
      branchName: branch.name,
      branchCode: branch.code,
      staffName: opts.staffName,
      day: dayLabel ?? undefined,
      items: notifyItems.map((item) => ({
        name: String(item.name).trim(),
        remaining: item.remaining,
        spare: item.spare,
        empty: item.empty,
        order: item.order,
      })),
    });

    return {
      ok: true,
      itemCount,
      day: dayLabel,
    };
  }
}
