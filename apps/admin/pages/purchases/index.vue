<script setup lang="ts">
import {
  normalizePurchaseKey,
  parsePurchaseText,
  purchaseKeysCompatible,
  type ParsedPurchaseLine,
} from "@ap-pos/shared";
import { toBlob } from "html-to-image";

type Branch = { id: string; code: string; name: string };
type BoardItem = {
  key: string;
  name: string;
  groupKey: string;
  catalogId?: string | null;
  matched: boolean;
  summary: string;
  byBranch: Array<{
    branchId: string;
    branchName: string;
    lineId: string;
    qtyText: string | null;
    note: string | null;
  }>;
};
type Column = {
  key: string;
  label: string;
  hint: string;
  items: BoardItem[];
};
type Board = {
  day: { id: string; day: string; note?: string | null };
  raws: Array<{ branchId: string; branchLabel: string; rawText: string }>;
  columns: Column[];
  unmatched: number;
  lineCount: number;
};

const { get, post } = useAdminApi();
const { askConfirm } = useConfirmDialog();

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const day = ref(todayIso());
const pending = ref(false);
const saving = ref(false);
const error = ref("");
const message = ref("");
const branches = ref<Branch[]>([]);
const board = ref<Board | null>(null);
const recentDays = ref<Array<{ id: string; day: string }>>([]);

/** ข้อความวางแยกตามสาขา */
const pasteByBranch = ref<Record<string, string>>({});

const dragItemKey = ref<string | null>(null);
const dragOverCol = ref<string | null>(null);
const movePickKey = ref<string | null>(null);
let gripDragged = false;
/** ค่าที่กำลังกรอกบนแผง: itemKey::branchId → qty */
const qtyDraft = ref<Record<string, string>>({});
const nameDraft = ref<Record<string, string>>({});
const qtySavingKey = ref<string | null>(null);
const nameSavingKey = ref<string | null>(null);
/** แถวเพิ่มใหม่ต่อคอลัมน์ */
const addRow = ref<
  Record<string, { name: string; qtys: Record<string, string> }>
>({});

/** ชื่อมาตรฐานจากแคตตาล็อก — ใช้ autocomplete ตอนพิมพ์ */
type CatalogSuggest = {
  id: string;
  name: string;
  aliases: string;
  groupKey: string;
  active?: boolean;
};
const catalogItems = ref<CatalogSuggest[]>([]);
/** `'add:meatball'` | item.key */
const suggestKey = ref<string | null>(null);

const COLLAPSE_KEY = "ap-pos.purchases.collapsed";
const PASTE_COLLAPSE_KEY = "ap-pos.purchases.pasteCollapsed";

const GROUP_LABEL: Record<string, string> = {
  meatball: "ลูกชิ้น",
  market: "ตลาด",
  veg: "ผัก",
  transfer: "ส่งสาขา",
  makro: "แม็คโค",
  pending: "ร้านในตลาด",
};

function catalogSuggest(query: string, limit = 8): CatalogSuggest[] {
  const q = query.trim().toLowerCase();
  const active = catalogItems.value.filter((c) => c.active !== false);
  if (!q) return active.slice(0, limit);
  const scored: Array<{ c: CatalogSuggest; score: number }> = [];
  for (const c of active) {
    const name = c.name.toLowerCase();
    const aliases = (c.aliases || "").toLowerCase();
    let score = 0;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (name.includes(q)) score = 50;
    else if (aliases.includes(q)) score = 40;
    else continue;
    scored.push({ c, score });
  }
  scored.sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name, "th"));
  return scored.slice(0, limit).map((x) => x.c);
}

function addSuggestList(colKey: string) {
  return catalogSuggest(addRow.value[colKey]?.name ?? "");
}

function renameSuggestList(item: BoardItem) {
  return catalogSuggest(nameDraft.value[item.key] ?? item.name);
}

async function loadCatalogSuggest() {
  try {
    const data = await get<{ items: CatalogSuggest[] }>("/purchases/catalog");
    catalogItems.value = data.items ?? [];
  } catch {
    catalogItems.value = [];
  }
}

function loadCollapsedCols(): Record<string, boolean> {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(COLLAPSE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const pasteCollapsed = ref(
  typeof localStorage !== "undefined" &&
    localStorage.getItem(PASTE_COLLAPSE_KEY) === "1",
);
const collapsedCols = ref<Record<string, boolean>>(loadCollapsedCols());

function togglePaste() {
  pasteCollapsed.value = !pasteCollapsed.value;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(PASTE_COLLAPSE_KEY, pasteCollapsed.value ? "1" : "0");
  }
}

function isColCollapsed(key: string) {
  return Boolean(collapsedCols.value[key]);
}

function toggleCol(key: string) {
  collapsedCols.value = {
    ...collapsedCols.value,
    [key]: !collapsedCols.value[key],
  };
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsedCols.value));
  }
}

const pasteFilledCount = computed(
  () =>
    branches.value.filter((b) => (pasteByBranch.value[b.id] ?? "").trim())
      .length,
);

/** จำนวนบรรทัดสินค้าจากข้อความที่วาง (ต่อสาขา) */
function pasteItemCount(branchId: string) {
  return parsePurchaseText(pasteByBranch.value[branchId] ?? "").length;
}

/** จำนวนรายการบนแผงที่สาขานั้นสั่ง */
function boardItemCount(branchId: string) {
  if (!board.value) return 0;
  let n = 0;
  for (const col of board.value.columns) {
    for (const item of col.items) {
      if (branchHasOrder(item, branchId)) n += 1;
    }
  }
  return n;
}

const branchCountLegend = computed(() => {
  if (!board.value || !copyBranchOrder.value.length) return "";
  return copyBranchOrder.value
    .map((b) => `${shortBranchName(b.name)} ${boardItemCount(b.id)}`)
    .join(" · ");
});

/** ลำดับคัดลอก: หลุมดิน → เจ็ดเสมียน → บ้านฆ้อง → อื่น */
function branchRank(name: string) {
  if (/หลุมดิน/.test(name)) return 0;
  if (/เจ็ดเสมียน/.test(name)) return 1;
  if (/บ้านฆ้อง|ฆ้อง/.test(name)) return 2;
  return 3;
}

const copyBranchOrder = computed(() =>
  [...branches.value].sort((a, b) => {
    const d = branchRank(a.name) - branchRank(b.name);
    return d !== 0 ? d : a.code.localeCompare(b.code);
  }),
);

const copyLegend = computed(() => {
  const names = copyBranchOrder.value.map((b) => shortBranchName(b.name));
  if (names.length < 2) return "";
  if (names.length === 2) {
    return `คัดลอก 4+2 = รวม 6 ของ${names[0]} 4 · ${names[1]} 2 · (01) ${names[0]} · (02) ${names[1]}`;
  }
  const marks = names
    .map((n, i) => `(${String(i + 1).padStart(2, "0")}) ${n}`)
    .join(" · ");
  return `คัดลอก 1+0+0 = ${names.join(" + ")} · ${marks}`;
});

const sheetCols = computed(
  () =>
    `minmax(0, 1fr) repeat(${Math.max(copyBranchOrder.value.length, 1)}, 1.85rem) 2rem 1.35rem`,
);

/** แถวเพิ่ม: ปุ่ม「เพิ่ม」กว้างพอ กดได้ */
const addSheetCols = computed(
  () =>
    `minmax(0, 1fr) repeat(${Math.max(copyBranchOrder.value.length, 1)}, 1.85rem) minmax(3.25rem, 4rem)`,
);

watch(copyBranchOrder, () => {
  if (!board.value) return;
  syncQtyDrafts();
  for (const col of board.value.columns) {
    const cur = addRow.value[col.key];
    if (!cur) {
      ensureAddRow(col.key);
      continue;
    }
    const qtys = { ...cur.qtys };
    for (const br of copyBranchOrder.value) {
      if (qtys[br.id] == null) qtys[br.id] = "";
    }
    addRow.value[col.key] = { ...cur, qtys };
  }
});

function qtyFieldKey(itemKey: string, branchId: string) {
  return `${itemKey}::${branchId}`;
}

function branchQty(
  b: BoardItem["byBranch"][number],
): string {
  if (b.qtyText && b.note && b.qtyText !== b.note) {
    return `${b.qtyText} ${b.note}`.trim();
  }
  return (b.qtyText || b.note || "").trim();
}

function parseLeadingNumber(q: string): number | null {
  const m = q.trim().match(/^(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function sanitizeQtyInput(raw: string): string {
  const cleaned = String(raw ?? "").replace(/[^\d.]/g, "");
  const dot = cleaned.indexOf(".");
  if (dot < 0) return cleaned;
  return cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, "");
}

function syncQtyDrafts() {
  const nextQty: Record<string, string> = {};
  const nextName: Record<string, string> = {};
  if (board.value) {
    for (const col of board.value.columns) {
      for (const item of col.items) {
        nextName[item.key] = item.name;
        for (const br of copyBranchOrder.value) {
          const hit = item.byBranch.find((b) => b.branchId === br.id);
          const q = hit ? branchQty(hit) : "";
          nextQty[qtyFieldKey(item.key, br.id)] = sanitizeQtyInput(q);
        }
      }
    }
  }
  qtyDraft.value = nextQty;
  nameDraft.value = nextName;
}

/**
 * หลังแก้ชื่อ — คงลำดับแถวตามแผงเดิม (อย่ากระโดดตามเรียงชื่อใหม่จาก API)
 * จับคู่ด้วย lineId
 */
function preserveBoardItemOrder(prev: Board | null, next: Board): Board {
  if (!prev) return next;
  const columns = next.columns.map((col) => {
    const prevCol = prev.columns.find((c) => c.key === col.key);
    if (!prevCol?.items.length || !col.items.length) return col;

    const used = new Set<string>();
    const ordered: BoardItem[] = [];
    for (const old of prevCol.items) {
      const oldIds = new Set(old.byBranch.map((b) => b.lineId).filter(Boolean));
      if (!oldIds.size) continue;
      const match = col.items.find((n) => {
        if (used.has(n.key)) return false;
        return n.byBranch.some((b) => oldIds.has(b.lineId));
      });
      if (match) {
        ordered.push(match);
        used.add(match.key);
      }
    }
    for (const n of col.items) {
      if (!used.has(n.key)) ordered.push(n);
    }
    return { ...col, items: ordered };
  });
  return { ...next, columns };
}

function ensureAddRow(colKey: string) {
  if (addRow.value[colKey]) return;
  const qtys: Record<string, string> = {};
  for (const br of copyBranchOrder.value) qtys[br.id] = "";
  addRow.value = {
    ...addRow.value,
    [colKey]: { name: "", qtys },
  };
}

function draftBuyTotal(item: BoardItem): string | null {
  const nums = copyBranchOrder.value
    .map((br) =>
      parseLeadingNumber(qtyDraft.value[qtyFieldKey(item.key, br.id)] ?? ""),
    )
    .filter((n): n is number => n != null);
  if (!nums.length) return null;
  const sum = nums.reduce((a, n) => a + n, 0);
  const text = Number.isInteger(sum)
    ? String(sum)
    : String(Math.round(sum * 100) / 100);
  return `รวม ${text}`;
}

function tinyBranchLabel(name: string) {
  if (/หลุมดิน/.test(name)) return "หลุม";
  if (/เจ็ดเสมียน/.test(name)) return "เจ็ด";
  if (/บ้านฆ้อง|ฆ้อง/.test(name)) return "ฆ้อง";
  return shortBranchName(name).slice(0, 4);
}

/** คงเหลือจากข้อความที่น้องวาง — ไม่ใช้ตัวเลขบนแผง (จำนวนซื้อ) */
const remainingLinesByBranch = computed(() => {
  const map = new Map<string, ParsedPurchaseLine[]>();
  for (const raw of board.value?.raws ?? []) {
    if (!raw.rawText?.trim()) continue;
    map.set(raw.branchId, parsePurchaseText(raw.rawText));
  }
  return map;
});

/** ตัดแท็กสถานะก่อนเทียบ — -หมด- / -สำรอง- / -มี1- / -ขอ2- และรูปแบบเก่า */
function purchaseMatchKey(name: string) {
  const core = name
    .replace(
      /-\s*(หมด|สำรอง|มี\s*\d+(?:\.\d+)?[^-]*?|ขอ\s*\d*(?:\.\d+)?[^-]*?|สั่ง\s*\d*(?:\.\d+)?[^-]*?)\s*-/gu,
      " ",
    )
    .replace(/\s*(สำรอง|หมด)\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim() || name;
  return normalizePurchaseKey(core);
}

function purchaseNamesMatch(a: string, b: string) {
  if (purchaseMatchKey(a) === purchaseMatchKey(b)) return true;
  return purchaseKeysCompatible(a, b) !== "none";
}

/** หาจำนวนที่น้องใส่ท้ายชื่อ (รองรับชื่อที่ถูก map กับแคตตาล็อก) */
function remainingFromPaste(
  itemName: string,
  lines: ParsedPurchaseLine[],
): string | null {
  if (!lines.length) return null;
  let best: { score: number; qty: string } | null = null;
  for (const line of lines) {
    const qty = (line.qtyText || line.note || "").trim();
    if (!qty) continue;
    if (!purchaseNamesMatch(itemName, line.name)) continue;
    if (purchaseMatchKey(itemName) === purchaseMatchKey(line.name)) return qty;
    const key = purchaseMatchKey(itemName);
    const ck = purchaseMatchKey(line.name);
    const score = Math.min(key.length, ck.length);
    if (!best || score > best.score) best = { score, qty };
  }
  return best?.qty ?? null;
}

function pasteMentionsItem(itemName: string, lines: ParsedPurchaseLine[]) {
  return lines.some((line) => purchaseNamesMatch(itemName, line.name));
}

/** เช็ครายการครบไหม — เทียบข้อความน้องกับรายการบนแผงแยกต่อสาขา */
type MissingItem = { name: string; qty: string };
type BranchCheck = {
  branchId: string;
  branchName: string;
  pasteCount: number;
  boardCount: number;
  missing: MissingItem[];
  ok: boolean;
};
const branchChecks = computed<BranchCheck[]>(() => {
  if (!board.value) return [];
  return copyBranchOrder.value.map((br) => {
    const lines = remainingLinesByBranch.value.get(br.id) ?? [];
    // รายการบนแผงของสาขานี้ (เทียบด้วยชื่อหลัก ไม่ติด หมด/สำรอง)
    const boardItems: Array<{ key: string; name: string }> = [];
    for (const col of board.value!.columns) {
      for (const item of col.items) {
        if (item.byBranch.some((b) => b.branchId === br.id && b.lineId)) {
          boardItems.push({
            key: purchaseMatchKey(item.name),
            name: item.name,
          });
        }
      }
    }
    const boardKeys = new Set(boardItems.map((b) => b.key));
    const missing: MissingItem[] = [];
    for (const line of lines) {
      const key = purchaseMatchKey(line.name);
      if (boardKeys.has(key)) continue;
      const found = boardItems.some((b) => purchaseNamesMatch(line.name, b.name));
      if (!found) {
        const status = (line.qtyText || line.note || "").trim();
        missing.push({
          name: line.name,
          qty: status,
        });
      }
    }
    return {
      branchId: br.id,
      branchName: br.name,
      pasteCount: lines.length,
      boardCount: boardKeys.size,
      missing,
      ok: missing.length === 0 && lines.length > 0,
    };
  });
});
const hasAnyPaste = computed(
  () => branchChecks.value.some((c) => c.pasteCount > 0),
);
const allBranchesOk = computed(
  () => hasAnyPaste.value && branchChecks.value.every((c) => c.ok),
);
const checkSummaryText = computed(() => {
  if (!hasAnyPaste.value) return "";
  if (allBranchesOk.value) return "✅ ทุกสาขาครบตามที่น้องสั่ง";
  return branchChecks.value
    .filter((c) => c.pasteCount > 0)
    .map(
      (c) =>
        c.ok
          ? `✅ ${shortBranchName(c.branchName)} ครบ (${c.pasteCount})`
          : `⚠️ ${shortBranchName(c.branchName)} ขาด ${c.missing.length} จาก ${c.pasteCount}`,
    )
    .join(" · ");
});

/** tooltip ต่อรายการสินค้า — เช่น หลุมดิน 3 เจ็ดเสมียน 1 */
function itemStockTip(item: BoardItem) {
  const parts = copyBranchOrder.value
    .map((br) => {
      const lines = remainingLinesByBranch.value.get(br.id) ?? [];
      const q = remainingFromPaste(item.name, lines);
      if (!q) return null;
      return `${shortBranchName(br.name)} ${q}`;
    })
    .filter(Boolean);
  return parts.length ? parts.join(" ") : "—";
}

const floatTip = ref<{
  text: string;
  left: number;
  top: number;
  itemKey: string;
} | null>(null);

function hideItemTip() {
  floatTip.value = null;
}

/** เปิด/ปิดด้วยปุ่มเท่านั้น — ไม่ใช้ hover เพื่อกันปิดตอนลากเลือกข้อความ */
function toggleItemTip(e: MouseEvent, item: BoardItem) {
  e.stopPropagation();
  if (floatTip.value?.itemKey === item.key) {
    hideItemTip();
    return;
  }
  const el = e.currentTarget as HTMLElement;
  const r = el.getBoundingClientRect();
  floatTip.value = {
    text: itemStockTip(item),
    left: r.left + r.width / 2,
    top: r.top - 6,
    itemKey: item.key,
  };
}

function onDocPointerDownCloseTip(e: PointerEvent) {
  if (!floatTip.value) return;
  const t = e.target as HTMLElement | null;
  if (t?.closest?.(".ui-purchase-item-tip")) return;
  hideItemTip();
}

/** Clipboard API มักพังบน Windows/HTTP — มี fallback execCommand */
async function copyTextRobust(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

const vegPreRef = ref<HTMLElement | null>(null);

function selectVegPreText() {
  const pre = vegPreRef.value;
  if (!pre) return;
  const range = document.createRange();
  range.selectNodeContents(pre);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/** หาแถวบนแผงจาก lineId (หลัง rename key เปลี่ยน) */
function findItemByLineId(lineId: string): BoardItem | null {
  if (!board.value || !lineId) return null;
  for (const col of board.value.columns) {
    for (const item of col.items) {
      if (item.byBranch.some((b) => b.lineId === lineId)) return item;
    }
  }
  return null;
}

function findItemByAnyLineId(lineIds: string[]): BoardItem | null {
  for (const id of lineIds) {
    const hit = findItemByLineId(id);
    if (hit) return hit;
  }
  return null;
}

/** Enter ที่ชื่อ — ข้าม blur save ซ้ำ */
let skipRenameBlur = false;

async function saveQty(item: BoardItem, branchId: string) {
  if (!board.value) return;
  // กำลัง rename / เพิ่ง Enter ที่ชื่อ — อย่าให้ blur จำนวนไปลบแถว
  if (nameSavingKey.value || skipRenameBlur) return;

  const hit = item.byBranch.find((b) => b.branchId === branchId);
  // แถวถูก rename แล้ว key เปลี่ยน — blur จาก input เก่าเป็น stale
  if (hit?.lineId) {
    const live = findItemByLineId(hit.lineId);
    if (live && live.key !== item.key) return;
  }

  const key = qtyFieldKey(item.key, branchId);
  const qtyText = sanitizeQtyInput(qtyDraft.value[key] ?? "");
  qtyDraft.value[key] = qtyText;
  const prev = sanitizeQtyInput(hit ? branchQty(hit) : "");
  if (qtyText === prev) return;
  // มีแถวชื่ออย่างเดียวอยู่แล้ว — ช่องว่างตอน blur ต้องไม่ไปลบ
  if (!qtyText && !prev && hit?.lineId) return;

  qtySavingKey.value = key;
  error.value = "";
  try {
    board.value = await post<Board>("/purchases/board-qty", {
      dayId: board.value.day.id,
      day: day.value,
      branchId,
      name: (nameDraft.value[item.key] ?? item.name).trim() || item.name,
      groupKey: item.groupKey,
      catalogId: item.catalogId ?? null,
      lineId: hit?.lineId ?? null,
      qtyText: qtyText || null,
      // แถวที่เคยว่างอยู่แล้ว ถ้ายังว่างต่อ ให้คงไว้บนแผง
      forceCreate: !qtyText && !prev,
    });
    syncQtyDrafts();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "บันทึกจำนวนไม่สำเร็จ";
    qtyDraft.value[key] = prev;
  } finally {
    qtySavingKey.value = null;
  }
}

async function saveName(item: BoardItem) {
  if (!board.value) return;
  const next = (nameDraft.value[item.key] ?? "").trim();
  if (!next) {
    nameDraft.value[item.key] = item.name;
    error.value = "ชื่อสินค้าห้ามว่าง";
    return;
  }
  if (next === item.name) return;

  nameSavingKey.value = item.key;
  error.value = "";
  const prevBoard = board.value;
  try {
    const nextBoard = await post<Board>("/purchases/board-rename", {
      dayId: board.value.day.id,
      day: day.value,
      name: item.name,
      newName: next,
      groupKey: item.groupKey,
      lineIds: item.byBranch.map((b) => b.lineId),
    });
    board.value = preserveBoardItemOrder(prevBoard, nextBoard);
    syncQtyDrafts();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "บันทึกชื่อไม่สำเร็จ";
    nameDraft.value[item.key] = item.name;
  } finally {
    nameSavingKey.value = null;
  }
}

function onRenameBlur(item: BoardItem) {
  // รอให้ mousedown บน suggestion ทำงานก่อนปิด
  window.setTimeout(() => {
    if (skipRenameBlur) return;
    if (suggestKey.value === item.key) suggestKey.value = null;
    void saveName(item);
  }, 120);
}

/** Enter ที่ช่องชื่อ — เซฟชื่อให้จบก่อน แล้วค่อยโฟกัสจำนวน (กันลบแถว) */
async function onNameEnter(e: KeyboardEvent, item: BoardItem) {
  e.preventDefault();
  const lineIds = item.byBranch.map((b) => b.lineId).filter(Boolean);
  skipRenameBlur = true;
  suggestKey.value = null;
  try {
    await saveName(item);
  } finally {
    window.setTimeout(() => {
      skipRenameBlur = false;
    }, 250);
  }
  await nextTick();
  const live = findItemByAnyLineId(lineIds) ??
    board.value?.columns
      .flatMap((c) => c.items)
      .find((i) => i.name === (nameDraft.value[item.key] ?? item.name).trim()) ??
    null;
  const firstBr = copyBranchOrder.value[0];
  if (!live || !firstBr) return;
  const qtyEl = document.querySelector<HTMLInputElement>(
    `input[data-sheet-qty="${qtyFieldKey(live.key, firstBr.id)}"]`,
  );
  if (qtyEl) {
    qtyEl.focus();
    qtyEl.select();
  }
}

function onAddNameBlur(colKey: string) {
  window.setTimeout(() => {
    if (suggestKey.value === `add:${colKey}`) suggestKey.value = null;
  }, 120);
}

function onQtyInput(itemKey: string, branchId: string, e: Event) {
  const el = e.target as HTMLInputElement;
  const v = sanitizeQtyInput(el.value);
  qtyDraft.value[qtyFieldKey(itemKey, branchId)] = v;
  if (el.value !== v) el.value = v;
}

function onAddQtyInput(colKey: string, branchId: string, e: Event) {
  ensureAddRow(colKey);
  const el = e.target as HTMLInputElement;
  const v = sanitizeQtyInput(el.value);
  const cur = addRow.value[colKey];
  if (!cur) return;
  addRow.value = {
    ...addRow.value,
    [colKey]: { ...cur, qtys: { ...cur.qtys, [branchId]: v } },
  };
  if (el.value !== v) el.value = v;
}

/** Enter = ไปช่องถัดไปในคอลัมน์ (เหมือน Excel) · blur จะเซฟให้ */
function onSheetEnter(e: KeyboardEvent, colKey?: string) {
  e.preventDefault();
  const cur = e.target as HTMLInputElement;
  const sheet = cur.closest(".ui-purchase-sheet");
  if (!sheet) {
    cur.blur();
    return;
  }

  // แถวเพิ่ม: Enter ที่ช่องชื่อ = เพิ่มรายการเลย (จำนวนว่างได้) แล้วโฟกัสชื่อต่อ
  if (
    colKey &&
    cur.closest(".ui-purchase-sheet__row--add") &&
    cur.classList.contains("ui-purchase-sheet__add-name")
  ) {
    void submitAddRow(colKey).then(() => {
      sheet
        .querySelector<HTMLInputElement>(".ui-purchase-sheet__add-name")
        ?.focus();
    });
    return;
  }

  const inputs = Array.from(
    sheet.querySelectorAll<HTMLInputElement>("input[data-sheet-nav]"),
  ).filter((el) => !el.disabled);
  const idx = inputs.indexOf(cur);
  if (idx < 0) {
    cur.blur();
    return;
  }
  const next = inputs[idx + 1];
  if (next) {
    next.focus();
    next.select();
    return;
  }
  // ช่องจำนวนสุดท้ายของแถวเพิ่ม → บันทึกแถวใหม่ แล้วโฟกัสชื่อใหม่
  if (colKey && cur.closest(".ui-purchase-sheet__row--add")) {
    void submitAddRow(colKey).then(() => {
      sheet
        .querySelector<HTMLInputElement>(".ui-purchase-sheet__add-name")
        ?.focus();
    });
    return;
  }
  cur.blur();
}

async function submitAddRow(
  colKey: string,
  opts?: { name?: string; groupKey?: string; catalogId?: string | null },
) {
  if (!board.value) return;
  ensureAddRow(colKey);
  const draft = addRow.value[colKey];
  const name = (opts?.name ?? draft.name).trim();
  if (!name) {
    error.value = "ใส่ชื่อสินค้าก่อน";
    return;
  }
  // จากพักกลาง + เลือกชื่อมาตรฐาน → ใส่คอลัมน์ตามแคตตาล็อก
  const groupKey = opts?.groupKey ?? colKey;
  const catalogId = opts?.catalogId ?? null;
  const jobs = copyBranchOrder.value.filter((br) =>
    (draft.qtys[br.id] ?? "").trim(),
  );
  const anchorBranch = copyBranchOrder.value[0];
  if (!anchorBranch) {
    error.value = "ยังไม่มีสาขา";
    return;
  }

  saving.value = true;
  error.value = "";
  message.value = "";
  suggestKey.value = null;
  try {
    let last: Board | null = null;

    if (!jobs.length) {
      last = await post<Board>("/purchases/board-qty", {
        dayId: board.value.day.id,
        day: day.value,
        branchId: anchorBranch.id,
        name,
        groupKey,
        catalogId,
        qtyText: null,
        forceCreate: true,
      });
    } else {
      for (const br of jobs) {
        last = await post<Board>("/purchases/board-qty", {
          dayId: board.value.day.id,
          day: day.value,
          branchId: br.id,
          name,
          groupKey,
          catalogId,
          qtyText: sanitizeQtyInput(draft.qtys[br.id]),
          forceCreate: true,
        });
      }
    }

    if (last) board.value = last;
    syncQtyDrafts();
    ensureAddRow(colKey);
    ensureAddRow(groupKey);
    addRow.value = {
      ...addRow.value,
      [colKey]: {
        name: "",
        qtys: Object.fromEntries(copyBranchOrder.value.map((b) => [b.id, ""])),
      },
    };
    const where =
      groupKey !== colKey
        ? ` → ${GROUP_LABEL[groupKey] ?? groupKey}`
        : "";
    message.value = jobs.length
      ? `เพิ่ม「${name}」บนแผงแล้ว${where}`
      : `เพิ่ม「${name}」บนแผงแล้ว${where} · กรอกจำนวนเมื่อพร้อม`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "เพิ่มรายการไม่สำเร็จ";
  } finally {
    saving.value = false;
  }
}

async function pickAddCatalog(colKey: string, cat: CatalogSuggest) {
  ensureAddRow(colKey);
  const cur = addRow.value[colKey];
  if (cur) {
    addRow.value = {
      ...addRow.value,
      [colKey]: { ...cur, name: cat.name },
    };
  }
  const dest = colKey === "pending" ? cat.groupKey : colKey;
  await submitAddRow(colKey, {
    name: cat.name,
    groupKey: dest,
    catalogId: cat.id,
  });
}

async function pickRenameCatalog(item: BoardItem, cat: CatalogSuggest) {
  if (!board.value) return;
  nameDraft.value[item.key] = cat.name;
  suggestKey.value = null;
  nameSavingKey.value = item.key;
  error.value = "";
  const prevBoard = board.value;
  try {
    if (cat.name !== item.name) {
      const nextBoard = await post<Board>("/purchases/board-rename", {
        dayId: board.value.day.id,
        day: day.value,
        name: item.name,
        newName: cat.name,
        groupKey: item.groupKey,
        lineIds: item.byBranch.map((b) => b.lineId),
      });
      board.value = preserveBoardItemOrder(prevBoard, nextBoard);
    }
    if (cat.groupKey && cat.groupKey !== item.groupKey && cat.groupKey !== "pending") {
      const moved: BoardItem = {
        ...item,
        name: cat.name,
        key: normalizePurchaseKey(cat.name) || item.key,
      };
      // หา item ใหม่หลัง rename
      const refreshed =
        board.value.columns
          .flatMap((c) => c.items)
          .find(
            (i) =>
              i.name === cat.name &&
              (i.groupKey === item.groupKey ||
                i.byBranch.some((b) =>
                  item.byBranch.some((x) => x.lineId === b.lineId),
                )),
          ) ?? moved;
      await moveItem(refreshed, cat.groupKey);
    } else {
      syncQtyDrafts();
      message.value = `ใช้ชื่อมาตรฐาน「${cat.name}」แล้ว`;
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : "เลือกชื่อมาตรฐานไม่สำเร็จ";
    nameDraft.value[item.key] = item.name;
  } finally {
    nameSavingKey.value = null;
  }
}

async function removeItem(item: BoardItem) {
  if (!board.value) return;
  const ok = await askConfirm({
    title: "ไม่ซื้อรายการนี้",
    message: `เอา「${item.name}」ออกจากแผงสรุป?`,
    detail: "ลบทุกสาขาของรายการนี้ในวันนี้ · ข้อความที่วางไว้ยังอยู่ ถ้าจัดใหม่จะกลับมา",
    confirmLabel: "ลบออก",
  });
  if (!ok) return;
  saving.value = true;
  error.value = "";
  try {
    board.value = await post<Board>("/purchases/board-remove", {
      dayId: board.value.day.id,
      day: day.value,
      name: item.name,
      groupKey: item.groupKey,
      lineIds: item.byBranch.map((b) => b.lineId),
    });
    syncQtyDrafts();
    message.value = `ลบ「${item.name}」ออกจากแผงแล้ว`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "ลบไม่สำเร็จ";
  } finally {
    saving.value = false;
  }
}

/** ล้างแผงทั้งวันนี้ — รายการ + ข้อความวาง แล้วค่อยวางใหม่ */
async function clearBoardDay() {
  if (!board.value) return;
  const n = board.value.lineCount;
  const ok = await askConfirm({
    title: "ล้างแผงวันนี้ทั้งหมด?",
    message: `ลบรายการซื้อของวันที่ ${formatDayLabel(day.value)} ทั้งหมด${n ? ` (${n} รายการ)` : ""}`,
    detail: "ลบทั้งแผงสรุปและข้อความที่วางจากสาขา · ใช้ตอนแผงมั่ว แล้ววางใหม่ได้เลย · ไม่กระทบแคตตาล็อกสินค้า",
    confirmLabel: "ล้างแผงวันนี้",
  });
  if (!ok) return;
  saving.value = true;
  error.value = "";
  message.value = "";
  try {
    board.value = await post<Board>("/purchases/board-clear", {
      dayId: board.value.day.id,
      day: day.value,
    });
    pasteByBranch.value = Object.fromEntries(
      branches.value.map((b) => [b.id, ""]),
    );
    syncQtyDrafts();
    message.value = "ล้างแผงวันนี้แล้ว · วางรายการจากสาขาใหม่ได้";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "ล้างแผงไม่สำเร็จ";
  } finally {
    saving.value = false;
  }
}

function shortBranchName(name: string) {
  if (/หลุมดิน/.test(name)) return "หลุมดิน";
  if (/เจ็ดเสมียน/.test(name)) return "เจ็ดเสมียน";
  if (/บ้านฆ้อง|ฆ้อง/.test(name)) return "บ้านฆ้อง";
  return name.replace(/^สาขา\s*/u, "").trim() || name;
}

/** ตัด (01)/(02)/(03) ท้ายชื่อ — สรุปไลน์ไม่โชว์ */
function stripBranchMark(name: string) {
  return name
    .replace(/(?:\s*[\(（]\s*0?[123]\s*[\)）])+\s*$/u, "")
    .trim();
}

function branchHasOrder(item: BoardItem, branchId: string): boolean {
  if (itemQtyForBranch(item, branchId)) return true;
  if (item.byBranch.some((b) => b.branchId === branchId)) return true;
  const lines = remainingLinesByBranch.value.get(branchId) ?? [];
  return pasteMentionsItem(item.name, lines);
}

/** หลุมดิน (01) · เจ็ดเสมียน (02) · บ้านฆ้อง (03) */
function itemBranchMark(item: BoardItem): string {
  const parts: string[] = [];
  for (const br of copyBranchOrder.value) {
    if (!branchHasOrder(item, br.id)) continue;
    if (/หลุมดิน/.test(br.name)) parts.push("(01)");
    else if (/เจ็ดเสมียน/.test(br.name)) parts.push("(02)");
    else if (/บ้านฆ้อง|ฆ้อง/.test(br.name)) parts.push("(03)");
  }
  return parts.join(" ");
}

/** คัดลอกจำนวน: เสมอครบทุกสาขา เช่น 1+0+0 / 0+0+1 */
function formatCopyQty(item: BoardItem): string {
  const order = copyBranchOrder.value;
  if (!order.length) {
    return item.byBranch
      .map((b) => branchQty(b))
      .filter(Boolean)
      .join("+");
  }
  const qtys = order.map((br) => {
    const key = qtyFieldKey(item.key, br.id);
    if (Object.prototype.hasOwnProperty.call(qtyDraft.value, key)) {
      return String(qtyDraft.value[key] ?? "").trim();
    }
    const hit = item.byBranch.find((b) => b.branchId === br.id);
    return hit ? branchQty(hit) : "";
  });
  if (order.length >= 2) {
    // เสมอครบทุกสาขา — ไม่กรอก = 0 เช่น 0+0+0 / 1+0+1
    return qtys.map((q) => q || "0").join("+");
  }
  return qtys[0] || "0";
}

function shiftDay(delta: number) {
  const d = new Date(`${day.value}T12:00:00`);
  d.setDate(d.getDate() + delta);
  day.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDayLabel(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("th-TH", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function findItem(key: string): BoardItem | null {
  if (!board.value) return null;
  for (const col of board.value.columns) {
    const hit = col.items.find((i) => i.key === key);
    if (hit) return hit;
  }
  return null;
}

function applyLocalMove(item: BoardItem, groupKey: string) {
  if (!board.value || item.groupKey === groupKey) return;
  for (const col of board.value.columns) {
    col.items = col.items.filter((i) => i.key !== item.key);
  }
  const target = board.value.columns.find((c) => c.key === groupKey);
  if (target) {
    target.items.push({ ...item, groupKey, matched: true });
    target.items.sort((a, b) => a.name.localeCompare(b.name, "th"));
  }
}

async function loadBranches() {
  const data = await get<{ branches: Array<Branch & { active?: boolean }> }>(
    "/branches",
  );
  branches.value = (data.branches ?? []).filter((b) => b.active !== false);
  for (const b of branches.value) {
    if (pasteByBranch.value[b.id] == null) {
      pasteByBranch.value[b.id] = "";
    }
  }
}

function syncPasteFromBoard() {
  const next: Record<string, string> = { ...pasteByBranch.value };
  for (const b of branches.value) {
    const raw = board.value?.raws.find((r) => r.branchId === b.id);
    next[b.id] = raw?.rawText ?? "";
  }
  pasteByBranch.value = next;
}

async function loadDays() {
  try {
    const data = await get<{ days: Array<{ id: string; day: string }> }>(
      "/purchases/days",
    );
    recentDays.value = (data.days ?? []).slice(0, 14);
  } catch {
    recentDays.value = [];
  }
}

async function loadBoard() {
  pending.value = true;
  error.value = "";
  try {
    board.value = await get<Board>(`/purchases/board?day=${day.value}`);
    syncPasteFromBoard();
    syncQtyDrafts();
    for (const col of board.value.columns) ensureAddRow(col.key);
    await Promise.all([loadDays(), loadCatalogSuggest()]);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "โหลดไม่สำเร็จ";
    board.value = null;
  } finally {
    pending.value = false;
  }
}

async function ingest() {
  const jobs = branches.value.filter((b) =>
    (pasteByBranch.value[b.id] ?? "").trim(),
  );
  if (!jobs.length) {
    error.value = "วางข้อความอย่างน้อย 1 สาขาก่อน";
    return;
  }
  saving.value = true;
  error.value = "";
  message.value = "";
  try {
    let last: Board | null = null;
    const names: string[] = [];
    for (const b of jobs) {
      last = await post<Board>("/purchases/ingest", {
        day: day.value,
        branchId: b.id,
        branchLabel: b.name,
        rawText: pasteByBranch.value[b.id],
      });
      names.push(b.name);
    }
    if (last) board.value = last;
    syncQtyDrafts();
    message.value = `รับรายการจาก ${names.join(" · ")} แล้ว · รวม ${last?.lineCount ?? 0} บรรทัด`;
    await loadDays();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "บันทึกไม่สำเร็จ";
  } finally {
    saving.value = false;
  }
}

async function moveItem(item: BoardItem, groupKey: string) {
  if (item.groupKey === groupKey) return;
  const snapshot = board.value
    ? (JSON.parse(JSON.stringify(board.value)) as Board)
    : null;
  applyLocalMove(item, groupKey);
  saving.value = true;
  error.value = "";
  try {
    let last: Board | null = null;
    for (const br of item.byBranch) {
      last = await post<Board>("/purchases/lines/update", {
        id: br.lineId,
        groupKey,
      });
    }
    if (last) board.value = last;
    syncQtyDrafts();
    message.value = `ย้าย「${item.name}」แล้ว`;
  } catch (e) {
    if (snapshot) board.value = snapshot;
    error.value = e instanceof Error ? e.message : "ย้ายไม่สำเร็จ";
  } finally {
    saving.value = false;
  }
}

function onItemDragStart(item: BoardItem, e: DragEvent) {
  gripDragged = true;
  movePickKey.value = null;
  dragItemKey.value = item.key;
  e.dataTransfer?.setData("text/plain", item.key);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
}

function onItemDragEnd() {
  dragItemKey.value = null;
  dragOverCol.value = null;
}

function onGripClick(item: BoardItem) {
  if (gripDragged) {
    gripDragged = false;
    return;
  }
  movePickKey.value = movePickKey.value === item.key ? null : item.key;
}

function moveTargets(item: BoardItem) {
  return board.value?.columns.filter((c) => c.key !== item.groupKey) ?? [];
}

function cancelMovePick() {
  movePickKey.value = null;
}

async function placeMovePick(colKey: string) {
  const key = movePickKey.value;
  if (!key) return;
  const item = findItem(key);
  movePickKey.value = null;
  if (!item) return;
  await moveItem(item, colKey);
}

function onMovePickKey(e: KeyboardEvent) {
  if (e.key === "Escape") cancelMovePick();
}

function onColDragOver(colKey: string, e: DragEvent) {
  e.preventDefault();
  dragOverCol.value = colKey;
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
}

function onColDragLeave(colKey: string, e: DragEvent) {
  const related = e.relatedTarget as Node | null;
  const current = e.currentTarget as HTMLElement;
  if (related && current.contains(related)) return;
  if (dragOverCol.value === colKey) dragOverCol.value = null;
}

async function onColDrop(colKey: string, e: DragEvent) {
  e.preventDefault();
  const key = dragItemKey.value || e.dataTransfer?.getData("text/plain") || "";
  dragItemKey.value = null;
  dragOverCol.value = null;
  if (!key) return;
  const item = findItem(key);
  if (!item) return;
  await moveItem(item, colKey);
}

function formatCopyLine(item: BoardItem) {
  const name = stripBranchMark(item.name);
  const q = formatCopyQty(item);
  const mark = itemBranchMark(item);
  const core = q ? `${name} ${q}` : name;
  return mark ? `${core} ${mark}` : core;
}

async function copyColumn(col: Column) {
  const text = orderedColumnItems(col.items)
    .map((i) => formatCopyLine(i))
    .join("\n");
  const ok = await copyTextRobust(text);
  message.value = ok
    ? `คัดลอกคอลัมน์ ${col.label} แล้ว`
    : "คัดลอกไม่สำเร็จ — ลองเลือกข้อความแล้ว Ctrl+C";
}

const summaryOpen = ref(false);

const SUMMARY_HEADERS: Record<string, string> = {
  meatball: "ลูกชิ้น",
  market: "ตลาด",
  veg: "ผัก",
  transfer: "ส่งสาขา",
  makro: "แม็คโค",
  pending: "ร้านในตลาด",
};

const vegColumn = computed(
  () => board.value?.columns.find((c) => c.key === "veg") ?? null,
);

const vegOpen = ref(false);
const vegHint = ref("");

/** รายชื่อผักอย่างเดียว — ไม่มีเลขสาขา */
const vegNameLines = computed(() => {
  const col = vegColumn.value;
  if (!col?.items.length) return [] as string[];
  return orderedColumnItems(col.items)
    .map((i) => stripBranchMark(i.name))
    .filter(Boolean);
});

const vegShareText = computed(() => vegNameLines.value.join("\n"));

function openVegShare() {
  error.value = "";
  vegHint.value = "";
  if (!vegNameLines.value.length) {
    message.value = "ยังไม่มีรายการร้านผักวันนี้";
    error.value = "ยังไม่มีรายการในกลุ่มผัก — จัดเข้าแผงก่อน";
    return;
  }
  vegOpen.value = true;
}

async function copyVegNamesOnly() {
  const text = vegShareText.value;
  if (!text) {
    vegHint.value = "ยังไม่มีรายการ";
    return;
  }
  const ok = await copyTextRobust(text);
  if (ok) {
    vegHint.value = `คัดลอกแล้ว ${vegNameLines.value.length} รายการ · วางในไลน์ได้`;
    message.value = vegHint.value;
    error.value = "";
    return;
  }
  selectVegPreText();
  vegHint.value = "เลือกข้อความไว้แล้ว — กด Ctrl+C (วินโดว์) หรือ Cmd+C";
  error.value = vegHint.value;
}

function summaryHeader(col: Column) {
  return SUMMARY_HEADERS[col.key] ?? col.label;
}

type ShareLine = {
  name: string;
  qty: string;
  kind: "lumdin" | "chetsamian" | "bankhong";
};
type SummaryColumn = Column & { lines: ShareLine[] };

function itemQtyForBranch(item: BoardItem, branchId: string): string {
  const key = qtyFieldKey(item.key, branchId);
  if (Object.prototype.hasOwnProperty.call(qtyDraft.value, key)) {
    return String(qtyDraft.value[key] ?? "").trim();
  }
  const hit = item.byBranch.find((b) => b.branchId === branchId);
  return hit ? branchQty(hit) : "";
}

/** หลุมดิน/(หลายสาขา) บน · เจ็ดเสมียนอย่างเดียวกลาง · บ้านฆ้องอย่างเดียวล่าง */
function itemShareKind(item: BoardItem): ShareLine["kind"] {
  let hasLumdin = false;
  let hasChet = false;
  let hasBk = false;
  for (const br of copyBranchOrder.value) {
    if (!branchHasOrder(item, br.id)) continue;
    if (/หลุมดิน/.test(br.name)) hasLumdin = true;
    else if (/เจ็ดเสมียน/.test(br.name)) hasChet = true;
    else if (/บ้านฆ้อง|ฆ้อง/.test(br.name)) hasBk = true;
  }
  if (hasLumdin) return "lumdin";
  if (hasChet) return "chetsamian";
  if (hasBk) return "bankhong";
  return "lumdin";
}

/** เรียงเหมือนสรุปส่งไลน์: หลุม → เจ็ดอย่างเดียว → บ้านฆ้องอย่างเดียว */
function orderedColumnItems(items: BoardItem[]) {
  const top: BoardItem[] = [];
  const mid: BoardItem[] = [];
  const bottom: BoardItem[] = [];
  for (const item of items) {
    const kind = itemShareKind(item);
    if (kind === "bankhong") bottom.push(item);
    else if (kind === "chetsamian") mid.push(item);
    else top.push(item);
  }
  return [...top, ...mid, ...bottom];
}

function formatShareLine(line: ShareLine) {
  const name = stripBranchMark(line.name);
  return line.qty ? `${name} ${line.qty}` : name;
}

/** คอลัมน์สรุปส่งไลน์ — หลุมดิน/ทั้งสองสาขาอยู่บน · เจ็ดเสมียนอย่างเดียวอยู่ล่าง */
const summaryColumns = computed((): SummaryColumn[] => {
  if (!board.value) return [];
  return board.value.columns
    .filter((col) => col.key !== "pending" && col.items.length > 0)
    .map((col) => {
      const lumdin: ShareLine[] = [];
      const chet: ShareLine[] = [];
      const bankhong: ShareLine[] = [];
      for (const item of orderedColumnItems(col.items)) {
        const line: ShareLine = {
          name: stripBranchMark(item.name),
          qty: formatCopyQty(item),
          kind: itemShareKind(item),
        };
        if (line.kind === "bankhong") bankhong.push(line);
        else if (line.kind === "chetsamian") chet.push(line);
        else lumdin.push(line);
      }
      return { ...col, lines: [...lumdin, ...chet, ...bankhong] };
    })
    .filter((col) => col.lines.length > 0);
});

const summaryRowCount = computed(() => {
  if (!summaryColumns.value.length) return 0;
  return Math.max(0, ...summaryColumns.value.map((c) => c.lines.length));
});

function openSummary() {
  if (!board.value) return;
  summaryOpen.value = true;
  captureHint.value = "";
}

const shareCaptureRef = ref<HTMLElement | null>(null);
const capturing = ref(false);
const captureHint = ref("");

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function captureSummary() {
  const el = shareCaptureRef.value;
  if (!el || capturing.value) return;
  capturing.value = true;
  captureHint.value = "";
  error.value = "";
  try {
    await nextTick();
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    const blob = await toBlob(el, {
      backgroundColor: "#ffffff",
      pixelRatio: 2,
      cacheBust: true,
    });
    if (!blob) throw new Error("สร้างรูปไม่สำเร็จ");

    let copied = false;
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
        copied = true;
      } catch {
        copied = false;
      }
    }

    downloadBlob(blob, `ซื้อของ-${day.value}.png`);
    captureHint.value = copied
      ? "แคปแล้ว · วางในไลน์ได้ (Ctrl/Cmd+V) · ดาวน์โหลดแล้ว"
      : "แคปแล้ว · ดาวน์โหลดรูปแล้ว ส่งในไลน์ได้";
    message.value = captureHint.value;
  } catch (e) {
    captureHint.value = e instanceof Error ? e.message : "แคปไม่สำเร็จ";
    error.value = captureHint.value;
  } finally {
    capturing.value = false;
  }
}

async function copySummarySheet() {
  if (!summaryColumns.value.length) return;
  const cols = summaryColumns.value;
  const rows = summaryRowCount.value;
  const lines = [cols.map((c) => summaryHeader(c)).join("\t")];
  for (let r = 0; r < rows; r += 1) {
    lines.push(
      cols
        .map((c) => {
          const line = c.lines[r];
          return line ? formatShareLine(line) : "";
        })
        .join("\t"),
    );
  }
  const ok = await copyTextRobust(lines.join("\n"));
  message.value = ok
    ? "คัดลอกแผ่นสรุปแล้ว"
    : "คัดลอกไม่สำเร็จ — ลองเลือกข้อความแล้ว Ctrl+C";
}

watch(day, () => {
  void loadBoard();
});

watch(movePickKey, (key) => {
  if (key) window.addEventListener("keydown", onMovePickKey);
  else window.removeEventListener("keydown", onMovePickKey);
});

onMounted(async () => {
  document.addEventListener("pointerdown", onDocPointerDownCloseTip, true);
  await loadBranches();
  await loadBoard();
});

onUnmounted(() => {
  window.removeEventListener("keydown", onMovePickKey);
  document.removeEventListener("pointerdown", onDocPointerDownCloseTip, true);
});
</script>

<template>
  <div class="ui-purchase-page">
    <div class="ui-page-head">
      <div>
        <h1 class="ui-page-title">รายการซื้อของ</h1>
        <p class="ui-page-sub">
          จำนวนในแผง = ยอดที่ต้องซื้อ แยกให้แต่ละสาขา · ลากย้ายร้านได้ · คัดลอกไปซื้อ
          <template v-if="copyLegend"> · {{ copyLegend }}</template>
        </p>
      </div>
      <div class="ui-page-head__actions">
        <button
          type="button"
          class="ui-btn ui-btn--primary"
          :disabled="!board || !board.lineCount"
          @click="openSummary"
        >
          สรุปส่งไลน์
        </button>
        <button
          type="button"
          class="ui-btn ui-btn--ghost"
          :disabled="!board"
          title="เปิดรายการกลุ่มผัก (เฉพาะชื่อ ไม่ติดเลขสาขา)"
          @click="openVegShare"
        >
          ส่งร้านผัก
        </button>
        <button
          type="button"
          class="ui-btn ui-btn--ghost"
          :disabled="!board || saving || (!board.lineCount && !pasteFilledCount)"
          title="ลบแผงวันนี้ทั้งหมด แล้ววางใหม่"
          @click="clearBoardDay"
        >
          ล้างแผงวันนี้
        </button>
        <NuxtLink to="/purchases/order" class="ui-btn ui-btn--ghost">
          สั่งของมือถือ
        </NuxtLink>
        <NuxtLink to="/purchases/catalog" class="ui-btn ui-btn--ghost">
          ตั้งค่าชื่อสินค้า→ร้าน
        </NuxtLink>
        <button type="button" class="ui-btn ui-btn--ghost" :disabled="pending" @click="loadBoard">
          {{ pending ? "กำลังโหลด..." : "รีเฟรช" }}
        </button>
      </div>
    </div>

    <div class="ui-card ui-report-filters">
      <div class="ui-field">
        <span>ดูรายการของวัน</span>
        <div class="ui-purchase-daybar">
          <button type="button" class="ui-btn ui-btn--ghost" title="วันก่อน" @click="shiftDay(-1)">
            ‹ วันก่อน
          </button>
          <UiDateInput
            class="ui-purchase-daybar__date"
            :model-value="day"
            aria-label="วันที่"
            @update:model-value="day = $event"
          />
          <button type="button" class="ui-btn ui-btn--ghost" title="วันถัดไป" @click="shiftDay(1)">
            วันถัดไป ›
          </button>
          <button
            type="button"
            class="ui-btn ui-btn--ghost"
            :class="{ 'ui-btn--primary': day === todayIso() }"
            @click="day = todayIso()"
          >
            วันนี้
          </button>
          <p class="ui-field-hint" style="margin: 0">
            <template v-if="board">
              {{ formatDayLabel(day) }} · {{ board.lineCount }} รายการ · ยังไม่ map
              {{ board.unmatched }}
              <template v-if="branchCountLegend">
                · {{ branchCountLegend }}
              </template>
            </template>
            <template v-else>เลือกวันแล้ววางข้อความจากน้อง</template>
          </p>
        </div>
      </div>
      <div v-if="recentDays.length" class="ui-purchase-daychips">
        <button
          v-for="d in recentDays"
          :key="d.id"
          type="button"
          class="ui-purchase-daychip"
          :class="{ 'ui-purchase-daychip--active': d.day === day }"
          @click="day = d.day"
        >
          {{ formatDayLabel(d.day) }}
        </button>
      </div>
    </div>

    <div class="ui-card" style="margin-top: 1rem">
      <div class="ui-card__toolbar ui-purchase-collapse-bar">
        <button
          type="button"
          class="ui-purchase-collapse-btn"
          :aria-expanded="!pasteCollapsed"
          @click="togglePaste"
        >
          <span class="ui-purchase-collapse-chevron" aria-hidden="true">
            {{ pasteCollapsed ? "▸" : "▾" }}
          </span>
          <span class="ui-toolbar-meta ui-toolbar-meta--alone">
            1) วางรายการจากสาขา
            <template v-if="pasteCollapsed && pasteFilledCount">
              · มีข้อความ {{ pasteFilledCount }} สาขา
              <template v-if="branchCountLegend"> · {{ branchCountLegend }}</template>
            </template>
          </span>
        </button>
      </div>
      <div
        v-show="!pasteCollapsed"
        class="ui-modal__body"
        style="padding-top: 0.75rem"
      >
        <div class="ui-purchase-pastes">
          <label
            v-for="b in copyBranchOrder"
            :key="b.id"
            class="ui-field ui-purchase-paste"
          >
            <span>
              {{ b.code }} — {{ b.name }}
              <template v-if="pasteItemCount(b.id)">
                · {{ pasteItemCount(b.id) }} รายการ
              </template>
            </span>
            <textarea
              v-model="pasteByBranch[b.id]"
              class="ui-input"
              rows="6"
              placeholder="วางข้อความจากน้องที่นี่&#10;เช่น&#10;เห็ดเข็ม9&#10;ผักบุ้ง5"
            />
          </label>
        </div>
        <div
          v-if="!branches.length"
          class="ui-field-hint"
          style="margin-top: 0.5rem"
        >
          ยังไม่มีสาขา — เพิ่มสาขาในเมนูสาขาก่อน
        </div>
        <div style="margin-top: 0.75rem; display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center">
          <button
            type="button"
            class="ui-btn ui-btn--primary"
            :disabled="saving || !pasteFilledCount"
            @click="ingest"
          >
            {{
              saving
                ? "กำลังจัด..."
                : pasteFilledCount
                  ? `จัดเข้าแผงสรุป (${pasteFilledCount} สาขา)`
                  : "จัดเข้าแผงสรุป"
            }}
          </button>
          <span class="ui-field-hint">
            วางทีละช่องตามสาขา · วางใหม่ทับของสาขานั้น
          </span>
        </div>
      </div>
    </div>

    <div v-if="error" class="ui-empty">{{ error }}</div>
    <div v-else-if="message" class="ui-empty" style="color: #166534">{{ message }}</div>

    <!-- เช็ครายการครบไหม -->
    <div v-if="hasAnyPaste && board" class="ui-purchase-check" :class="{ 'is-ok': allBranchesOk }">
      <div class="ui-purchase-check__summary">{{ checkSummaryText }}</div>
      <template v-for="c in branchChecks" :key="c.branchId">
        <div v-if="c.missing.length" class="ui-purchase-check__branch">
          <strong>{{ shortBranchName(c.branchName) }} — ขาด {{ c.missing.length }} รายการ:</strong>
          <ul>
            <li v-for="(m, i) in c.missing" :key="i">
              {{ m.name }}<template v-if="m.qty"> · {{ m.qty }}</template>
            </li>
          </ul>
        </div>
      </template>
    </div>

    <p v-if="board" class="ui-field-hint" style="margin: 0.85rem 0 0">
      แผงสรุป · หลุมดินอยู่บน · เจ็ดเสมียน / บ้านฆ้องอยู่ล่าง
      <template v-if="branchCountLegend"> · {{ branchCountLegend }}</template>
      · กด ⓘ ดูคงเหลือ · <strong>Enter</strong> ที่ชื่อ = เพิ่มรายการ · ที่จำนวน = ช่องถัดไป · คลิก ⋮⋮ ย้ายคอลัมน์
      <template v-if="copyLegend"> · {{ copyLegend }}</template>
    </p>

    <div v-if="board" class="ui-purchase-board">
      <div
        v-for="col in board.columns"
        :key="col.key"
        class="ui-purchase-col"
        :class="{
          'ui-purchase-col--drop': dragOverCol === col.key,
          'ui-purchase-col--collapsed': isColCollapsed(col.key),
          'ui-purchase-col--pending': col.key === 'pending',
        }"
        @dragover="onColDragOver(col.key, $event)"
        @dragleave="onColDragLeave(col.key, $event)"
        @drop="onColDrop(col.key, $event)"
      >
        <div class="ui-purchase-col__head">
          <button
            type="button"
            class="ui-purchase-col__toggle"
            :aria-expanded="!isColCollapsed(col.key)"
            :title="isColCollapsed(col.key) ? 'แสดง' : 'ซ่อน'"
            @click="toggleCol(col.key)"
          >
            <span aria-hidden="true">{{ isColCollapsed(col.key) ? "▸" : "▾" }}</span>
            <div>
              <strong>{{ col.label }}</strong>
              <span>{{ col.hint }} · {{ col.items.length }}</span>
            </div>
          </button>
          <button
            type="button"
            class="ui-btn ui-btn--ghost"
            :disabled="!col.items.length"
            @click="copyColumn(col)"
          >
            คัดลอก
          </button>
        </div>

        <div
          v-show="!isColCollapsed(col.key)"
          class="ui-purchase-sheet"
          :data-col-key="col.key"
          @scroll="hideItemTip"
        >
          <div
            class="ui-purchase-sheet__head"
            :style="{ gridTemplateColumns: sheetCols }"
          >
            <span>สินค้า</span>
            <span
              v-for="br in copyBranchOrder"
              :key="br.id"
              :title="`${br.name} · ${boardItemCount(br.id)} รายการ`"
            >{{ tinyBranchLabel(br.name) }}</span>
            <span title="รวม">รวม</span>
            <span />
          </div>

          <div
            v-for="item in orderedColumnItems(col.items)"
            :key="item.key"
            class="ui-purchase-sheet__block"
            :class="{
              'is-dragging': dragItemKey === item.key,
              'is-picked': movePickKey === item.key,
              'is-chetsamian': itemShareKind(item) === 'chetsamian',
              'is-bankhong': itemShareKind(item) === 'bankhong',
            }"
          >
          <div
            class="ui-purchase-sheet__row"
            :style="{ gridTemplateColumns: sheetCols }"
          >
            <div class="ui-purchase-sheet__name">
              <span
                class="ui-purchase-item__grip"
                role="button"
                tabindex="0"
                draggable="true"
                title="คลิกเพื่อย้ายคอลัมน์ · หรือลากวาง"
                :aria-pressed="movePickKey === item.key"
                @dragstart="onItemDragStart(item, $event)"
                @dragend="onItemDragEnd"
                @click="onGripClick(item)"
                @keydown.enter.prevent="onGripClick(item)"
                @keydown.space.prevent="onGripClick(item)"
              >
                ⋮⋮
              </span>
              <div class="ui-purchase-suggest">
                <input
                  v-model="nameDraft[item.key]"
                  class="ui-purchase-sheet__name-input"
                  type="text"
                  data-sheet-nav
                  autocomplete="off"
                  :disabled="nameSavingKey === item.key"
                  :title="item.matched ? '' : 'ยังไม่ map · พิมพ์เลือกชื่อมาตรฐาน'"
                  @mousedown.stop
                  @focus="suggestKey = item.key"
                  @input="suggestKey = item.key"
                  @keydown.enter.prevent="onNameEnter($event, item)"
                  @blur="onRenameBlur(item)"
                />
                <ul
                  v-if="suggestKey === item.key && renameSuggestList(item).length"
                  class="ui-purchase-suggest__list"
                  @mousedown.prevent
                >
                  <li
                    v-for="cat in renameSuggestList(item)"
                    :key="cat.id"
                    class="ui-purchase-suggest__item"
                    @mousedown.prevent="pickRenameCatalog(item, cat)"
                  >
                    <span>{{ cat.name }}</span>
                    <small>{{ GROUP_LABEL[cat.groupKey] ?? cat.groupKey }}</small>
                  </li>
                </ul>
              </div>
              <span
                v-if="itemBranchMark(item)"
                class="ui-purchase-sheet__mark"
                :title="itemBranchMark(item)"
              >{{ itemBranchMark(item) }}</span>
              <button
                type="button"
                class="ui-purchase-item-tip"
                :aria-expanded="floatTip?.itemKey === item.key"
                title="ดูสต็อก"
                @click="toggleItemTip($event, item)"
              >ⓘ</button>
            </div>
            <label
              v-for="br in copyBranchOrder"
              :key="br.id"
              class="ui-purchase-sheet__qty"
              :data-branch="shortBranchName(br.name)"
              @mousedown.stop
            >
              <input
                :value="qtyDraft[qtyFieldKey(item.key, br.id)]"
                type="text"
                inputmode="decimal"
                data-sheet-nav
                :data-sheet-qty="qtyFieldKey(item.key, br.id)"
                :disabled="qtySavingKey === qtyFieldKey(item.key, br.id)"
                :aria-label="`จำนวนคงเหลือ ${shortBranchName(br.name)}`"
                @input="onQtyInput(item.key, br.id, $event)"
                @keydown.enter.prevent="onSheetEnter($event)"
                @blur="saveQty(item, br.id)"
              />
            </label>
            <div class="ui-purchase-sheet__tot">
              {{ draftBuyTotal(item)?.replace(/^รวม\s*/, "") || "—" }}
            </div>
            <button
              type="button"
              class="ui-purchase-sheet__del"
              title="ไม่ซื้อ — ลบออกจากแผง"
              :disabled="saving"
              @mousedown.stop
              @click="removeItem(item)"
            >
              ×
            </button>
          </div>
          <div v-if="movePickKey === item.key" class="ui-purchase-move">
            <span>ย้ายไป</span>
            <button
              v-for="dest in moveTargets(item)"
              :key="dest.key"
              type="button"
              class="ui-purchase-move__btn"
              @click="placeMovePick(dest.key)"
            >
              {{ dest.label }}
            </button>
            <button
              type="button"
              class="ui-purchase-move__cancel"
              @click="cancelMovePick"
            >
              ยกเลิก
            </button>
          </div>
          </div>

          <div
            v-if="!col.items.length"
            class="ui-purchase-col__empty"
            style="margin: 0.35rem 0.5rem"
          >
            ยังไม่มีรายการ — เพิ่มด้านล่างหรือวางข้อความสาขา
          </div>

          <div
            v-if="addRow[col.key]"
            class="ui-purchase-sheet__row ui-purchase-sheet__row--add"
            :style="{ gridTemplateColumns: addSheetCols }"
          >
            <div class="ui-purchase-suggest ui-purchase-suggest--add">
              <input
                v-model="addRow[col.key].name"
                class="ui-input ui-purchase-sheet__add-name"
                type="text"
                data-sheet-nav
                autocomplete="off"
                :placeholder="col.key === 'pending' ? '+ พิมพ์เลือกชื่อมาตรฐาน' : '+ ชื่อสินค้า'"
                @mousedown.stop
                @focus="suggestKey = `add:${col.key}`"
                @input="suggestKey = `add:${col.key}`"
                @blur="onAddNameBlur(col.key)"
                @keydown.enter.prevent="onSheetEnter($event, col.key)"
              />
              <ul
                v-if="suggestKey === `add:${col.key}` && addSuggestList(col.key).length"
                class="ui-purchase-suggest__list"
                @mousedown.prevent
              >
                <li
                  v-for="cat in addSuggestList(col.key)"
                  :key="cat.id"
                  class="ui-purchase-suggest__item"
                  @mousedown.prevent="pickAddCatalog(col.key, cat)"
                >
                  <span>{{ cat.name }}</span>
                  <small>{{ GROUP_LABEL[cat.groupKey] ?? cat.groupKey }}</small>
                </li>
              </ul>
            </div>
            <label
              v-for="br in copyBranchOrder"
              :key="br.id"
              class="ui-purchase-sheet__qty"
              @mousedown.stop
            >
              <input
                :value="addRow[col.key].qtys[br.id]"
                type="text"
                inputmode="decimal"
                data-sheet-nav
                @input="onAddQtyInput(col.key, br.id, $event)"
                @keydown.enter.prevent="onSheetEnter($event, col.key)"
              />
            </label>
            <button
              type="button"
              class="ui-btn ui-btn--primary ui-purchase-sheet__add-btn"
              :disabled="saving"
              title="เพิ่มรายการบนแผงวันนี้ (ใส่จำนวนได้เลยหรือค่อยกรอกทีหลัง)"
              @click="submitAddRow(col.key)"
            >
              เพิ่ม
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <Teleport to="body">
    <div
      v-if="floatTip"
      class="ui-purchase-float-tip"
      :style="{ left: `${floatTip.left}px`, top: `${floatTip.top}px` }"
    >
      {{ floatTip.text }}
    </div>
  </Teleport>

  <div
    v-if="summaryOpen && board"
    class="ui-modal ui-purchase-summary-modal"
  >
    <div
      class="ui-modal__panel ui-purchase-summary-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="purchase-summary-title"
    >
      <div class="ui-purchase-summary-bar">
        <div>
          <strong id="purchase-summary-title">สรุป · {{ formatDayLabel(day) }}</strong>
          <p v-if="captureHint" class="ui-purchase-summary-hint">{{ captureHint }}</p>
        </div>
        <div class="ui-purchase-summary-bar__actions">
          <button
            type="button"
            class="ui-btn ui-btn--primary"
            :disabled="capturing || !summaryRowCount"
            @click="captureSummary"
          >
            {{ capturing ? "กำลังแคป..." : "แคป" }}
          </button>
          <button type="button" class="ui-btn ui-btn--ghost" @click="copySummarySheet">
            คัดลอกข้อความ
          </button>
          <button type="button" class="ui-btn ui-btn--ghost" @click="summaryOpen = false">
            ปิด
          </button>
        </div>
      </div>
      <div class="ui-purchase-summary-body">
        <div ref="shareCaptureRef" class="ui-purchase-share">
          <table class="ui-purchase-share__table">
            <thead>
              <tr>
                <th v-for="col in summaryColumns" :key="col.key">
                  {{ summaryHeader(col) }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in summaryRowCount" :key="r">
                <td
                  v-for="col in summaryColumns"
                  :key="`${col.key}-${r}`"
                  :class="{
                    'is-chetsamian': col.lines[r - 1]?.kind === 'chetsamian',
                    'is-bankhong': col.lines[r - 1]?.kind === 'bankhong',
                  }"
                >
                  <template v-if="col.lines[r - 1]">
                    {{ formatShareLine(col.lines[r - 1]) }}
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <div
    v-if="vegOpen"
    class="ui-modal ui-purchase-summary-modal"
  >
    <div
      class="ui-modal__panel ui-purchase-summary-panel ui-purchase-veg-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="purchase-veg-title"
    >
      <div class="ui-purchase-summary-bar">
        <div>
          <strong id="purchase-veg-title">ร้านผัก · {{ formatDayLabel(day) }}</strong>
          <p class="ui-purchase-summary-hint">
            เฉพาะชื่อรายการ · ไม่มีเลขสาขา
          </p>
          <p v-if="vegHint" class="ui-purchase-summary-hint" style="color: #166534">
            {{ vegHint }}
          </p>
        </div>
        <div class="ui-purchase-summary-bar__actions">
          <button
            type="button"
            class="ui-btn ui-btn--primary"
            :disabled="!vegNameLines.length"
            @click="copyVegNamesOnly"
          >
            คัดลอกข้อความ
          </button>
          <button type="button" class="ui-btn ui-btn--ghost" @click="vegOpen = false">
            ปิด
          </button>
        </div>
      </div>
      <div class="ui-purchase-summary-body">
        <pre
          v-if="vegNameLines.length"
          ref="vegPreRef"
          class="ui-purchase-veg-pre"
          tabindex="0"
        >{{ vegShareText }}</pre>
        <p v-else class="ui-field-hint">ยังไม่มีรายการในกลุ่มผัก</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ui-purchase-veg-panel {
  max-width: min(28rem, 94vw);
}
.ui-purchase-veg-pre {
  margin: 0;
  padding: 0.85rem 1rem;
  border-radius: 0.55rem;
  background: #fff;
  border: 1px solid #e2e8f0;
  font-size: 1.05rem;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  color: #0f172a;
  max-height: min(60vh, 28rem);
  overflow: auto;
}
:global(.ui-content:has(.ui-purchase-page)) {
  padding: 0.9rem clamp(0.85rem, 1.6vw, 1.5rem) 1.35rem;
}
.ui-purchase-page :deep(.ui-page-head) {
  margin-bottom: 0.7rem;
  gap: 0.65rem;
}
.ui-purchase-page :deep(.ui-page-title) {
  font-size: 1.25rem;
}
.ui-purchase-page :deep(.ui-page-sub) {
  max-width: 46rem;
  line-height: 1.35;
}
.ui-purchase-page :deep(.ui-card) {
  border-radius: 0.75rem;
}
.ui-purchase-page :deep(.ui-report-filters),
.ui-purchase-page > .ui-card {
  padding: 0.7rem 0.85rem;
}
.ui-purchase-collapse-bar {
  display: flex;
  align-items: center;
}
.ui-purchase-collapse-btn {
  appearance: none;
  border: 0;
  background: transparent;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0;
  cursor: pointer;
  text-align: left;
  color: inherit;
  font: inherit;
}
.ui-purchase-collapse-chevron {
  width: 1rem;
  color: #78716c;
  font-size: 0.85rem;
}
.ui-purchase-col__toggle {
  appearance: none;
  border: 0;
  background: transparent;
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
  padding: 0;
  cursor: pointer;
  text-align: left;
  color: inherit;
  font: inherit;
  min-width: 0;
  flex: 1;
}
.ui-purchase-col__toggle > span:first-child {
  flex: 0 0 auto;
  margin-top: 0.15rem;
  color: #78716c;
  width: 0.9rem;
}
.ui-purchase-col--collapsed {
  min-height: 0;
}
.ui-purchase-col--collapsed .ui-purchase-col__head {
  border-bottom: 0;
}
.ui-purchase-col--pending {
  border-color: #fbbf24;
  background: #fffbeb;
}
.ui-purchase-col--pending .ui-purchase-col__head {
  background: #fef3c7;
}
.ui-purchase-item-tip {
  flex: 0 0 auto;
  width: 1rem;
  height: 1rem;
  padding: 0;
  display: inline-grid;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #64748b;
  font-size: 0.72rem;
  line-height: 1;
  cursor: pointer;
  user-select: none;
}
.ui-purchase-item-tip:hover,
.ui-purchase-item-tip:focus-visible,
.ui-purchase-item-tip[aria-expanded="true"] {
  color: #0f172a;
  background: #e2e8f0;
  outline: none;
}
.ui-purchase-daybar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  align-items: center;
  margin-top: 0.35rem;
}
.ui-purchase-daybar__date {
  width: 11rem;
  min-width: 11rem;
}
.ui-purchase-pastes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.85rem;
}
@media (max-width: 720px) {
  .ui-purchase-pastes {
    grid-template-columns: 1fr;
  }
}
.ui-purchase-paste textarea {
  width: 100%;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  line-height: 1.4;
  min-height: 7.5rem;
  resize: vertical;
}
.ui-purchase-daychips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.85rem;
}
.ui-purchase-daychip {
  border: 1px solid #e2e8f0;
  background: #fff;
  border-radius: 999px;
  padding: 0.3rem 0.7rem;
  font-size: 0.8rem;
  color: #334155;
  cursor: pointer;
}
.ui-purchase-daychip:hover {
  border-color: #cbd5e1;
  background: #f8fafc;
}
.ui-purchase-daychip--active {
  border-color: #ca8a04;
  background: #fef9c3;
  font-weight: 700;
  color: #854d0e;
}
.ui-purchase-board {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.55rem;
  margin-top: 0.65rem;
}
.ui-purchase-col {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 0.7rem;
  overflow: visible;
  min-height: 8rem;
  min-width: 0;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}
.ui-purchase-col--drop {
  border-color: #ca8a04;
  box-shadow: inset 0 0 0 2px #fde68a;
  background: #fffbeb;
}
.ui-purchase-col__head {
  display: flex;
  justify-content: space-between;
  gap: 0.35rem;
  align-items: flex-start;
  padding: 0.45rem 0.55rem;
  background: #fef9c3;
  border-bottom: 1px solid #fde68a;
}
.ui-purchase-col__head strong {
  display: block;
  font-size: 0.95rem;
}
.ui-purchase-col__head span {
  display: block;
  font-size: 0.72rem;
  color: #78716c;
  margin-top: 0.15rem;
}
.ui-purchase-sheet {
  padding: 0.35rem 0.4rem 0.55rem;
  max-height: none;
  overflow: visible;
}
.ui-purchase-sheet__head,
.ui-purchase-sheet__row {
  display: grid;
  gap: 0.25rem;
  align-items: center;
  padding: 0.25rem 0.2rem;
}
.ui-purchase-sheet__head {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #fffbeb;
  border-bottom: 1px solid #fde68a;
  font-size: 0.68rem;
  font-weight: 700;
  color: #78716c;
  text-align: center;
}
.ui-purchase-sheet__head span:first-child {
  text-align: left;
  padding-left: 1.7rem;
}
.ui-purchase-sheet__block {
  border-bottom: 1px solid #f1f5f9;
}
.ui-purchase-sheet__block.is-dragging {
  opacity: 0.45;
}
.ui-purchase-sheet__block.is-picked {
  background: #fffbeb;
  box-shadow: inset 3px 0 0 #ca8a04;
}
.ui-purchase-sheet__block.is-chetsamian {
  background: #fffef5;
  box-shadow: inset 3px 0 0 #fde68a;
}
.ui-purchase-sheet__block.is-chetsamian.is-picked {
  background: #fffbeb;
  box-shadow: inset 3px 0 0 #ca8a04;
}
.ui-purchase-sheet__block.is-bankhong {
  background: #fffaf5;
  box-shadow: inset 3px 0 0 #fdba74;
}
.ui-purchase-sheet__block.is-bankhong.is-picked {
  background: #fff7ed;
  box-shadow: inset 3px 0 0 #ea580c;
}
.ui-purchase-sheet__row {
  min-height: 2rem;
}
.ui-purchase-sheet__row--add {
  border-bottom: 0;
  margin-top: 0.25rem;
  padding-top: 0.4rem;
  border-top: 1px dashed #e2e8f0;
}
.ui-purchase-sheet__name {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  min-width: 0;
}
.ui-purchase-suggest {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  width: 0;
}
.ui-purchase-suggest--add {
  width: auto;
}
.ui-purchase-suggest__list {
  position: absolute;
  z-index: 40;
  left: 0;
  right: 0;
  top: calc(100% + 2px);
  margin: 0;
  padding: 0.25rem 0;
  list-style: none;
  max-height: 12rem;
  overflow: auto;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 0.45rem;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
}
.ui-purchase-suggest__item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.35rem 0.55rem;
  cursor: pointer;
  font-size: 0.82rem;
  color: #0f172a;
}
.ui-purchase-suggest__item:hover {
  background: #fef9c3;
}
.ui-purchase-suggest__item small {
  color: #78716c;
  font-size: 0.68rem;
  white-space: nowrap;
}
.ui-purchase-sheet__name-input {
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  border: 1px solid transparent;
  border-radius: 0.35rem;
  padding: 0.2rem 0.3rem;
  font-size: 0.82rem;
  font-weight: 650;
  color: #0f172a;
  background: transparent;
  line-height: 1.2;
}
.ui-purchase-sheet__name-input:hover,
.ui-purchase-sheet__name-input:focus {
  border-color: #e2e8f0;
  background: #fff;
  outline: none;
}
.ui-purchase-sheet__name-input:focus {
  border-color: #ca8a04;
  outline: 2px solid #fde68a;
}
.ui-purchase-sheet__mark {
  flex: 0 0 auto;
  white-space: nowrap;
  font-size: 0.68rem;
  font-weight: 700;
  color: #854d0e;
  background: #fef3c7;
  border-radius: 0.28rem;
  padding: 0.05rem 0.22rem;
  line-height: 1.2;
}
.ui-purchase-item__grip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 1.55rem;
  height: 1.55rem;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0.3rem;
  background: transparent;
  color: #64748b;
  font-size: 0.72rem;
  line-height: 1;
  letter-spacing: -0.12em;
  cursor: pointer;
  user-select: none;
  touch-action: none;
}
.ui-purchase-item__grip:hover,
.ui-purchase-item__grip[aria-pressed="true"] {
  background: #fef3c7;
  color: #854d0e;
}
.ui-purchase-move {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
  padding: 0.25rem 0.2rem 0.4rem 1.7rem;
  font-size: 0.75rem;
  color: #78716c;
}
.ui-purchase-move__btn,
.ui-purchase-move__cancel {
  border: 1px solid #fde68a;
  background: #fff;
  color: #854d0e;
  border-radius: 999px;
  padding: 0.18rem 0.55rem;
  font-size: 0.75rem;
  font-weight: 650;
  cursor: pointer;
}
.ui-purchase-move__btn:hover {
  background: #fef3c7;
}
.ui-purchase-move__cancel {
  border-color: #e2e8f0;
  color: #64748b;
  font-weight: 500;
}
.ui-purchase-sheet__qty {
  display: block;
  margin: 0;
}
.ui-purchase-sheet__qty input {
  width: 100%;
  max-width: 1.85rem;
  box-sizing: border-box;
  border: 1px solid #e2e8f0;
  border-radius: 0.3rem;
  padding: 0.2rem 0.05rem;
  font-size: 0.75rem;
  text-align: center;
  font-variant-numeric: tabular-nums;
  background: #fff;
}
.ui-purchase-sheet__qty input:focus {
  outline: 2px solid #fde68a;
  border-color: #ca8a04;
}
.ui-purchase-sheet__qty[data-branch="หลุมดิน"] input {
  background: #ecfdf5;
}
.ui-purchase-sheet__qty[data-branch="เจ็ดเสมียน"] input {
  background: #eff6ff;
}
.ui-purchase-sheet__qty[data-branch="บ้านฆ้อง"] input {
  background: #fff7ed;
}
.ui-purchase-sheet__tot {
  text-align: center;
  font-size: 0.78rem;
  font-weight: 750;
  color: #92400e;
  font-variant-numeric: tabular-nums;
}
.ui-purchase-sheet__del {
  appearance: none;
  border: 0;
  background: transparent;
  color: #94a3b8;
  font-size: 1.05rem;
  line-height: 1;
  cursor: pointer;
  padding: 0.15rem;
  border-radius: 0.35rem;
}
.ui-purchase-sheet__del:hover {
  color: #b91c1c;
  background: #fef2f2;
}
.ui-purchase-sheet__add-name {
  font-size: 0.8rem !important;
  padding: 0.3rem 0.4rem !important;
}
.ui-purchase-sheet__add-btn {
  padding: 0.35rem 0.45rem !important;
  font-size: 0.78rem !important;
  font-weight: 750 !important;
  min-height: 2rem;
  width: 100%;
}
.ui-purchase-col__empty {
  border: 1px dashed #cbd5e1;
  border-radius: 0.65rem;
  padding: 1rem 0.75rem;
  text-align: center;
  color: #94a3b8;
  font-size: 0.78rem;
  background: #f8fafc;
}
.ui-purchase-float-tip {
  position: fixed;
  z-index: 9999;
  transform: translate(-50%, -100%);
  padding: 0.35rem 0.5rem;
  border-radius: 0.4rem;
  background: #0f172a;
  color: #f8fafc;
  font-size: 0.72rem;
  font-weight: 500;
  line-height: 1.3;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.22);
}
.ui-purchase-summary-modal {
  padding: 0.75rem !important;
  place-items: start center !important;
  align-content: start !important;
  overflow: auto !important;
}
.ui-purchase-summary-panel {
  width: min(96vw, 58rem) !important;
  max-width: 58rem !important;
  max-height: none !important;
  height: auto !important;
  margin: 0 auto 1rem;
  border-radius: 0.55rem !important;
  display: flex !important;
  flex-direction: column;
  overflow: visible !important;
}
.ui-purchase-summary-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.35rem 0.55rem;
  border-bottom: 1px solid #e2e8f0;
  background: #fff;
  position: sticky;
  top: 0;
  z-index: 2;
}
.ui-purchase-summary-bar strong {
  font-size: 0.85rem;
}
.ui-purchase-summary-hint {
  margin: 0.15rem 0 0;
  font-size: 0.72rem;
  color: #15803d;
  font-weight: 500;
}
.ui-purchase-summary-bar__actions {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
}
.ui-purchase-summary-bar__actions .ui-btn {
  padding: 0.25rem 0.55rem !important;
  font-size: 0.78rem !important;
}
.ui-purchase-summary-body {
  flex: 0 0 auto;
  min-height: 0;
  max-height: none !important;
  padding: 0.2rem !important;
  overflow: visible !important;
  background: #fff;
}
.ui-purchase-share {
  display: block;
  width: 100%;
  background: #fff;
  transform: none !important;
}
.ui-purchase-share__table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  background: #fff;
  font-family: "Tahoma", "Segoe UI", "Helvetica Neue", sans-serif;
  font-size: 0.9rem;
  color: #000;
  line-height: 1.25;
}
.ui-purchase-share__table th,
.ui-purchase-share__table td {
  border: 1px solid #b0b0b0;
  padding: 0.22rem 0.4rem;
  vertical-align: middle;
  text-align: left;
  word-break: break-word;
}
.ui-purchase-share__table th {
  background: #ffff00;
  color: #000;
  font-weight: 700;
  text-align: center;
  white-space: nowrap;
  padding: 0.3rem 0.4rem;
  font-size: 0.95rem;
}
.ui-purchase-share__table td {
  background: #fff;
  height: 1.55rem;
}
.ui-purchase-share__table td.is-chetsamian {
  background: #fff59d;
  font-weight: 600;
}
.ui-purchase-share__table td.is-bankhong {
  background: #ffedd5;
  font-weight: 600;
}
/* เช็ครายการครบไหม */
.ui-purchase-check {
  margin-top: 0.75rem;
  padding: 0.65rem 0.85rem;
  border-radius: 0.55rem;
  background: #fffbeb;
  border: 1px solid #fde68a;
  font-size: 0.82rem;
  color: #78350f;
}
.ui-purchase-check.is-ok {
  background: #f0fdf4;
  border-color: #bbf7d0;
  color: #166534;
}
.ui-purchase-check__summary {
  font-weight: 700;
  font-size: 0.88rem;
  margin-bottom: 0.25rem;
}
.ui-purchase-check__branch {
  margin-top: 0.35rem;
}
.ui-purchase-check__branch strong {
  font-size: 0.82rem;
}
.ui-purchase-check__branch ul {
  margin: 0.15rem 0 0 1.2rem;
  padding: 0;
}
.ui-purchase-check__branch li {
  margin: 0.05rem 0;
  line-height: 1.35;
}
@media (max-width: 1180px) {
  .ui-purchase-board {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 720px) {
  .ui-purchase-board {
    grid-template-columns: 1fr;
  }
  .ui-purchase-page :deep(.ui-page-head) {
    flex-direction: column;
    align-items: stretch;
  }
}
/* Surface 2736×1824 ที่ scale 200% ≈ 1368×912 CSS */
@media (max-height: 980px) {
  .ui-purchase-page :deep(.ui-page-sub) {
    display: none;
  }
  .ui-purchase-paste textarea {
    min-height: 5.5rem;
  }
  .ui-purchase-daychips {
    margin-top: 0.45rem;
  }
}
</style>
