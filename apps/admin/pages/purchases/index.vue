<script setup lang="ts">
import {
  normalizePurchaseKey,
  parsePurchaseText,
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

const { get, post, patch } = useAdminApi();
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
/** ค่าที่กำลังกรอกบนแผง: itemKey::branchId → qty */
const qtyDraft = ref<Record<string, string>>({});
const nameDraft = ref<Record<string, string>>({});
const qtySavingKey = ref<string | null>(null);
const nameSavingKey = ref<string | null>(null);
/** แถวเพิ่มใหม่ต่อคอลัมน์ */
const addRow = ref<
  Record<string, { name: string; qtys: Record<string, string> }>
>({});

const COLLAPSE_KEY = "ap-pos.purchases.collapsed";
const PASTE_COLLAPSE_KEY = "ap-pos.purchases.pasteCollapsed";

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

/** ลำดับคัดลอก: หลุมดิน แล้ว เจ็ดเสมียน แล้วสาขาอื่น */
const copyBranchOrder = computed(() =>
  [...branches.value].sort((a, b) => {
    const rank = (n: string) =>
      /หลุมดิน/.test(n) ? 0 : /เจ็ดเสมียน/.test(n) ? 1 : 2;
    const d = rank(a.name) - rank(b.name);
    return d !== 0 ? d : a.code.localeCompare(b.code);
  }),
);

const copyLegend = computed(() => {
  const names = copyBranchOrder.value.map((b) => shortBranchName(b.name));
  if (names.length < 2) return "";
  return `คัดลอก 4+2 = ซื้อรวม 6 ของ${names[0]} 4 · ${names[1]} 2`;
});

const sheetCols = computed(
  () =>
    `minmax(0, 1fr) repeat(${Math.max(copyBranchOrder.value.length, 1)}, 1.85rem) 2rem 1.35rem`,
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

/** หาจำนวนที่น้องใส่ท้ายชื่อ (รองรับชื่อที่ถูก map กับแคตตาล็อก) */
function remainingFromPaste(
  itemName: string,
  lines: ParsedPurchaseLine[],
): string | null {
  const key = normalizePurchaseKey(itemName);
  if (!key || !lines.length) return null;
  let best: { score: number; qty: string } | null = null;
  for (const line of lines) {
    const qty = (line.qtyText || line.note || "").trim();
    if (!qty) continue;
    const ck = normalizePurchaseKey(line.name);
    if (!ck) continue;
    if (key === ck) return qty;
    if (key.includes(ck) || ck.includes(key)) {
      const score = Math.min(key.length, ck.length);
      if (!best || score > best.score) best = { score, qty };
    }
  }
  return best?.qty ?? null;
}

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

const floatTip = ref<{ text: string; left: number; top: number } | null>(
  null,
);

function showItemTip(e: MouseEvent | FocusEvent, item: BoardItem) {
  const el = e.currentTarget as HTMLElement;
  const r = el.getBoundingClientRect();
  floatTip.value = {
    text: itemStockTip(item),
    left: r.left + r.width / 2,
    top: r.top - 6,
  };
}

function hideItemTip() {
  floatTip.value = null;
}

async function saveQty(item: BoardItem, branchId: string) {
  if (!board.value) return;
  const key = qtyFieldKey(item.key, branchId);
  const qtyText = sanitizeQtyInput(qtyDraft.value[key] ?? "");
  qtyDraft.value[key] = qtyText;
  const hit = item.byBranch.find((b) => b.branchId === branchId);
  const prev = sanitizeQtyInput(hit ? branchQty(hit) : "");
  if (qtyText === prev) return;

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
  try {
    board.value = await post<Board>("/purchases/board-rename", {
      dayId: board.value.day.id,
      day: day.value,
      name: item.name,
      newName: next,
      groupKey: item.groupKey,
      lineIds: item.byBranch.map((b) => b.lineId),
    });
    syncQtyDrafts();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "บันทึกชื่อไม่สำเร็จ";
    nameDraft.value[item.key] = item.name;
  } finally {
    nameSavingKey.value = null;
  }
}

function onQtyInput(itemKey: string, branchId: string, e: Event) {
  const el = e.target as HTMLInputElement;
  const v = sanitizeQtyInput(el.value);
  qtyDraft.value[qtyFieldKey(itemKey, branchId)] = v;
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
  // ช่องสุดท้ายของแถวเพิ่ม → บันทึกแถวใหม่ แล้วโฟกัสชื่อใหม่
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

async function submitAddRow(colKey: string) {
  if (!board.value) return;
  ensureAddRow(colKey);
  const draft = addRow.value[colKey];
  const name = draft.name.trim();
  if (!name) {
    error.value = "ใส่ชื่อสินค้าก่อน";
    return;
  }
  const jobs = copyBranchOrder.value.filter((br) =>
    (draft.qtys[br.id] ?? "").trim(),
  );
  if (!jobs.length) {
    error.value = "ใส่จำนวนอย่างน้อย 1 สาขา";
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    let last: Board | null = null;
    for (const br of jobs) {
      last = await post<Board>("/purchases/board-qty", {
        dayId: board.value.day.id,
        day: day.value,
        branchId: br.id,
        name,
        groupKey: colKey,
        qtyText: sanitizeQtyInput(draft.qtys[br.id]),
      });
    }
    if (last) board.value = last;
    syncQtyDrafts();
    addRow.value = {
      ...addRow.value,
      [colKey]: {
        name: "",
        qtys: Object.fromEntries(copyBranchOrder.value.map((b) => [b.id, ""])),
      },
    };
    message.value = `เพิ่ม「${name}」แล้ว`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "เพิ่มรายการไม่สำเร็จ";
  } finally {
    saving.value = false;
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

function shortBranchName(name: string) {
  if (/หลุมดิน/.test(name)) return "หลุมดิน";
  if (/เจ็ดเสมียน/.test(name)) return "เจ็ดเสมียน";
  return name.replace(/^สาขา\s*/u, "").trim() || name;
}

/** คัดลอกจำนวน: 4+2 / แค่หลุมดิน 4 / แค่เจ็ดเสมียน +2 */
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
  if (order.length === 2) {
    const [a, b] = qtys;
    if (a && b) return `${a}+${b}`;
    if (a && !b) return a;
    if (!a && b) return `+${b}`;
    return "";
  }
  if (qtys.some(Boolean)) return qtys.map((q) => q || "0").join("+");
  return "";
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
    await loadDays();
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
      last = await patch<Board>(`/purchases/lines/${br.lineId}`, {
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
  const t = e.target as HTMLElement | null;
  if (t?.closest("input, textarea, button, a, .ui-purchase-sheet__qty")) {
    e.preventDefault();
    return;
  }
  dragItemKey.value = item.key;
  e.dataTransfer?.setData("text/plain", item.key);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
}

function onItemDragEnd() {
  dragItemKey.value = null;
  dragOverCol.value = null;
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

function copyColumn(col: Column) {
  const text = col.items
    .map((i) => {
      const q = formatCopyQty(i);
      return q ? `${i.name} ${q}` : i.name;
    })
    .join("\n");
  void navigator.clipboard.writeText(text);
  message.value = `คัดลอกคอลัมน์ ${col.label} แล้ว`;
}

const summaryOpen = ref(false);

const SUMMARY_HEADERS: Record<string, string> = {
  meatball: "ลูกชิ้น",
  market: "ตลาด",
  veg: "ผัก",
  transfer: "ร้าน",
  makro: "แม็คโค",
};

function summaryHeader(col: Column) {
  return SUMMARY_HEADERS[col.key] ?? col.label;
}

function summaryLine(item: BoardItem) {
  const q = formatCopyQty(item);
  return q ? `${item.name} ${q}` : item.name;
}

/** คอลัมน์สรุป — มีรายการเท่านั้น · รายการที่มีบวก (4+2) อยู่บนก่อน */
const summaryColumns = computed(() => {
  if (!board.value) return [] as Column[];
  return board.value.columns
    .filter((col) => col.items.length > 0)
    .map((col) => {
      const withPlus: BoardItem[] = [];
      const rest: BoardItem[] = [];
      for (const item of col.items) {
        if (formatCopyQty(item).includes("+")) withPlus.push(item);
        else rest.push(item);
      }
      return { ...col, items: [...withPlus, ...rest] };
    });
});

const summaryRowCount = computed(() => {
  if (!summaryColumns.value.length) return 0;
  return Math.max(0, ...summaryColumns.value.map((c) => c.items.length));
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

function copySummarySheet() {
  if (!summaryColumns.value.length) return;
  const cols = summaryColumns.value;
  const rows = summaryRowCount.value;
  const lines = [cols.map((c) => summaryHeader(c)).join("\t")];
  for (let r = 0; r < rows; r += 1) {
    lines.push(
      cols
        .map((c) => {
          const item = c.items[r];
          return item ? summaryLine(item) : "";
        })
        .join("\t"),
    );
  }
  void navigator.clipboard.writeText(lines.join("\n"));
  message.value = "คัดลอกแผ่นสรุปแล้ว";
}

watch(day, () => {
  void loadBoard();
});

onMounted(async () => {
  await loadBranches();
  await loadBoard();
});
</script>

<template>
  <div>
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
            <span>{{ b.code }} — {{ b.name }}</span>
            <textarea
              v-model="pasteByBranch[b.id]"
              class="ui-input"
              rows="10"
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

    <p v-if="board" class="ui-field-hint" style="margin: 0.85rem 0 0">
      แผงสรุป · กด ⓘ ที่สินค้าเพื่อดูคงเหลือ · <strong>Enter</strong> ไปช่องถัดไป
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
              :title="br.name"
            >{{ tinyBranchLabel(br.name) }}</span>
            <span title="รวม">รวม</span>
            <span />
          </div>

          <div
            v-for="item in col.items"
            :key="item.key"
            class="ui-purchase-sheet__row"
            :class="{ 'is-dragging': dragItemKey === item.key }"
            :style="{ gridTemplateColumns: sheetCols }"
            draggable="true"
            @dragstart="onItemDragStart(item, $event)"
            @dragend="onItemDragEnd"
          >
            <div class="ui-purchase-sheet__name">
              <span class="ui-purchase-item__grip" aria-hidden="true">⋮⋮</span>
              <input
                v-model="nameDraft[item.key]"
                class="ui-purchase-sheet__name-input"
                type="text"
                data-sheet-nav
                :disabled="nameSavingKey === item.key"
                :title="item.matched ? '' : 'ยังไม่ map'"
                @mousedown.stop
                @keydown.enter.prevent="onSheetEnter($event)"
                @blur="saveName(item)"
              />
              <span
                class="ui-purchase-item-tip"
                tabindex="0"
                @mousedown.stop
                @mouseenter="showItemTip($event, item)"
                @mouseleave="hideItemTip"
                @focus="showItemTip($event, item)"
                @blur="hideItemTip"
              >ⓘ</span>
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
            :style="{ gridTemplateColumns: sheetCols }"
          >
            <input
              v-model="addRow[col.key].name"
              class="ui-input ui-purchase-sheet__add-name"
              type="text"
              data-sheet-nav
              placeholder="+ ชื่อสินค้า"
              @mousedown.stop
              @keydown.enter.prevent="onSheetEnter($event, col.key)"
            />
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
                @input="
                  addRow[col.key].qtys[br.id] = sanitizeQtyInput(
                    ($event.target as HTMLInputElement).value,
                  )
                "
                @keydown.enter.prevent="onSheetEnter($event, col.key)"
              />
            </label>
            <button
              type="button"
              class="ui-btn ui-btn--ghost ui-purchase-sheet__add-btn"
              :disabled="saving"
              @click="submitAddRow(col.key)"
            >
              เพิ่ม
            </button>
            <span />
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
    @click.self="summaryOpen = false"
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
                <td v-for="col in summaryColumns" :key="`${col.key}-${r}`">
                  <template v-if="col.items[r - 1]">
                    {{ summaryLine(col.items[r - 1]) }}
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
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
.ui-purchase-item-tip {
  flex: 0 0 auto;
  width: 1rem;
  height: 1rem;
  display: inline-grid;
  place-items: center;
  border-radius: 999px;
  color: #64748b;
  font-size: 0.72rem;
  line-height: 1;
  cursor: help;
  user-select: none;
}
.ui-purchase-item-tip:hover,
.ui-purchase-item-tip:focus {
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
  min-height: 12rem;
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
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.75rem;
  margin-top: 1rem;
}
.ui-purchase-col {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 0.9rem;
  overflow: visible;
  min-height: 12rem;
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
  gap: 0.5rem;
  align-items: flex-start;
  padding: 0.75rem 0.85rem;
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
  padding-left: 1.1rem;
}
.ui-purchase-sheet__row {
  border-bottom: 1px solid #f1f5f9;
  min-height: 2rem;
}
.ui-purchase-sheet__row.is-dragging {
  opacity: 0.45;
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
  gap: 0.2rem;
  min-width: 0;
  cursor: grab;
}
.ui-purchase-sheet__name-input {
  flex: 1 1 auto;
  width: 0;
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
.ui-purchase-item__grip {
  color: #94a3b8;
  font-size: 0.65rem;
  line-height: 1.2;
  letter-spacing: -0.12em;
  flex-shrink: 0;
  margin-top: 0.15rem;
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
  padding: 0.25rem 0.2rem !important;
  font-size: 0.72rem !important;
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
@media (max-width: 1100px) {
  .ui-purchase-board {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 640px) {
  .ui-purchase-board {
    grid-template-columns: 1fr;
  }
}
</style>
