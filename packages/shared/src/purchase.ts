/** กลุ่มร้านซื้อของ — คอลัมน์สรุป */
export const PURCHASE_GROUPS = [
  { key: "meatball", label: "ร้านลูกชิ้น", hint: "ลูกชิ้น · ของแช่แข็งแปรรูป" },
  { key: "market", label: "ร้านในตลาด", hint: "ไก่ · เห็ด · ถุง · ของตลาด" },
  { key: "veg", label: "ร้านผัก", hint: "ผักสด" },
  {
    key: "transfer",
    label: "ส่งสาขา",
    hint: "ของที่ส่งข้ามสาขา",
  },
  { key: "makro", label: "แม็คโค", hint: "ของจากแม็คโค" },
] as const;

/** กลุ่มเริ่มต้นเมื่อยังไม่รู้จักชื่อ — ลงร้านในตลาด */
export const PURCHASE_DEFAULT_GROUP = "market" as const;

export type PurchaseGroupKey = (typeof PURCHASE_GROUPS)[number]["key"];

/** สถานะขอสินค้าของแต่ละวัน */
export const PURCHASE_DAY_STATUSES = [
  { key: "open", label: "รับรายการ", tone: "neutral" },
  { key: "requested", label: "ขอสินค้าแล้ว", tone: "warn" },
  { key: "buying", label: "กำลังซื้อ", tone: "info" },
  { key: "done", label: "เสร็จแล้ว", tone: "ok" },
] as const;

export type PurchaseDayStatus = (typeof PURCHASE_DAY_STATUSES)[number]["key"];

export function purchaseDayStatusLabel(status: string) {
  return (
    PURCHASE_DAY_STATUSES.find((s) => s.key === status)?.label ?? status
  );
}

export function isPurchaseDayStatus(v: string): v is PurchaseDayStatus {
  return PURCHASE_DAY_STATUSES.some((s) => s.key === v);
}

export type ParsedPurchaseLine = {
  name: string;
  qtyText: string | null;
  note: string | null;
};

/**
 * รูปแบบสถานะในข้อความ — คั่นด้วยขีด ไม่ปนกับชื่อสินค้า
 * ตัวอย่าง: คอมโบ -หมด- · ชีสยืด -มี1- · ซี่โครง -สำรอง- · หมูสับ -ขอ2-
 */
export function formatPurchaseLine(opts: {
  name: string;
  remaining?: string | number | null;
  spare?: boolean;
  empty?: boolean;
  /** ต้องการขอเพิ่ม (จำนวนอยู่ใน remaining) */
  order?: boolean;
}): string {
  const name = String(opts.name ?? "").trim();
  if (!name) return "";
  const tags: string[] = [];
  if (opts.empty) {
    tags.push("-หมด-");
  } else if (opts.order) {
    const n =
      opts.remaining != null
        ? String(opts.remaining).trim().replace(/[^\d.]/g, "")
        : "";
    tags.push(n ? `-ขอ${n}-` : "-ขอ-");
  } else if (opts.remaining != null && String(opts.remaining).trim() !== "") {
    const n = String(opts.remaining).trim().replace(/[^\d.]/g, "");
    if (n) tags.push(`-มี${n}-`);
  }
  if (opts.spare) tags.push("-สำรอง-");
  return tags.length ? `${name} ${tags.join(" ")}` : name;
}

/** ข้ามเฉพาะบรรทัดหัวข้อ/เวลา ไม่ใช่รายการสินค้า */
function shouldSkipLine(line: string) {
  if (/^\d{1,2}:\d{2}\s*$/.test(line)) return true;
  if (/^สาขา/i.test(line) && line.length < 40) return true;
  if (/^(ในครัว|หลุมดิน|เจ็ดเสมียน|บ้านฆ้อง)\s*$/i.test(line)) return true;
  if (/^น้อง\S{0,20}$/u.test(line)) return true;
  if (/^#/.test(line)) return true;
  return false;
}

/** ตัดคำนำหน้า/ขยะที่พบบ่อย */
function cleanName(raw: string) {
  return raw
    .replace(/^\d{1,2}:\d{2}\s*/u, "")
    .replace(/^น้อง\S*\s+/u, "")
    // หมูสับเอา1ถาด → หมูสับ1ถาด
    .replace(/เอา(?=\s*\d)/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** ดึงแท็ก -หมด- / -สำรอง- / -มี1- / -ขอ2- ออกจากชื่อ */
function extractDashMarkers(raw: string): {
  name: string;
  empty: boolean;
  spare: boolean;
  order: boolean;
  hasQty: string | null;
  orderQty: string | null;
} {
  let empty = false;
  let spare = false;
  let order = false;
  let hasQty: string | null = null;
  let orderQty: string | null = null;
  const name = raw
    .replace(
      /-\s*(หมด|สำรอง|มี\s*\d+(?:\.\d+)?[^-]*?|ขอ\s*\d*(?:\.\d+)?[^-]*?|สั่ง\s*\d*(?:\.\d+)?[^-]*?)\s*-/gu,
      (_m, inner: string) => {
        const tag = String(inner).trim().replace(/\s+/g, "");
        if (tag === "หมด") empty = true;
        else if (tag === "สำรอง") spare = true;
        else if (/^มี/.test(tag)) hasQty = String(inner).trim().replace(/\s+/g, "");
        else if (/^(ขอ|สั่ง)/.test(tag)) {
          order = true;
          const n = tag.replace(/^(ขอ|สั่ง)/, "");
          orderQty = n || null;
        }
        return " ";
      },
    )
    .replace(/\s+/g, " ")
    .trim();
  return { name, empty, spare, order, hasQty, orderQty };
}

function parseOneItem(raw: string): ParsedPurchaseLine | null {
  let name = cleanName(raw);
  let qtyText: string | null = null;
  let note: string | null = null;
  if (!name || name.length < 2) return null;

  // ขนาดถุง/ถาด แบบ 6*9, 7x11 — เก็บทั้งชื่อ ไม่แยกจำนวน
  // (ยกเว้นมีแท็ก -มี/-หมด/-สำรอง/-ขอ อยู่ด้วย)
  const hasDashTag = /-\s*(หมด|สำรอง|มี\s*\d|ขอ|สั่ง)/u.test(name);
  if (!hasDashTag && /\d+\s*[x*×]\s*\d+/i.test(name)) {
    return { name, qtyText: null, note: null };
  }

  // รูปแบบใหม่: คอมโบ -หมด- · ชีสยืด -มี1- · หมูสับ -ขอ2- · ซี่โครง -สำรอง-
  const marked = extractDashMarkers(name);
  if (marked.empty || marked.spare || marked.order || marked.hasQty) {
    name = marked.name;
    if (marked.order) {
      qtyText = marked.orderQty ? `ขอ${marked.orderQty}` : "ขอ";
      note = qtyText;
    } else if (marked.hasQty) {
      qtyText = marked.hasQty;
      note = marked.hasQty;
    }
    if (marked.empty) {
      note = note ? `${note} หมด` : "หมด";
      if (!qtyText) qtyText = null;
    }
    if (marked.spare) {
      note = note ? `${note} สำรอง` : "สำรอง";
      if (!qtyText) qtyText = null;
    }
  } else {
    // รูปแบบเก่า (ยังรองรับ): "xxx มี3" / "มี 1 ครึ่ง"
    const hasMatch = name.match(/^(.*?)(มี\s*\d+(?:\.\d+)?.*)$/u);
    if (hasMatch && hasMatch[1].trim().length >= 2) {
      name = hasMatch[1].trim();
      note = hasMatch[2].trim();
      qtyText = note;
    } else {
      const numTail = name.match(
        /^(.*?)(\d+(?:\.\d+)?(?:\s*[+＋]\s*\d+(?:\.\d+)?)?(?:\s*(?:โล|ขีด|มัด|ถุง|ถาด|กก|kg))?)$/iu,
      );
      if (numTail && numTail[1].trim().length >= 2) {
        const before = numTail[1];
        if (/[x*×]\s*$/i.test(before)) {
          // keep full as name
        } else {
          name = before.trim();
          qtyText = numTail[2].trim();
        }
      }
    }

    // สะโพกหมู สำรอง / หมึกกรอบสำรอง
    const spare = name.match(/^(.*?)\s*สำรอง\s*$/u);
    if (spare && spare[1].trim().length >= 2) {
      name = spare[1].trim();
      note = note ? `${note} สำรอง` : "สำรอง";
      if (!qtyText) qtyText = null;
    }

    // คอมโบ หมด / สามชั้นสไลด์หมด
    const empty = name.match(/^(.*?)\s*หมด\s*$/u);
    if (empty && empty[1].trim().length >= 2) {
      name = empty[1].trim();
      note = note ? `${note} หมด` : "หมด";
      if (!qtyText) qtyText = null;
    }
  }

  if (!name || name.length < 2) return null;
  if (/^\d+([:.]\d+)?$/.test(name)) return null;

  return { name, qtyText, note };
}

/**
 * แยกบรรทัดรายการจากข้อความที่น้องส่ง
 * 1 บรรทัดที่พิมพ์ = 1 รายการ (ไม่แตกหลายสินค้าในบรรทัดเดียว)
 * รองรับ: คอมโบ -หมด- · ชีสยืด -มี1- · หมูสับ -ขอ2- · เห็ดเข็ม9 · ถุงร้อน6*9
 */
export function parsePurchaseText(raw: string): ParsedPurchaseLine[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.replace(/\u00a0/g, " ").trim())
    .filter(Boolean);

  const out: ParsedPurchaseLine[] = [];
  for (const line of lines) {
    if (shouldSkipLine(line)) continue;
    if (line.length < 2) continue;
    const parsed = parseOneItem(line);
    if (parsed) out.push(parsed);
  }
  return out;
}

export function normalizePurchaseKey(name: string) {
  return name
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[.\-_/]/g, "")
    .replace(/ชิเมจิ|ชิมิจิ/g, "ชิเมจิ")
    .replace(/อังคณา|อังคนะ|อังคนา|อังคนามี/g, "อังคณา")
    .replace(/ว่ากาเมะ|วากาเมะ|ส่าหร่ายว่ากาเมะ|สาหร่ายวากาเมะ/g, "วากาเมะ")
    .replace(/ชีล้อม|ผักชีล้อม/g, "ชีล้อม")
    .replace(/กาดขาว|ผักกาด/g, "ผักกาด")
    .replace(/เบคอล|เบคอน/g, "เบคอน")
    .replace(/ซอสหอย|ซอลหอย/g, "ซอสหอย")
    .replace(/เนื้อหมูสไลด์/g, "หมูสไลด์")
    .replace(/สะโพกไก่|น่องสะโพกไก่|น่องสะโพก|นสไก่/g, "น่องไก่")
    // พิมพ์ผิดที่พบบ่อยจากแชทน้อง
    .replace(/ใหย่|ใหญ่/g, "ใหญ่")
    .replace(/เด้งใหย่|เด้งใหญ่/g, "เด้งใหญ่")
    .replace(/ถึงหิว|ถุงหิว/g, "ถุงหิ้ว")
    .replace(/ไวตามิ้ว|ไวตามิลค์|ไวตามิล/g, "ไวตามิลค์");
}

/** exact หรือคล้ายกันพอ (กันถ้วยใส่ชีสยืด ชน ชีสยืด) */
export function purchaseKeysCompatible(
  a: string,
  b: string,
): "exact" | "fuzzy" | "none" {
  const key = normalizePurchaseKey(a);
  const ck = normalizePurchaseKey(b);
  if (!key || !ck) return "none";
  if (key === ck) return "exact";
  const shorter = key.length <= ck.length ? key : ck;
  const longer = key.length <= ck.length ? ck : key;
  if (!longer.includes(shorter)) return "none";
  if (shorter.length / longer.length < 0.72) return "none";
  return "fuzzy";
}
