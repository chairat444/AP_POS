import { Injectable, Logger } from "@nestjs/common";
import { and, eq, gte, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { pg } from "@ap-pos/db";
import { DatabaseService } from "../db/database.service";

function bangkokTodayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function bangkokDayStart(isoDate: string) {
  return new Date(`${isoDate}T00:00:00.000+07:00`);
}

function bangkokDayEnd(isoDate: string) {
  return new Date(`${isoDate}T23:59:59.999+07:00`);
}

function formatBaht(n: number) {
  return (Number.isFinite(n) ? n : 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatThaiNow() {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

function formatThaiAt(iso: string | null | undefined) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** บาทจำนวนเต็ม (ลิ้นชัก) */
function formatBaht0(n: number) {
  return Math.round(Number.isFinite(n) ? n : 0).toLocaleString("th-TH");
}

function signedBaht0(n: number) {
  const v = Math.round(Number.isFinite(n) ? n : 0);
  const abs = Math.abs(v).toLocaleString("th-TH");
  if (v > 0) return `+${abs}`;
  if (v < 0) return `-${abs}`;
  return "0";
}

function num(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** นับความกว้างแบบอักขระ (รองรับไทย) */
function charLen(s: string) {
  return Array.from(s).length;
}

function truncateChars(s: string, max: number) {
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  if (max <= 1) return "…";
  return chars.slice(0, max - 1).join("") + "…";
}

/**
 * แถวชื่อซ้าย · ยอดขวา ใน code block Discord
 * รองรับยอดใหญ่ (เช่น 1,234,567.00) ด้วยช่องขวากว้างพอ
 */
function discordRow(
  label: string,
  value: string,
  labelW = 18,
  valueW = 14,
): string {
  const lab = truncateChars(label.trim() || "-", labelW);
  const left = lab + " ".repeat(Math.max(0, labelW - charLen(lab)));
  const right = " ".repeat(Math.max(0, valueW - charLen(value))) + value;
  return `${left} ${right}`;
}

function discordBlock(rows: string[]) {
  if (!rows.length) return "";
  return ["```", ...rows, "```"].join("\n");
}

/**
 * รายการท็อป: ตัวเลขคอลัมน์ซ้าย (ชิดขวาในคอลัมน์) · ชื่อต่อท้าย
 * จัดแนวตัวเลขได้จริงบน Discord (ไทยกว้างไม่เท่า space)
 */
function discordQtyNameRow(
  name: string,
  qty: string,
  qtyW = 8,
  nameW = 22,
): string {
  const q = " ".repeat(Math.max(0, qtyW - charLen(qty))) + qty;
  return `${q}  ${truncateChars(name.trim() || "-", nameW)}`;
}

/** สีแถบ embed ตามเรื่อง */
const DISCORD_COLOR = {
  shiftOpen: 0x16a34a, // เขียว
  floatCount: 0x2563eb, // น้ำเงิน
  cashIn: 0x059669, // มรกต
  cashOut: 0xea580c, // ส้ม
  shiftClose: 0x7c3aed, // ม่วง
  shiftCloseShort: 0xdc2626, // แดง (ขาด)
  shiftCloseOver: 0xd97706, // เหลือง (เกิน)
  salesBrief: 0x0f766e, // เขียวน้ำทะเล
} as const;

function embedMeta(parts: Array<string | null | undefined | false>) {
  return parts.filter((p): p is string => Boolean(p && String(p).trim())).join("\n");
}

/** ไม่เกิน 1 ข้อความสั้น / สาขา / นาที */
const BRIEF_THROTTLE_MS = 60_000;

export type SaleNotifyHint = {
  branchId: string;
  branchName?: string;
  branchCode?: string;
  billNo?: string;
  total?: number;
  newCount?: number;
};

export type NotifyMode = "brief" | "full";

type PendingBrief = SaleNotifyHint & { newCount: number };

@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);
  /** ยอดขายสุทธิวันล่าสุดที่เคยแจ้ง (brief) แยกต่อสาขา */
  private lastNotifiedNetByBranch = new Map<string, number>();
  private lastBriefSentAt = new Map<string, number>();
  private pendingBrief = new Map<string, PendingBrief>();

  constructor(private readonly database: DatabaseService) {}

  /**
   * ลำดับหา webhook:
   * 1) branches.discord_webhook_url
   * 2) DISCORD_WEBHOOK_URL_<CODE>
   * 3) DISCORD_WEBHOOK_URL
   */
  private async resolveWebhook(opts: {
    branchId?: string | null;
    branchCode?: string | null;
  }) {
    const branchId = (opts.branchId ?? "").trim();
    if (branchId) {
      const rows = await this.database.db
        .select({ url: pg.branches.discordWebhookUrl, code: pg.branches.code })
        .from(pg.branches)
        .where(eq(pg.branches.id, branchId))
        .limit(1);
      const fromDb = rows[0]?.url?.trim();
      if (fromDb) return fromDb;
      if (!opts.branchCode && rows[0]?.code) {
        opts = { ...opts, branchCode: rows[0].code };
      }
    }
    const code = (opts.branchCode ?? "").trim().toUpperCase();
    if (code) {
      const keyed =
        process.env[`DISCORD_WEBHOOK_URL_${code}`]?.trim() ||
        process.env[`DISCORD_WEBHOOK_${code}`]?.trim();
      if (keyed) return keyed;
    }
    return process.env.DISCORD_WEBHOOK_URL?.trim() || "";
  }

  async sendDiscord(
    message: string,
    opts?: {
      branchId?: string | null;
      branchCode?: string | null;
      /** Discord embed — แยกการ์ดอ่านง่ายกว่าข้อความติดกัน */
      embeds?: Array<{
        title?: string;
        description?: string;
        color?: number;
        fields?: Array<{ name: string; value: string; inline?: boolean }>;
        footer?: { text: string };
      }>;
    },
  ): Promise<{ ok: boolean; skipped?: boolean; status?: number; error?: string }> {
    const webhook = await this.resolveWebhook(opts ?? {});
    if (!webhook) {
      this.logger.debug(`[discord:skip] ${message.slice(0, 120)}`);
      return { ok: false, skipped: true, error: "ไม่มี webhook ของสาขานี้" };
    }
    const content =
      message.length > 1900 ? `${message.slice(0, 1890)}\n…` : message;
    const body: Record<string, unknown> = {};
    if (opts?.embeds?.length) {
      body.embeds = opts.embeds.slice(0, 10);
      // ถ้ามี embed แล้วไม่จำเป็นต้องมี content — เว้นว่างได้
      if (content.trim()) body.content = content;
    } else {
      body.content = content;
    }
    try {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const resBody = await res.text().catch(() => "");
        this.logger.warn(
          `Discord webhook failed ${res.status}: ${resBody.slice(0, 200)}`,
        );
        return {
          ok: false,
          status: res.status,
          error: resBody.slice(0, 200) || `HTTP ${res.status}`,
        };
      }
      return { ok: true, status: res.status };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Discord webhook error: ${error}`);
      return { ok: false, error };
    }
  }

  async sendLine(message: string) {
    const token = process.env.LINE_NOTIFY_TOKEN;
    if (!token) {
      this.logger.debug(`[line:skip] ${message}`);
      return;
    }
    this.logger.log(`[line] ${message}`);
  }

  /** ทดสอบ webhook ของสาขาจาก Admin */
  async testBranchWebhook(branchId: string) {
    const branch = await this.database.db
      .select()
      .from(pg.branches)
      .where(eq(pg.branches.id, branchId))
      .limit(1);
    const row = branch[0];
    if (!row || row.deletedAt) {
      return { ok: false as const, error: "ไม่พบสาขา" };
    }
    const msg = [
      `ทดสอบ Discord · สาขา ${row.name} (${row.code})`,
      `เวลา ${formatThaiNow()}`,
      "ถ้าเห็นข้อความนี้ แปลว่า webhook ใช้ได้",
    ].join("\n");
    const result = await this.sendDiscord(msg, {
      branchId: row.id,
      branchCode: row.code,
    });
    return result;
  }

  /**
   * แจ้งตอนเปิดรอบ (ครั้งแรกที่ sync รอบนี้)
   */
  async notifyShiftOpen(payload: {
    branchId: string;
    staffName: string;
    terminalId?: string;
    terminalName?: string;
    openedAt: string;
    openCash: number;
    summary?: unknown;
  }) {
    try {
      const branch = await this.database.db
        .select({ name: pg.branches.name, code: pg.branches.code })
        .from(pg.branches)
        .where(eq(pg.branches.id, payload.branchId))
        .limit(1);
      const branchLabel =
        branch[0]?.name?.trim() ||
        branch[0]?.code?.trim() ||
        payload.branchId;
      const summary =
        payload.summary && typeof payload.summary === "object"
          ? (payload.summary as Record<string, unknown>)
          : {};
      const floatCounted = Boolean(summary.floatCounted);

      const ledger = floatCounted
        ? [discordRow("เงินทอนเริ่ม", formatBaht0(payload.openCash), 16, 12)]
        : [discordRow("เงินทอนเริ่ม", "ยังไม่นับ", 16, 12)];

      await this.sendDiscord("", {
        branchId: payload.branchId,
        branchCode: branch[0]?.code,
        embeds: [
          {
            title: `เปิดรอบ · ${branchLabel}`,
            description: embedMeta([
              `พนักงาน: ${payload.staffName || "-"}`,
              payload.terminalName || payload.terminalId
                ? `เครื่อง: ${payload.terminalName?.trim() || payload.terminalId}`
                : null,
              `เวลา: ${formatThaiAt(payload.openedAt)}`,
              discordBlock(ledger),
            ]),
            color: DISCORD_COLOR.shiftOpen,
            footer: { text: "AP POS · เปิดรอบ" },
          },
        ],
      });
    } catch (err) {
      this.logger.warn(
        `notifyShiftOpen failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * แจ้งตอนนับเงินทอนเริ่มรอบ (รวมนับทีหลัง / นับใหม่)
   */
  async notifyFloatCount(payload: {
    branchId: string;
    staffName: string;
    terminalId?: string;
    terminalName?: string;
    openedAt: string;
    openCash: number;
    cashCounts?: unknown[];
  }) {
    try {
      const branch = await this.database.db
        .select({ name: pg.branches.name, code: pg.branches.code })
        .from(pg.branches)
        .where(eq(pg.branches.id, payload.branchId))
        .limit(1);
      const branchLabel =
        branch[0]?.name?.trim() ||
        branch[0]?.code?.trim() ||
        payload.branchId;

      const counts = Array.isArray(payload.cashCounts) ? payload.cashCounts : [];
      const floatCount = [...counts]
        .reverse()
        .find((c) => {
          const row = c as Record<string, unknown>;
          return row?.purpose === "float";
        }) as
        | {
            total?: number;
            at?: string;
            denoms?: Array<{ denom?: number; qty?: number }>;
          }
        | undefined;
      const total =
        floatCount?.total != null ? num(floatCount.total) : num(payload.openCash);
      const denoms = (floatCount?.denoms ?? []).filter(
        (d) => num(d.qty) > 0 && num(d.denom) > 0,
      );

      const ledger: string[] = [
        discordRow("เงินทอนเริ่ม", formatBaht0(total), 16, 12),
      ];
      if (denoms.length) {
        for (const d of denoms.sort(
          (a, b) => num(b.denom) - num(a.denom),
        )) {
          const denom = num(d.denom);
          const qty = num(d.qty);
          ledger.push(
            discordRow(
              `${formatBaht0(denom)} × ${qty}`,
              formatBaht0(denom * qty),
              16,
              12,
            ),
          );
        }
      }

      await this.sendDiscord("", {
        branchId: payload.branchId,
        branchCode: branch[0]?.code,
        embeds: [
          {
            title: `นับเงินทอน · ${branchLabel}`,
            description: embedMeta([
              `พนักงาน: ${payload.staffName || "-"}`,
              payload.terminalName || payload.terminalId
                ? `เครื่อง: ${payload.terminalName?.trim() || payload.terminalId}`
                : null,
              `เวลา: ${formatThaiAt(floatCount?.at ?? payload.openedAt)}`,
              discordBlock(ledger),
            ]),
            color: DISCORD_COLOR.floatCount,
            footer: { text: "AP POS · นับเงินทอน" },
          },
        ],
      });
    } catch (err) {
      this.logger.warn(
        `notifyFloatCount failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /** แจ้งทันทีเมื่อนำเงินเข้า/ออกลิ้นชัก */
  async notifyCashMove(
    ctx: {
      branchId: string;
      staffName?: string;
      terminalId?: string;
      terminalName?: string;
    },
    move: {
      direction?: string;
      amount?: number;
      reason?: string;
      note?: string;
      at?: string;
      staffName?: string;
    },
  ) {
    try {
      const branch = await this.database.db
        .select({ name: pg.branches.name, code: pg.branches.code })
        .from(pg.branches)
        .where(eq(pg.branches.id, ctx.branchId))
        .limit(1);
      const branchLabel =
        branch[0]?.name?.trim() ||
        branch[0]?.code?.trim() ||
        ctx.branchId;
      const isOut = move.direction === "out";
      const amount = num(move.amount);

      await this.sendDiscord("", {
        branchId: ctx.branchId,
        branchCode: branch[0]?.code,
        embeds: [
          {
            title: `${isOut ? "นำเงินออก" : "นำเงินเข้า"} · ${branchLabel}`,
            description: embedMeta([
              `พนักงาน: ${move.staffName?.trim() || ctx.staffName || "-"}`,
              ctx.terminalName || ctx.terminalId
                ? `เครื่อง: ${ctx.terminalName?.trim() || ctx.terminalId}`
                : null,
              `เวลา: ${formatThaiAt(move.at)}`,
              discordBlock([
                discordRow("จำนวน", formatBaht0(amount), 14, 12),
              ]),
              move.reason?.trim() ? `เหตุผล: ${move.reason.trim()}` : null,
              move.note?.trim() ? `หมายเหตุ: ${move.note.trim()}` : null,
            ]),
            color: isOut ? DISCORD_COLOR.cashOut : DISCORD_COLOR.cashIn,
            footer: {
              text: isOut ? "AP POS · นำเงินออก" : "AP POS · นำเงินเข้า",
            },
          },
        ],
      });
    } catch (err) {
      this.logger.warn(
        `notifyCashMove failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * แจ้งตอนปิดรอบ (นับเงิน / ไม่นับ)
   * ส่งครั้งเดียวเมื่อสถานะเปลี่ยนเป็น closed ครั้งแรก
   */
  async notifyShiftClose(payload: {
    id: string;
    branchId: string;
    staffName: string;
    terminalId?: string;
    terminalName?: string;
    openedAt: string;
    closedAt?: string | null;
    openCash: number;
    closeCash?: number | null;
    expectedCash?: number | null;
    variance?: number | null;
    billCount?: number;
    grossTotal?: number;
    closeNote?: string | null;
    summary?: unknown;
    cashCounts?: unknown[];
  }) {
    try {
      const branch = await this.database.db
        .select({ name: pg.branches.name, code: pg.branches.code })
        .from(pg.branches)
        .where(eq(pg.branches.id, payload.branchId))
        .limit(1);
      const branchLabel =
        branch[0]?.name?.trim() ||
        branch[0]?.code?.trim() ||
        payload.branchId;

      const summary =
        payload.summary && typeof payload.summary === "object"
          ? (payload.summary as Record<string, unknown>)
          : {};
      const byMethod =
        summary.byMethod && typeof summary.byMethod === "object"
          ? (summary.byMethod as Record<string, unknown>)
          : {};
      const cashSales = num(byMethod.cash);
      const transfer = num(byMethod.transfer);
      const government = num(byMethod.government);
      const cashInTotal = num(summary.cashInTotal);
      const cashOutTotal = num(summary.cashOutTotal);
      const floatCounted = Boolean(summary.floatCounted);
      const commission =
        summary.commission && typeof summary.commission === "object"
          ? (summary.commission as Record<string, unknown>)
          : null;

      const counted = payload.closeCash;
      const expected = payload.expectedCash;
      const variance = payload.variance;
      const didCount = counted != null;

      let closeColor: number = DISCORD_COLOR.shiftClose;
      if (didCount && variance != null) {
        if (variance < -0.009) closeColor = DISCORD_COLOR.shiftCloseShort;
        else if (variance > 0.009) closeColor = DISCORD_COLOR.shiftCloseOver;
      }

      const salesLedger: string[] = [
        discordRow(
          `ยอดขายรอบ (${payload.billCount ?? 0} บิล)`,
          formatBaht(num(payload.grossTotal)),
          20,
          14,
        ),
        discordRow("เงินสด", formatBaht(cashSales), 20, 14),
        discordRow("เงินโอน", formatBaht(transfer), 20, 14),
      ];
      if (government > 0) {
        salesLedger.push(
          discordRow("สวัสดิการ", formatBaht(government), 20, 14),
        );
      }

      const drawerLedger: string[] = [
        discordRow(
          "เงินทอนเริ่ม",
          floatCounted ? formatBaht0(payload.openCash) : "ยังไม่นับ",
          18,
          12,
        ),
        discordRow("ขายเงินสด", `+${formatBaht0(cashSales)}`, 18, 12),
      ];
      if (cashInTotal > 0) {
        drawerLedger.push(
          discordRow("นำเงินเข้า", `+${formatBaht0(cashInTotal)}`, 18, 12),
        );
      }
      if (cashOutTotal > 0) {
        drawerLedger.push(
          discordRow("นำเงินออก", `-${formatBaht0(cashOutTotal)}`, 18, 12),
        );
      }
      drawerLedger.push(
        discordRow(
          "คาดในลิ้นชัก",
          expected == null ? "-" : formatBaht0(expected),
          18,
          12,
        ),
      );
      if (didCount) {
        drawerLedger.push(
          discordRow("นับได้จริง", formatBaht0(num(counted)), 18, 12),
        );
        if (variance != null) {
          let tag = "ตรง";
          if (variance > 0.009) tag = "เกิน";
          else if (variance < -0.009) tag = "ขาด";
          drawerLedger.push(
            discordRow(`ส่วนต่าง (${tag})`, signedBaht0(variance), 18, 12),
          );
        }
      } else {
        drawerLedger.push(discordRow("นับได้จริง", "ไม่ได้นับ", 18, 12));
      }

      const bodyParts: string[] = [
        embedMeta([
          !didCount ? "(ไม่ได้นับเงินในลิ้นชัก)" : null,
          `พนักงาน: ${payload.staffName || "-"}`,
          payload.terminalName || payload.terminalId
            ? `เครื่อง: ${payload.terminalName?.trim() || payload.terminalId}`
            : null,
          `เปิด ${formatThaiAt(payload.openedAt)} → ปิด ${formatThaiAt(payload.closedAt)}`,
        ]),
        "**ยอดขาย**",
        discordBlock(salesLedger),
        "**ลิ้นชัก**",
        discordBlock(drawerLedger),
      ];

      const counts = Array.isArray(payload.cashCounts) ? payload.cashCounts : [];
      const closeCount = [...counts]
        .reverse()
        .find((c) => {
          const row = c as Record<string, unknown>;
          return row?.purpose === "close";
        }) as { denoms?: Array<{ denom?: number; qty?: number }> } | undefined;
      const denoms = (closeCount?.denoms ?? []).filter(
        (d) => num(d.qty) > 0 && num(d.denom) > 0,
      );
      if (denoms.length) {
        bodyParts.push("**ธนบัตร/เหรียญ**");
        bodyParts.push(
          discordBlock(
            denoms
              .sort((a, b) => num(b.denom) - num(a.denom))
              .map((d) => {
                const denom = num(d.denom);
                const qty = num(d.qty);
                return discordRow(
                  `${formatBaht0(denom)} × ${qty}`,
                  formatBaht0(denom * qty),
                  16,
                  12,
                );
              }),
          ),
        );
      }

      if (payload.closeNote?.trim()) {
        bodyParts.push(`หมายเหตุ: ${payload.closeNote.trim()}`);
      }

      if (commission && num(commission.amount) > 0) {
        bodyParts.push("**ค่าคอม**");
        bodyParts.push(
          discordBlock([
            discordRow(
              "ค่าคอมวันนี้",
              formatBaht(num(commission.amount)),
              18,
              14,
            ),
            discordRow(
              "ยอดขายวัน",
              formatBaht(num(commission.daySales)),
              18,
              14,
            ),
          ]),
        );
      }

      const tops = await this.buildShiftTopProducts(payload.id);
      if (tops.topFresh.length) {
        bodyParts.push("**ของสด (กก.)**");
        bodyParts.push(
          discordBlock(
            tops.topFresh.map(([name, qty]) =>
              discordQtyNameRow(name, String(qty), 8, 22),
            ),
          ),
        );
      }
      if (tops.topGeneral.length) {
        bodyParts.push("**ของทั่วไป (หน่วย)**");
        bodyParts.push(
          discordBlock(
            tops.topGeneral.map(([name, qty]) =>
              discordQtyNameRow(name, String(qty), 8, 22),
            ),
          ),
        );
      }

      // Discord embed description จำกัด ~4096 ตัวอักษร
      let description = bodyParts.filter(Boolean).join("\n");
      if (description.length > 3900) {
        description = `${description.slice(0, 3890)}\n…`;
      }

      await this.sendDiscord(
        `${formatBaht(num(payload.grossTotal))} บาท · ${payload.billCount ?? 0} บิล · ปิดรอบ ${branchLabel}`,
        {
          branchId: payload.branchId,
          branchCode: branch[0]?.code,
          embeds: [
            {
              title: `${formatBaht(num(payload.grossTotal))} บาท · ปิดรอบ ${branchLabel}`,
              description,
              color: closeColor,
              footer: { text: "AP POS · ปิดรอบ" },
            },
          ],
        },
      );
    } catch (err) {
      this.logger.warn(
        `notifyShiftClose failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * แจ้งเมื่อมีบิลใหม่ sync — ส่งข้อความสั้น + throttle 1 ครั้ง/นาที/สาขา
   */
  async notifyDaySalesUpdate(hint: SaleNotifyHint) {
    try {
      if (!hint.branchId) return;
      const prev = this.pendingBrief.get(hint.branchId);
      const merged: PendingBrief = {
        branchId: hint.branchId,
        branchName: hint.branchName ?? prev?.branchName,
        branchCode: hint.branchCode ?? prev?.branchCode,
        billNo: hint.billNo ?? prev?.billNo,
        total: hint.total ?? prev?.total,
        newCount: (prev?.newCount ?? 0) + (hint.newCount ?? 1),
      };
      this.pendingBrief.set(hint.branchId, merged);

      const lastAt = this.lastBriefSentAt.get(hint.branchId) ?? 0;
      if (Date.now() - lastAt >= BRIEF_THROTTLE_MS) {
        await this.flushBrief(hint.branchId);
      }
    } catch (err) {
      this.logger.warn(
        `notifyDaySalesUpdate failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /** cron ทุกนาที — ปล่อยคิว brief ที่ค้างจาก throttle */
  async flushPendingBriefs() {
    const now = Date.now();
    for (const branchId of [...this.pendingBrief.keys()]) {
      const lastAt = this.lastBriefSentAt.get(branchId) ?? 0;
      if (now - lastAt >= BRIEF_THROTTLE_MS) {
        await this.flushBrief(branchId);
      }
    }
  }

  private async flushBrief(branchId: string) {
    const hint = this.pendingBrief.get(branchId);
    if (!hint) return;
    this.pendingBrief.delete(branchId);
    const net = await this.todayNetSales(branchId);
    const built = await this.buildDaySalesBrief(hint);
    this.lastNotifiedNetByBranch.set(branchId, net);
    this.lastBriefSentAt.set(branchId, Date.now());
    // content ขึ้นก่อน → ป๊อปอัปมือถือเห็นยอดรวมทันที
    await this.sendDiscord(built.content, {
      branchId: hint.branchId,
      branchCode: hint.branchCode,
      embeds: [built.embed],
    });
  }

  /**
   * สำรอง — ถ้ายอดเปลี่ยนและยังไม่เคย brief ในรอบนี้ (เช่น sync พลาด)
   * ไม่ส่งซ้ำยอดเดิม
   */
  async notifyAllBranchesDigest() {
    await this.flushPendingBriefs();

    const day = bangkokTodayIso();
    const start = bangkokDayStart(day);
    const end = bangkokDayEnd(day);
    const rows = await this.database.db
      .select({
        branchId: pg.sales.branchId,
        total: sql<string>`coalesce(sum(${pg.sales.total}), 0)`,
      })
      .from(pg.sales)
      .where(
        and(
          eq(pg.sales.status, "completed"),
          gte(pg.sales.createdAt, start),
          lte(pg.sales.createdAt, end),
        ),
      )
      .groupBy(pg.sales.branchId);

    for (const row of rows) {
      const net = Math.round(num(row.total) * 100) / 100;
      if (this.lastNotifiedNetByBranch.get(row.branchId) === net) continue;
      const lastAt = this.lastBriefSentAt.get(row.branchId) ?? 0;
      if (Date.now() - lastAt < BRIEF_THROTTLE_MS) continue;

      const branch = await this.database.db
        .select()
        .from(pg.branches)
        .where(eq(pg.branches.id, row.branchId))
        .limit(1);
      this.pendingBrief.set(row.branchId, {
        branchId: row.branchId,
        branchName: branch[0]?.name,
        branchCode: branch[0]?.code,
        newCount: 0,
      });
      await this.flushBrief(row.branchId);
    }
  }

  /** สรุปปิดรอบเท่านั้น — ไม่ใช้ cron 21:00 แล้ว (ส่งทันทีตอนปิดรอบ sync) */
  async notifyEndOfDaySummaries() {
    return;
  }

  /** Top สินค้าของรอบนี้ (แทนสรุป 21:00) */
  private async buildShiftTopProducts(shiftId: string) {
    const lineRows = await this.database.db
      .select({
        barcode: pg.saleLines.barcode,
        name: pg.saleLines.name,
        qty: pg.saleLines.qty,
        unit: pg.saleLines.unit,
      })
      .from(pg.saleLines)
      .innerJoin(pg.sales, eq(pg.saleLines.saleId, pg.sales.id))
      .where(
        and(eq(pg.sales.status, "completed"), eq(pg.sales.shiftId, shiftId)),
      );

    const freshMap = new Map<string, number>();
    const generalMap = new Map<string, number>();
    for (const line of lineRows) {
      const qty = num(line.qty);
      const name = (line.name || line.barcode || "?").trim();
      const isFresh =
        (line.barcode ?? "").trim().startsWith("9") ||
        /กก|โล|kilogram/i.test(line.unit ?? "");
      const bucket = isFresh ? freshMap : generalMap;
      bucket.set(name, (bucket.get(name) ?? 0) + qty);
    }

    const topFresh = [...freshMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([name, qty]) => [name, Math.round(qty * 100) / 100] as const);
    const topGeneral = [...generalMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([name, qty]) => [name, Math.round(qty * 100) / 100] as const);
    return { topFresh, topGeneral };
  }

  /** ท็อปของสดวันนี้ของสาขา (ใช้ในสรุป brief) */
  private async buildDayTopFresh(saleWhere: SQL[], limit = 10) {
    const lineRows = await this.database.db
      .select({
        barcode: pg.saleLines.barcode,
        name: pg.saleLines.name,
        qty: pg.saleLines.qty,
        unit: pg.saleLines.unit,
      })
      .from(pg.saleLines)
      .innerJoin(pg.sales, eq(pg.saleLines.saleId, pg.sales.id))
      .where(and(...saleWhere));

    const freshMap = new Map<string, number>();
    for (const line of lineRows) {
      const isFresh =
        (line.barcode ?? "").trim().startsWith("9") ||
        /กก|โล|kilogram/i.test(line.unit ?? "");
      if (!isFresh) continue;
      const name = (line.name || line.barcode || "?").trim();
      freshMap.set(name, (freshMap.get(name) ?? 0) + num(line.qty));
    }

    return [...freshMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(
        ([name, qty]) =>
          [name, Math.round(qty * 100) / 100] as const,
      );
  }

  private async todayNetSales(branchId: string) {
    const day = bangkokTodayIso();
    const start = bangkokDayStart(day);
    const end = bangkokDayEnd(day);
    const rows = await this.database.db
      .select({
        total: sql<string>`coalesce(sum(${pg.sales.total}), 0)`,
      })
      .from(pg.sales)
      .where(
        and(
          eq(pg.sales.status, "completed"),
          eq(pg.sales.branchId, branchId),
          gte(pg.sales.createdAt, start),
          lte(pg.sales.createdAt, end),
        ),
      );
    return Math.round(num(rows[0]?.total) * 100) / 100;
  }

  /** สรุปยอดขายวัน — content สำหรับป๊อปอัป + embed รายละเอียด */
  private async buildDaySalesBrief(hint: SaleNotifyHint) {
    const day = bangkokTodayIso();
    const start = bangkokDayStart(day);
    const end = bangkokDayEnd(day);
    const branchId = hint.branchId;

    const saleWhere: SQL[] = [
      eq(pg.sales.status, "completed"),
      eq(pg.sales.branchId, branchId),
      gte(pg.sales.createdAt, start),
      lte(pg.sales.createdAt, end),
    ];

    const saleAgg = await this.database.db
      .select({
        total: sql<string>`coalesce(sum(${pg.sales.total}), 0)`,
        billCount: sql<number>`count(*)::int`,
      })
      .from(pg.sales)
      .where(and(...saleWhere));

    const payRows = await this.database.db
      .select({
        method: pg.salePayments.method,
        amount: sql<string>`coalesce(sum(${pg.salePayments.amount}), 0)`,
        count: sql<number>`count(*)::int`,
      })
      .from(pg.salePayments)
      .innerJoin(pg.sales, eq(pg.salePayments.saleId, pg.sales.id))
      .where(and(...saleWhere))
      .groupBy(pg.salePayments.method);

    let cash = 0;
    let transfer = 0;
    let transferCount = 0;
    let government = 0;
    for (const r of payRows) {
      const amount = num(r.amount);
      if (r.method === "cash") cash += amount;
      else if (r.method === "transfer") {
        transfer += amount;
        transferCount += Number(r.count) || 0;
      } else if (r.method === "government") government += amount;
    }

    const netSales = num(saleAgg[0]?.total);
    const billCount = Number(saleAgg[0]?.billCount) || 0;
    const branchLabel =
      hint.branchName?.trim() || hint.branchCode?.trim() || branchId;
    const totalText = formatBaht(netSales);

    // ข้อความสั้นสำหรับ notification มือถือ — ยอดรวมขึ้นก่อน
    const content = `${totalText} บาท · ${billCount} บิล · ${branchLabel}`;

    const ledger: string[] = [];
    ledger.push(
      discordRow(`ยอดขาย (${billCount} บิล)`, totalText, 18, 14),
    );
    ledger.push(discordRow("เงินสด", formatBaht(cash), 18, 14));
    ledger.push(
      discordRow(
        transferCount ? `เงินโอน (${transferCount} ครั้ง)` : "เงินโอน",
        formatBaht(transfer),
        18,
        14,
      ),
    );
    if (government > 0) {
      ledger.push(discordRow("บัตรสวัสดิการ", formatBaht(government), 18, 14));
    }
    if (hint.billNo) {
      const amt =
        hint.total != null ? formatBaht(hint.total) : "";
      const extra =
        hint.newCount && hint.newCount > 1
          ? ` (+${hint.newCount - 1})`
          : "";
      ledger.push(
        discordRow(`บิลล่าสุด${extra}`, amt || "—", 18, 14),
      );
      ledger.push(truncateChars(hint.billNo, 33));
    } else if (hint.newCount && hint.newCount > 0) {
      ledger.push(discordRow("บิลใหม่ sync", `${hint.newCount} ใบ`, 18, 14));
    }

    const topFresh = await this.buildDayTopFresh(saleWhere, 10);
    const descParts = [
      formatThaiNow(),
      discordBlock(ledger),
    ];
    if (topFresh.length) {
      descParts.push("**Top 10**");
      descParts.push(
        discordBlock(
          topFresh.map(([name, qty]) =>
            discordQtyNameRow(name, String(qty), 8, 22),
          ),
        ),
      );
    }

    let description = descParts.join("\n");
    if (description.length > 3900) {
      description = `${description.slice(0, 3890)}\n…`;
    }

    return {
      content,
      embed: {
        title: `${totalText} บาท · ${branchLabel}`,
        description,
        color: DISCORD_COLOR.salesBrief,
        footer: { text: "AP POS · สรุปยอดระหว่างวัน" },
      },
    };
  }

  async buildDaySalesMessage(hint: SaleNotifyHint, mode: NotifyMode = "full") {
    const day = bangkokTodayIso();
    const start = bangkokDayStart(day);
    const end = bangkokDayEnd(day);
    const branchId = hint.branchId;

    const saleWhere: SQL[] = [
      eq(pg.sales.status, "completed"),
      eq(pg.sales.branchId, branchId),
      gte(pg.sales.createdAt, start),
      lte(pg.sales.createdAt, end),
    ];

    const saleAgg = await this.database.db
      .select({
        total: sql<string>`coalesce(sum(${pg.sales.total}), 0)`,
        billCount: sql<number>`count(*)::int`,
      })
      .from(pg.sales)
      .where(and(...saleWhere));

    const payRows = await this.database.db
      .select({
        method: pg.salePayments.method,
        amount: sql<string>`coalesce(sum(${pg.salePayments.amount}), 0)`,
        count: sql<number>`count(*)::int`,
      })
      .from(pg.salePayments)
      .innerJoin(pg.sales, eq(pg.salePayments.saleId, pg.sales.id))
      .where(and(...saleWhere))
      .groupBy(pg.salePayments.method);

    let cash = 0;
    let transfer = 0;
    let transferCount = 0;
    let government = 0;
    for (const r of payRows) {
      const amount = num(r.amount);
      if (r.method === "cash") cash += amount;
      else if (r.method === "transfer") {
        transfer += amount;
        transferCount += Number(r.count) || 0;
      } else if (r.method === "government") government += amount;
    }

    const netSales = num(saleAgg[0]?.total);
    const billCount = Number(saleAgg[0]?.billCount) || 0;
    const branchLabel =
      hint.branchName?.trim() || hint.branchCode?.trim() || branchId;

    const lines: string[] = [];
    if (mode === "full") {
      lines.push(`สรุปปิดวัน · สาขา: ${branchLabel}`);
    } else {
      lines.push(`สาขา: ${branchLabel}`);
    }
    lines.push(`วันที่ ${formatThaiNow()}`);

    const ledger: string[] = [];
    if (mode === "brief") {
      if (hint.billNo) {
        const amt = hint.total != null ? formatBaht(hint.total) : "—";
        const extra =
          hint.newCount && hint.newCount > 1
            ? ` (+${hint.newCount - 1})`
            : "";
        ledger.push(discordRow(`บิลใหม่${extra}`, amt, 18, 14));
        ledger.push(truncateChars(hint.billNo, 33));
      } else if (hint.newCount && hint.newCount > 0) {
        ledger.push(
          discordRow("บิลใหม่ sync", `${hint.newCount} ใบ`, 18, 14),
        );
      }
    }

    ledger.push(
      discordRow(`ยอดขาย (${billCount} บิล)`, formatBaht(netSales), 18, 14),
    );
    ledger.push(discordRow("เงินสด", formatBaht(cash), 18, 14));
    ledger.push(
      discordRow(
        transferCount ? `เงินโอน (${transferCount} ครั้ง)` : "เงินโอน",
        formatBaht(transfer),
        18,
        14,
      ),
    );
    if (government > 0) {
      ledger.push(discordRow("บัตรสวัสดิการ", formatBaht(government), 18, 14));
    }
    lines.push(discordBlock(ledger));

    if (mode === "brief") {
      return lines.join("\n");
    }

    // —— full: กำไร / ค่าใช้จ่าย / top สินค้า ——
    const lineRows = await this.database.db
      .select({
        barcode: pg.saleLines.barcode,
        productCode: pg.saleLines.productCode,
        name: pg.saleLines.name,
        qty: pg.saleLines.qty,
        unit: pg.saleLines.unit,
        lineTotal: pg.saleLines.lineTotal,
        unitPrice: pg.saleLines.unitPrice,
      })
      .from(pg.saleLines)
      .innerJoin(pg.sales, eq(pg.saleLines.saleId, pg.sales.id))
      .where(and(...saleWhere));

    const products = await this.database.db
      .select({
        barcode: pg.products.barcode,
        productCode: pg.products.productCode,
        costPrice: pg.products.costPrice,
        name: pg.products.name,
      })
      .from(pg.products)
      .where(isNull(pg.products.deletedAt));

    const byBarcode = new Map(
      products.map((p) => [p.barcode.trim(), p] as const),
    );
    const byCode = new Map(
      products
        .filter((p) => p.productCode)
        .map((p) => [String(p.productCode).trim(), p] as const),
    );

    let saleTotal = 0;
    let costTotal = 0;
    const freshMap = new Map<string, { qty: number; price: number }>();
    const generalMap = new Map<string, { qty: number; price: number }>();

    for (const line of lineRows) {
      const lt = num(line.lineTotal);
      const qty = num(line.qty);
      const unitPrice = num(line.unitPrice);
      saleTotal += lt;
      const hit =
        byBarcode.get((line.barcode ?? "").trim()) ??
        byCode.get((line.productCode ?? "").trim());
      const cost = hit?.costPrice != null ? num(hit.costPrice) * qty : 0;
      costTotal += cost;

      const name = (line.name || hit?.name || line.barcode || "?").trim();
      const isFresh =
        (line.barcode ?? "").trim().startsWith("9") ||
        /กก|โล|kilogram/i.test(line.unit ?? "");
      const bucket = isFresh ? freshMap : generalMap;
      const cur = bucket.get(name) ?? { qty: 0, price: unitPrice };
      cur.qty += qty;
      if (unitPrice > 0) cur.price = unitPrice;
      bucket.set(name, cur);
    }

    const profit = saleTotal - costTotal;
    const profitPct =
      costTotal > 0 ? Math.round((profit / costTotal) * 10000) / 100 : 0;

    const expenseBranchRows = await this.database.db
      .select({
        total: sql<string>`coalesce(sum(${pg.expenses.amount}), 0)`,
      })
      .from(pg.expenses)
      .where(
        and(
          isNull(pg.expenses.deletedAt),
          eq(pg.expenses.branchId, branchId),
          gte(pg.expenses.spentAt, start),
          lte(pg.expenses.spentAt, end),
        ),
      );
    const expensesBranch = num(expenseBranchRows[0]?.total);

    const expenseSharedRows = await this.database.db
      .select({
        total: sql<string>`coalesce(sum(${pg.expenses.amount}), 0)`,
      })
      .from(pg.expenses)
      .where(
        and(
          isNull(pg.expenses.deletedAt),
          or(isNull(pg.expenses.branchId), eq(pg.expenses.branchId, "")),
          gte(pg.expenses.spentAt, start),
          lte(pg.expenses.spentAt, end),
        ),
      );
    const expensesShared = num(expenseSharedRows[0]?.total);
    const remain = profit - expensesBranch;

    const footerLedger: string[] = [
      discordRow(
        costTotal > 0
          ? `กำไรประมาณ (${formatBaht(profitPct)}%)`
          : "กำไรประมาณ",
        formatBaht(profit),
        20,
        14,
      ),
      discordRow("ค่าใช้จ่ายสาขา", formatBaht(expensesBranch), 20, 14),
    ];
    if (expensesShared > 0) {
      footerLedger.push(
        discordRow("ค่าใช้จ่ายกลาง*", formatBaht(expensesShared), 20, 14),
      );
    }
    footerLedger.push(discordRow("คงเหลือเก็บ", formatBaht(remain), 20, 14));
    lines.push(discordBlock(footerLedger));
    lines.push("※ ต้นทุนจากราคาต้นทุนปัจจุบัน ไม่ใช่ตอนขาย");
    if (expensesShared > 0) {
      lines.push("* ค่าใช้จ่ายกลางยังไม่หักในคงเหลือ");
    }

    const topFresh = [...freshMap.entries()]
      .sort((a, b) => b[1].qty - a[1].qty)
      .slice(0, 12);
    if (topFresh.length) {
      lines.push("ของสด (กก.)");
      lines.push(
        discordBlock(
          topFresh.map(([name, v]) => {
            const q = Math.round(v.qty * 100) / 100;
            return discordQtyNameRow(name, String(q), 8, 22);
          }),
        ),
      );
    }

    const topGeneral = [...generalMap.entries()]
      .sort((a, b) => b[1].qty - a[1].qty)
      .slice(0, 12);
    if (topGeneral.length) {
      lines.push("ของทั่วไป (หน่วย)");
      lines.push(
        discordBlock(
          topGeneral.map(([name, v]) => {
            const q = Math.round(v.qty * 100) / 100;
            return discordQtyNameRow(name, String(q), 8, 22);
          }),
        ),
      );
    }

    return lines.join("\n");
  }
}
