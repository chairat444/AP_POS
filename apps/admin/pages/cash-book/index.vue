<script setup lang="ts">
type BranchCol = { id: string; name: string };

type DaySummary = {
  day: string;
  income: number;
  sales?: number;
  otherIncome?: number;
  expense: number;
  net: number;
  count: number;
  salesByBranch: Array<{
    branchId: string;
    branchName: string;
    cash: number;
    transfer: number;
    government?: number;
    transferBills?: number;
    amount: number;
  }>;
};

type MonthReport = {
  month: string;
  branches: BranchCol[];
  summary: {
    income: number;
    sales?: number;
    otherIncome?: number;
    expense: number;
    net: number;
    count: number;
  };
  buckets?: {
    rent: number;
    rentByBranch: Array<{ branchId: string; branchName: string; amount: number }>;
    wage: number;
    goods: number;
    routine: number;
    drawer?: number;
    manual: number;
    cashSales: number;
    transferSales: number;
    transferBills?: number;
    governmentSales?: number;
    otherIn?: number;
    loanIn?: number;
    loanOut?: number;
  };
  days: DaySummary[];
};

type Entry = {
  id: string;
  entryDate: string;
  direction: "in" | "out";
  kind: "sale" | "loan" | "expense" | "other";
  branchId: string | null;
  branchName?: string | null;
  categoryId: string | null;
  categoryName?: string | null;
  amount: number;
  description: string | null;
  note: string | null;
  sourceKey?: string | null;
  auto?: boolean;
};

type DayDetail = {
  day: string;
  entries: Entry[];
  summary: { income: number; expense: number; net: number; count: number };
};

const { get, post } = useAdminApi();
const { askConfirm } = useConfirmDialog();

function bangkokToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function bangkokMonth() {
  return bangkokToday().slice(0, 7);
}

const pending = ref(false);
const saving = ref(false);
const error = ref("");
const message = ref("");
const month = ref(bangkokMonth());
const report = ref<MonthReport | null>(null);
const expandedDay = ref<string | null>(null);
const dayCache = ref<Record<string, DayDetail>>({});
const dayLoading = ref("");
let messageTimer: ReturnType<typeof setTimeout> | null = null;

/** แถวว่างด้านล่าง — พิมพ์แล้ว Enter */
const draft = reactive({
  direction: "out" as "in" | "out",
  description: "",
  amount: "",
});

/** แก้แถวเดิมแบบ in-place */
const editId = ref<string | null>(null);
const edit = reactive({
  description: "",
  amount: "",
  direction: "out" as "in" | "out",
  kind: "expense" as Entry["kind"],
});

/** autocomplete ชื่อรายการ */
const descOptions = ref<string[]>([]);
const suggestOpen = ref(false);
const suggestIndex = ref(-1);
const suggestFor = ref<"draft" | "edit" | null>(null);

const BUCKETS_OPEN_KEY = "ap-pos-cashbook-buckets-open";
const bucketsOpen = ref(false);

/** สุทธิสะสมจากต้นเดือน → วันนั้น (แถววันล่าสุด = สุทธิเดือน) */
const dayRunningNet = computed(() => {
  const map: Record<string, number> = {};
  if (!report.value?.days.length) return map;
  const ordered = [...report.value.days].sort((a, b) =>
    a.day.localeCompare(b.day),
  );
  let run = 0;
  for (const d of ordered) {
    run = Math.round((run + d.net) * 100) / 100;
    map[d.day] = run;
  }
  return map;
});

const monthLabel = computed(() => {
  try {
    return new Date(`${month.value}-01T12:00:00+07:00`).toLocaleDateString(
      "th-TH",
      { month: "long", year: "numeric" },
    );
  } catch {
    return month.value;
  }
});

const branchCols = computed(() => report.value?.branches ?? []);

const activeQuery = computed(() => {
  if (suggestFor.value === "edit") return edit.description;
  if (suggestFor.value === "draft") return draft.description;
  return "";
});

const filteredSuggestions = computed(() => {
  const q = activeQuery.value.trim().toLowerCase();
  if (!q) return [];
  return descOptions.value
    .filter((d) => d.toLowerCase().includes(q))
    .slice(0, 12);
});

function baht(n: number) {
  return n.toLocaleString("th-TH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function baht2(n: number) {
  return n.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDay(iso: string) {
  try {
    return new Date(`${iso}T12:00:00+07:00`).toLocaleDateString("th-TH", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    });
  } catch {
    return iso;
  }
}

function branchSaleParts(row: DaySummary, branchId: string) {
  const b = row.salesByBranch.find((x) => x.branchId === branchId);
  return {
    cash: b?.cash ?? 0,
    transfer: b?.transfer ?? 0,
    government: b?.government ?? 0,
    transferBills: b?.transferBills ?? 0,
    amount: b?.amount ?? 0,
  };
}

function branchMonthTotal(
  branchId: string,
  part: "cash" | "transfer" | "government",
) {
  if (!report.value) return 0;
  return report.value.days.reduce(
    (s, d) => s + branchSaleParts(d, branchId)[part],
    0,
  );
}

function branchMonthTransferBills(branchId: string) {
  if (!report.value) return 0;
  return report.value.days.reduce(
    (s, d) => s + branchSaleParts(d, branchId).transferBills,
    0,
  );
}

function branchDayTotal(row: DaySummary, branchId: string) {
  const p = branchSaleParts(row, branchId);
  return p.amount || p.cash + p.transfer + p.government;
}

type BranchLine = {
  key: string;
  label: string;
  amount: number;
  bills?: number;
};

function branchLinesFromParts(p: {
  cash: number;
  transfer: number;
  government: number;
  transferBills: number;
}): BranchLine[] {
  const lines: BranchLine[] = [];
  if (p.cash) lines.push({ key: "cash", label: "สด", amount: p.cash });
  if (p.transfer) {
    lines.push({
      key: "xfer",
      label: "โอน",
      amount: p.transfer,
      bills: p.transferBills || undefined,
    });
  }
  if (p.government) lines.push({ key: "gov", label: "รัฐ", amount: p.government });
  return lines;
}

function branchDayLines(row: DaySummary, branchId: string) {
  return branchLinesFromParts(branchSaleParts(row, branchId));
}

function branchMonthLines(branchId: string) {
  return branchLinesFromParts({
    cash: branchMonthTotal(branchId, "cash"),
    transfer: branchMonthTotal(branchId, "transfer"),
    government: branchMonthTotal(branchId, "government"),
    transferBills: branchMonthTransferBills(branchId),
  });
}

function branchMonthAmount(branchId: string) {
  if (!report.value) return 0;
  return report.value.days.reduce(
    (s, d) => s + branchDayTotal(d, branchId),
    0,
  );
}

function shortBranch(name: string) {
  if (/หลุมดิน/.test(name)) return "หลุมดิน";
  if (/เจ็ดเสมียน/.test(name)) return "เจ็ดเสมียน";
  if (/บ้านฆ้อง|ฆ้อง/.test(name)) return "บ้านฆ้อง";
  return name;
}

function daySales(row: DaySummary) {
  return row.sales ?? row.salesByBranch.reduce((s, b) => s + b.amount, 0);
}

function dayOtherIncome(row: DaySummary) {
  return row.otherIncome ?? Math.max(0, row.income - daySales(row));
}

function monthSales() {
  if (!report.value) return 0;
  return (
    report.value.summary.sales ??
    report.value.days.reduce((s, d) => s + daySales(d), 0)
  );
}

function monthOtherIncome() {
  if (!report.value) return 0;
  return (
    report.value.summary.otherIncome ??
    report.value.days.reduce((s, d) => s + dayOtherIncome(d), 0)
  );
}

/** สุทธิ + ค่าเช่าที่หักในสมุด — ใช้เช็คเงินในมือเทียบระบบ */
function monthNetPlusRent() {
  if (!report.value) return 0;
  const net = Number(report.value.summary.net ?? 0);
  const rent = Number(report.value.buckets?.rent ?? 0);
  return Math.round((net + rent) * 100) / 100;
}

function flash(msg: string) {
  message.value = msg;
  if (messageTimer) clearTimeout(messageTimer);
  messageTimer = setTimeout(() => {
    message.value = "";
  }, 2800);
}

function parseAmount(raw: string) {
  const n = Number(String(raw).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : NaN;
}

function sanitizeAmountInput(raw: string) {
  let t = String(raw ?? "").replace(/[^\d.,]/g, "").replace(/,/g, ".");
  const dot = t.indexOf(".");
  if (dot >= 0) {
    t = t.slice(0, dot + 1) + t.slice(dot + 1).replace(/\./g, "");
  }
  return t;
}

function onAmountTyped(which: "draft" | "edit") {
  if (which === "draft") draft.amount = sanitizeAmountInput(draft.amount);
  else edit.amount = sanitizeAmountInput(edit.amount);
}

function isAmountNavKey(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey || e.altKey) return true;
  return (
    e.key === "Backspace" ||
    e.key === "Delete" ||
    e.key === "Tab" ||
    e.key === "Enter" ||
    e.key === "Escape" ||
    e.key === "ArrowLeft" ||
    e.key === "ArrowRight" ||
    e.key === "Home" ||
    e.key === "End"
  );
}

function expenseLines(detail: DayDetail | undefined) {
  if (!detail) return [];
  return detail.entries.filter((e) => e.direction === "out");
}

/** เงินเข้าที่ไม่ได้มาจากยอดขายสาขา (ยืม/อื่นๆ) */
function extraIncomeLines(detail: DayDetail | undefined) {
  if (!detail) return [];
  return detail.entries
    .filter(
      (e) =>
        e.direction === "in" &&
        e.kind !== "sale" &&
        !e.sourceKey?.startsWith("auto:sale:"),
    )
    .sort((a, b) => b.amount - a.amount);
}

function extraIncomeTotal(detail: DayDetail | undefined) {
  return (
    Math.round(
      extraIncomeLines(detail).reduce((s, e) => s + e.amount, 0) * 100,
    ) / 100
  );
}

type ExpenseGroupId =
  | "goods"
  | "drawer"
  | "manual"
  | "wage"
  | "routine"
  | "rent"
  | "other";

type ExpenseGroup = {
  id: ExpenseGroupId;
  label: string;
  items: Entry[];
  total: number;
};

const EXPENSE_GROUP_ORDER: ExpenseGroupId[] = [
  "goods",
  "wage",
  "routine",
  "rent",
  "drawer",
  "other",
];

const EXPENSE_GROUP_LABEL: Record<ExpenseGroupId, string> = {
  goods: "วัตถุดิบ",
  drawer: "จ่ายจากลิ้นชัก",
  manual: "เพิ่มเอง",
  wage: "ค่าแรง",
  routine: "ประจำ",
  rent: "ค่าเช่า",
  other: "อื่นๆ",
};

function expenseGroupId(e: Entry): ExpenseGroupId {
  const key = e.sourceKey ?? "";
  // กรอกเอง (+ ของเก่าที่เคยนำเข้า) → กลุ่มวัตถุดิบ
  if (key.startsWith("import:") || !key) return "goods";
  if (key.startsWith("auto:drawer-exp:")) return "drawer";
  if (
    key.startsWith("auto:staff:") ||
    key.startsWith("auto:owner:") ||
    key.startsWith("auto:flex:ad-wage:")
  ) {
    return "wage";
  }
  if (key.startsWith("auto:flex:school:")) return "routine";
  if (key.startsWith("auto:rent:")) return "rent";
  return "other";
}

/** แก้/ลบได้: กรอกเอง · นำเข้าเก่า · ประจำ (แอ๊ด/โรงเรียน) */
function canEditEntry(e: Entry) {
  const key = e.sourceKey ?? "";
  return (
    !key || key.startsWith("import:") || key.startsWith("auto:flex:")
  );
}

function expenseGroups(detail: DayDetail | undefined): ExpenseGroup[] {
  const lines = expenseLines(detail);
  const buckets = new Map<ExpenseGroupId, Entry[]>();
  for (const e of lines) {
    const id = expenseGroupId(e);
    if (!buckets.has(id)) buckets.set(id, []);
    buckets.get(id)!.push(e);
  }
  const out: ExpenseGroup[] = [];
  for (const id of EXPENSE_GROUP_ORDER) {
    const items = buckets.get(id);
    if (!items?.length) continue;
    items.sort((a, b) => b.amount - a.amount);
    out.push({
      id,
      label: EXPENSE_GROUP_LABEL[id],
      items,
      total: Math.round(items.reduce((s, x) => s + x.amount, 0) * 100) / 100,
    });
  }
  return out;
}

/** สุทธิสะสมในวัน: เริ่มจากยอดขาย → +เงินเข้า → −จ่าย ตามลำดับที่แสดง */
function runningNetsForDay(dayRow: DaySummary) {
  const detail = dayCache.value[dayRow.day];
  let run = Math.round(daySales(dayRow) * 100) / 100;
  const byId: Record<string, number> = {};
  for (const e of extraIncomeLines(detail)) {
    run = Math.round((run + e.amount) * 100) / 100;
    byId[e.id] = run;
  }
  for (const g of expenseGroups(detail)) {
    for (const e of g.items) {
      run = Math.round((run - e.amount) * 100) / 100;
      byId[e.id] = run;
    }
  }
  return { byId, final: run };
}

const expandedRunning = computed(() => {
  const day = expandedDay.value;
  if (!day || !report.value) return null;
  const row = report.value.days.find((d) => d.day === day);
  if (!row) return null;
  return runningNetsForDay(row);
});

function lineLabel(e: Entry) {
  if (e.kind === "sale") {
    const method = (e.description || "").trim();
    const branch = e.branchName || "ยอดขาย";
    return method ? `${branch} · ${method}` : branch;
  }
  const d = (e.description || "").trim();
  if (d.startsWith("ค่าเช่า · ")) return d.slice("ค่าเช่า · ".length);
  if (d.startsWith("ค่าแรง+คอม · ")) return d.slice("ค่าแรง+คอม · ".length);
  if (d.startsWith("ค่าแรง · ")) return d.slice("ค่าแรง · ".length);
  if (d.includes("เจ้าของร้าน") || d === "ค่าแรง ปอ") return "ปอ";
  return d || e.categoryName || "รายการ";
}

function entryTag(e: Entry) {
  if (e.sourceKey?.startsWith("auto:drawer-exp:")) return "ลิ้นชัก";
  if (e.sourceKey?.startsWith("auto:flex:")) return "ประจำ";
  if (e.sourceKey?.startsWith("auto:")) return "ออโต้";
  return null;
}

function focusEl(id: string) {
  nextTick(() => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    el?.focus();
    el?.select?.();
  });
}

function focusDraft(day: string, field: "desc" | "amt" = "desc") {
  focusEl(field === "amt" ? `cb-draft-amt-${day}` : `cb-draft-desc-${day}`);
}

function resetDraft() {
  draft.description = "";
  draft.amount = "";
  // คงทิศทางล่าสุดไว้ ลดสลับไปมา
}

function inferDraftKind(
  direction: "in" | "out",
  description: string,
): Entry["kind"] {
  if (direction === "in") return "loan";
  const d = description.trim();
  if (/คืน/.test(d) && /(ปอ|เจ้าของ|ยืม)/.test(d)) return "loan";
  return "expense";
}

async function loadMonth() {
  pending.value = true;
  error.value = "";
  try {
    report.value = await get<MonthReport>(
      `/cash-book/month?month=${encodeURIComponent(month.value)}`,
    );
  } catch (e) {
    error.value = e instanceof Error ? e.message : "โหลดไม่สำเร็จ";
    report.value = null;
  } finally {
    pending.value = false;
  }
}

async function loadDayDetail(day: string, force = false) {
  if (!force && dayCache.value[day]) return dayCache.value[day];
  dayLoading.value = day;
  try {
    const detail = await get<DayDetail>(
      `/cash-book/day?day=${encodeURIComponent(day)}`,
    );
    dayCache.value = { ...dayCache.value, [day]: detail };
    return detail;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "โหลดรายวันไม่สำเร็จ";
    return null;
  } finally {
    dayLoading.value = "";
  }
}

async function toggleDay(day: string) {
  if (expandedDay.value === day) {
    expandedDay.value = null;
    editId.value = null;
    return;
  }
  expandedDay.value = day;
  editId.value = null;
  resetDraft();
  await loadDayDetail(day);
  focusDraft(day);
}

async function openToday() {
  const day = bangkokToday();
  if (!day.startsWith(month.value)) {
    month.value = day.slice(0, 7);
    dayCache.value = {};
    await loadMonth();
  }
  expandedDay.value = day;
  editId.value = null;
  resetDraft();
  await loadDayDetail(day, true);
  focusDraft(day);
}

async function shiftMonth(delta: number) {
  const [y, m] = month.value.split("-").map(Number);
  const d = new Date(y!, m! - 1 + delta, 1);
  month.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  expandedDay.value = null;
  editId.value = null;
  dayCache.value = {};
  await loadMonth();
}

async function applyMonth() {
  expandedDay.value = null;
  editId.value = null;
  dayCache.value = {};
  await loadMonth();
}

async function refreshDay(day: string) {
  delete dayCache.value[day];
  await Promise.all([loadMonth(), loadDayDetail(day, true)]);
  expandedDay.value = day;
}

async function addDraft(day: string) {
  const description = draft.description.trim();
  const amount = parseAmount(draft.amount);
  if (!description && !(amount > 0)) {
    focusDraft(day);
    return;
  }
  if (!description) {
    error.value = "ใส่ชื่อรายการ";
    focusDraft(day, "desc");
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    error.value = "ใส่จำนวนเงิน";
    focusDraft(day, "amt");
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    const kind = inferDraftKind(draft.direction, description);
    const direction = draft.direction;
    await post("/cash-book", {
      entryDate: day,
      direction,
      kind,
      branchId: null,
      categoryId: null,
      amount,
      description,
      note: null,
    });
    resetDraft();
    closeSuggest();
    flash(direction === "in" ? "บันทึกเงินเข้าแล้ว" : "เพิ่มแล้ว");
    await Promise.all([refreshDay(day), loadDescriptions()]);
    focusDraft(day);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "บันทึกไม่สำเร็จ";
  } finally {
    saving.value = false;
  }
}

async function loadDescriptions() {
  try {
    const res = await get<{ descriptions: string[] }>("/cash-book/descriptions");
    descOptions.value = res.descriptions ?? [];
  } catch {
    descOptions.value = [];
  }
}

function openSuggest(which: "draft" | "edit") {
  const q =
    which === "draft" ? draft.description.trim() : edit.description.trim();
  if (!q) {
    closeSuggest();
    return;
  }
  suggestFor.value = which;
  suggestOpen.value = true;
  suggestIndex.value = filteredSuggestions.value.length ? 0 : -1;
}

function onDescTyped(which: "draft" | "edit") {
  openSuggest(which);
}

function closeSuggest() {
  suggestOpen.value = false;
  suggestIndex.value = -1;
  suggestFor.value = null;
}

function pickSuggestion(text: string, day: string, which: "draft" | "edit") {
  if (which === "draft") {
    draft.description = text;
    closeSuggest();
    focusDraft(day, "amt");
  } else {
    edit.description = text;
    closeSuggest();
    if (editId.value) focusEl(`cb-edit-amt-${editId.value}`);
  }
}

function onDraftDescKey(e: KeyboardEvent, day: string) {
  const list = filteredSuggestions.value;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (!suggestOpen.value) openSuggest("draft");
    if (!list.length) return;
    suggestIndex.value = (suggestIndex.value + 1) % list.length;
    return;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    if (!suggestOpen.value) openSuggest("draft");
    if (!list.length) return;
    suggestIndex.value =
      suggestIndex.value <= 0 ? list.length - 1 : suggestIndex.value - 1;
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    if (
      suggestOpen.value &&
      suggestIndex.value >= 0 &&
      list[suggestIndex.value]
    ) {
      pickSuggestion(list[suggestIndex.value]!, day, "draft");
      return;
    }
    closeSuggest();
    focusDraft(day, "amt");
    return;
  }
  if (e.key === "Escape") {
    if (suggestOpen.value) {
      e.preventDefault();
      closeSuggest();
      return;
    }
    resetDraft();
    return;
  }
}

function onDraftAmtKey(e: KeyboardEvent, day: string) {
  if (e.key === "Enter") {
    e.preventDefault();
    void addDraft(day);
    return;
  }
  if (e.key === "Escape") {
    resetDraft();
    focusDraft(day);
    return;
  }
  if (isAmountNavKey(e)) return;
  if (!/^\d$/.test(e.key) && e.key !== "." && e.key !== ",") {
    e.preventDefault();
  }
}

function onEditDescKey(e: KeyboardEvent, rowId: string, day: string) {
  const list = filteredSuggestions.value;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (!suggestOpen.value) openSuggest("edit");
    if (!list.length) return;
    suggestIndex.value = (suggestIndex.value + 1) % list.length;
    return;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    if (!suggestOpen.value) openSuggest("edit");
    if (!list.length) return;
    suggestIndex.value =
      suggestIndex.value <= 0 ? list.length - 1 : suggestIndex.value - 1;
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    if (
      suggestOpen.value &&
      suggestIndex.value >= 0 &&
      list[suggestIndex.value]
    ) {
      pickSuggestion(list[suggestIndex.value]!, day, "edit");
      return;
    }
    closeSuggest();
    focusEl(`cb-edit-amt-${rowId}`);
    return;
  }
  if (e.key === "Escape") {
    if (suggestOpen.value) {
      e.preventDefault();
      closeSuggest();
      return;
    }
    cancelEdit();
    return;
  }
}

function startEdit(row: Entry) {
  if (!canEditEntry(row)) return;
  editId.value = row.id;
  edit.description = row.description ?? lineLabel(row);
  edit.amount = String(row.amount);
  edit.direction = row.direction;
  edit.kind = row.kind;
  focusEl(`cb-edit-desc-${row.id}`);
}

function cancelEdit() {
  editId.value = null;
  closeSuggest();
}

async function saveEdit(day: string) {
  if (!editId.value || saving.value) return;
  const description = edit.description.trim();
  const amount = parseAmount(edit.amount);
  if (!description) {
    error.value = "ใส่ชื่อรายการ";
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    error.value = "ใส่จำนวนเงิน";
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    await post(`/cash-book/update`, {
      id: editId.value,
      entryDate: day,
      direction: edit.direction,
      kind: edit.kind,
      branchId: null,
      categoryId: null,
      amount,
      description,
      note: null,
    });
    editId.value = null;
    closeSuggest();
    flash("บันทึกแล้ว");
    await Promise.all([refreshDay(day), loadDescriptions()]);
    focusDraft(day);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "บันทึกไม่สำเร็จ";
  } finally {
    saving.value = false;
  }
}

function onEditAmtKey(e: KeyboardEvent, day: string) {
  if (e.key === "Enter") {
    e.preventDefault();
    void saveEdit(day);
    return;
  }
  if (e.key === "Escape") {
    cancelEdit();
    return;
  }
  if (isAmountNavKey(e)) return;
  if (!/^\d$/.test(e.key) && e.key !== "." && e.key !== ",") {
    e.preventDefault();
  }
}

async function removeRow(row: Entry) {
  if (!canEditEntry(row)) return;
  const ok = await askConfirm({
    title: "ลบรายการ",
    message: `ลบ ${lineLabel(row)} ${baht2(row.amount)} บาท?`,
    confirmLabel: "ลบ",
  });
  if (!ok) return;
  try {
    await post(`/cash-book/delete`, { id: row.id });
    if (editId.value === row.id) editId.value = null;
    flash("ลบแล้ว");
    await refreshDay(row.entryDate);
    focusDraft(row.entryDate);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "ลบไม่สำเร็จ";
  }
}

onMounted(async () => {
  try {
    bucketsOpen.value = localStorage.getItem(BUCKETS_OPEN_KEY) === "1";
  } catch {
    bucketsOpen.value = false;
  }
  await Promise.all([loadMonth(), loadDescriptions()]);
});

function toggleBuckets() {
  bucketsOpen.value = !bucketsOpen.value;
  try {
    localStorage.setItem(BUCKETS_OPEN_KEY, bucketsOpen.value ? "1" : "0");
  } catch {
    /* ignore */
  }
}
</script>

<template>
  <div class="cb">
    <div class="ui-page-head">
      <div>
        <h1 class="ui-page-title">สมุดรายวัน</h1>
        <p class="ui-page-sub">
          กดวันที่ → พิมพ์รายการจ่ายด้านล่างเหมือน Excel (Enter = บันทึก)
        </p>
      </div>
      <div class="ui-page-head__actions">
        <button
          type="button"
          class="ui-btn ui-btn--ghost"
          :disabled="pending"
          @click="applyMonth"
        >
          {{ pending ? "กำลังโหลด…" : "รีเฟรช" }}
        </button>
        <button type="button" class="ui-btn" @click="openToday">
          จ่ายวันนี้
        </button>
      </div>
    </div>

    <div v-if="error" class="ui-alert ui-alert--danger">{{ error }}</div>
    <div v-if="message" class="ui-alert">{{ message }}</div>

    <div class="cb-toolbar ui-card">
      <div class="cb-month-nav">
        <button type="button" class="ui-btn ui-btn--ghost cb-nav-btn" @click="shiftMonth(-1)">
          ‹
        </button>
        <div class="cb-month-label">
          <strong>{{ monthLabel }}</strong>
          <input
            v-model="month"
            class="cb-month-input"
            type="month"
            @change="applyMonth"
          />
        </div>
        <button type="button" class="ui-btn ui-btn--ghost cb-nav-btn" @click="shiftMonth(1)">
          ›
        </button>
        <button
          type="button"
          class="ui-btn ui-btn--ghost"
          @click="
            month = bangkokMonth();
            applyMonth();
          "
        >
          เดือนนี้
        </button>
      </div>

      <div v-if="report" class="cb-kpis">
        <div class="cb-kpi cb-kpi--in">
          <span class="cb-kpi__label">ยอดขาย</span>
          <strong>{{ baht(monthSales()) }}</strong>
          <span v-if="report.buckets" class="cb-kpi__sub">
            สด {{ baht(report.buckets.cashSales) }} · โอน
            {{ baht(report.buckets.transferSales) }}
            <template v-if="(report.buckets.governmentSales || 0) > 0">
              · สวัสดิการ {{ baht(report.buckets.governmentSales || 0) }}
            </template>
          </span>
        </div>
        <div
          v-if="monthOtherIncome() > 0"
          class="cb-kpi cb-kpi--loan"
        >
          <span class="cb-kpi__label">เงินยืม/เข้าอื่น</span>
          <strong>{{ baht(monthOtherIncome()) }}</strong>
          <span
            v-if="report.buckets?.loanIn || report.buckets?.loanOut"
            class="cb-kpi__sub"
          >
            ยืมเข้า {{ baht(report.buckets.loanIn || 0) }}
            <template v-if="(report.buckets.loanOut || 0) > 0">
              · คืน {{ baht(report.buckets.loanOut || 0) }}
            </template>
          </span>
        </div>
        <div class="cb-kpi cb-kpi--out">
          <span class="cb-kpi__label">จ่าย</span>
          <strong>{{ baht(report.summary.expense) }}</strong>
        </div>
        <div
          class="cb-kpi"
          :class="report.summary.net >= 0 ? 'cb-kpi--in' : 'cb-kpi--out'"
        >
          <span class="cb-kpi__label">สุทธิ</span>
          <strong>{{ baht(report.summary.net) }}</strong>
          <span class="cb-kpi__sub">ขาย+ยืม − จ่าย</span>
        </div>
        <div class="cb-kpi cb-kpi--check">
          <span class="cb-kpi__label">เช็คเงิน</span>
          <strong>{{ baht(monthNetPlusRent()) }}</strong>
          <span class="cb-kpi__sub"
            >สุทธิ {{ baht(report.summary.net) }} + เช่า
            {{ baht(report.buckets?.rent || 0) }}</span
          >
        </div>
      </div>
    </div>

    <div v-if="report?.buckets" class="ui-card cb-buckets">
      <button
        type="button"
        class="cb-buckets__toggle"
        :aria-expanded="bucketsOpen"
        @click="toggleBuckets"
      >
        <span class="cb-buckets__title">
          <span class="cb-chevron">{{ bucketsOpen ? "▾" : "▸" }}</span>
          สรุปกลุ่มเดือนนี้
        </span>
        <span class="cb-buckets__peek">
          เข้า
          {{
            baht(
              (report.buckets.cashSales || 0) +
                (report.buckets.transferSales || 0) +
                (report.buckets.governmentSales || 0) +
                (report.buckets.loanIn || 0) +
                (report.buckets.otherIn || 0),
            )
          }}
          · จ่าย เช่า {{ baht(report.buckets.rent) }} · ค่าแรง
          {{ baht(report.buckets.wage) }} · วัตถุดิบ
          {{ baht(report.buckets.goods) }}
        </span>
      </button>
      <div v-if="bucketsOpen" class="cb-buckets__body">
        <p class="cb-buckets__section">เงินเข้า</p>
        <div class="cb-kpis cb-kpis--buckets">
          <div class="cb-kpi cb-kpi--in">
            <span class="cb-kpi__label">เงินสด</span>
            <strong>{{ baht(report.buckets.cashSales) }}</strong>
            <span class="cb-kpi__sub">ยอดขาย</span>
          </div>
          <div class="cb-kpi cb-kpi--in">
            <span class="cb-kpi__label">เงินโอน</span>
            <strong>{{ baht(report.buckets.transferSales) }}</strong>
            <span class="cb-kpi__sub">
              <template v-if="(report.buckets.transferBills || 0) > 0">
                {{ report.buckets.transferBills }} บิล ·
              </template>
              PromptPay / โอน
            </span>
          </div>
          <div
            v-if="(report.buckets.governmentSales || 0) > 0"
            class="cb-kpi cb-kpi--in"
          >
            <span class="cb-kpi__label">สวัสดิการ</span>
            <strong>{{ baht(report.buckets.governmentSales || 0) }}</strong>
            <span class="cb-kpi__sub">เงินรัฐ</span>
          </div>
          <div
            v-if="(report.buckets.loanIn || 0) > 0"
            class="cb-kpi cb-kpi--loan"
          >
            <span class="cb-kpi__label">เงินยืม</span>
            <strong>{{ baht(report.buckets.loanIn || 0) }}</strong>
            <span class="cb-kpi__sub">ยืมเข้า</span>
          </div>
          <div
            v-if="(report.buckets.otherIn || 0) > 0"
            class="cb-kpi cb-kpi--in"
          >
            <span class="cb-kpi__label">เข้าอื่น</span>
            <strong>{{ baht(report.buckets.otherIn || 0) }}</strong>
            <span class="cb-kpi__sub">กรอกเอง / อื่นๆ</span>
          </div>
        </div>

        <p class="cb-buckets__section">จ่าย</p>
        <div class="cb-kpis cb-kpis--buckets">
          <div class="cb-kpi cb-kpi--rent">
            <span class="cb-kpi__label">เก็บค่าเช่า</span>
            <strong>{{ baht(report.buckets.rent) }}</strong>
            <span
              v-if="report.buckets.rentByBranch.length"
              class="cb-kpi__sub"
            >
              <template
                v-for="(rb, i) in report.buckets.rentByBranch"
                :key="rb.branchId"
              >
                <template v-if="i"> · </template>{{ rb.branchName }}
                {{ baht(rb.amount) }}
              </template>
            </span>
          </div>
          <div class="cb-kpi">
            <span class="cb-kpi__label">ค่าแรง</span>
            <strong>{{ baht(report.buckets.wage) }}</strong>
            <span class="cb-kpi__sub">พนักงาน · ปอ · แอ๊ด</span>
          </div>
          <div class="cb-kpi">
            <span class="cb-kpi__label">วัตถุดิบ</span>
            <strong>{{ baht(report.buckets.goods) }}</strong>
            <span class="cb-kpi__sub">กรอกเอง</span>
          </div>
          <div v-if="(report.buckets.drawer || 0) > 0" class="cb-kpi">
            <span class="cb-kpi__label">ลิ้นชัก</span>
            <strong>{{ baht(report.buckets.drawer) }}</strong>
            <span class="cb-kpi__sub">จ่ายจาก POS</span>
          </div>
          <div class="cb-kpi">
            <span class="cb-kpi__label">ประจำ</span>
            <strong>{{ baht(report.buckets.routine) }}</strong>
            <span class="cb-kpi__sub">โรงเรียน ฯลฯ</span>
          </div>
          <div v-if="(report.buckets.loanOut || 0) > 0" class="cb-kpi">
            <span class="cb-kpi__label">คืนเงินยืม</span>
            <strong>{{ baht(report.buckets.loanOut || 0) }}</strong>
          </div>
        </div>
      </div>
    </div>

    <div class="ui-card cb-sheet">
      <div v-if="!report?.days.length" class="ui-empty">ยังไม่มีรายการในเดือนนี้</div>
      <div v-else class="cb-table-wrap">
        <table class="cb-sheet-table">
          <thead>
            <tr>
              <th class="cb-col-date">วันที่</th>
              <th
                v-for="b in branchCols"
                :key="b.id"
                class="cb-num cb-branch-head"
              >
                {{ shortBranch(b.name) }}
              </th>
              <th class="cb-num">ยอดขาย</th>
              <th class="cb-num">จ่าย</th>
              <th class="cb-num">สุทธิ</th>
              <th class="cb-num" title="สะสมจากต้นเดือน · วันล่าสุด = สุทธิเดือน">
                สุทธิสะสม
              </th>
            </tr>
          </thead>
          <tbody>
            <template v-for="row in report.days" :key="row.day">
              <tr
                class="cb-day-row"
                :class="{ open: expandedDay === row.day }"
                @click="toggleDay(row.day)"
              >
                <td class="cb-col-date">
                  <span class="cb-chevron">{{
                    expandedDay === row.day ? "▾" : "▸"
                  }}</span>
                  {{ fmtDay(row.day) }}
                </td>
                <td
                  v-for="b in branchCols"
                  :key="b.id"
                  class="cb-num cb-branch-cell"
                >
                  <div class="cb-b">
                    <div
                      class="cb-b__total"
                      :class="{ 'cb-b__total--empty': !branchDayTotal(row, b.id) }"
                    >
                      {{ branchDayTotal(row, b.id) ? baht(branchDayTotal(row, b.id)) : "—" }}
                    </div>
                    <div
                      v-for="line in branchDayLines(row, b.id)"
                      :key="line.key"
                      class="cb-b__row"
                      :class="`cb-b__row--${line.key}`"
                    >
                      <span class="cb-b__k">{{ line.label }}</span>
                      <span class="cb-b__v">
                        {{ baht(line.amount) }}
                        <span v-if="line.bills" class="cb-bill-n">({{ line.bills }})</span>
                      </span>
                    </div>
                  </div>
                </td>
                <td class="cb-num cb-sale cb-strong">
                  {{ baht(daySales(row)) }}
                  <span
                    v-if="dayOtherIncome(row) > 0"
                    class="cb-day-loan"
                    :title="`เงินยืม/เข้าอื่น ${baht(dayOtherIncome(row))}`"
                  >
                    +{{ baht(dayOtherIncome(row)) }}
                  </span>
                </td>
                <td class="cb-num cb-pay">{{ baht(row.expense) }}</td>
                <td
                  class="cb-num cb-strong"
                  :class="row.net >= 0 ? 'cb-sale' : 'cb-pay'"
                >
                  {{ baht(row.net) }}
                </td>
                <td
                  class="cb-num cb-strong"
                  :class="
                    (dayRunningNet[row.day] ?? 0) >= 0 ? 'cb-sale' : 'cb-pay'
                  "
                >
                  {{ baht(dayRunningNet[row.day] ?? 0) }}
                </td>
              </tr>

              <tr v-if="expandedDay === row.day" class="cb-detail-row">
                <td :colspan="5 + branchCols.length">
                  <div v-if="dayLoading === row.day" class="cb-detail-loading">
                    กำลังโหลด…
                  </div>
                  <div v-else class="cb-pay-note" @click.stop>
                    <div class="cb-pay-note__head">
                      <span>รายวัน · {{ fmtDay(row.day) }}</span>
                      <span class="cb-pay-note__hint"
                        >เลือก จ่าย/รับ · Enter บันทึก</span
                      >
                    </div>

                    <table class="cb-pay-note__table">
                      <thead>
                        <tr>
                          <th>รายการ</th>
                          <th class="cb-pay-note__amt">จำนวน</th>
                          <th class="cb-pay-note__amt">สุทธิสะสม</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        <template v-if="extraIncomeLines(dayCache[row.day]).length">
                          <tr class="cb-group-row cb-group-row--in">
                            <td class="cb-group-row__label">เงินเข้า (นอกยอดขาย)</td>
                            <td class="cb-group-row__amt cb-group-row__amt--in">
                              {{ baht(extraIncomeTotal(dayCache[row.day])) }}
                            </td>
                            <td></td>
                            <td></td>
                          </tr>
                          <tr
                            v-for="e in extraIncomeLines(dayCache[row.day])"
                            :key="e.id"
                            :class="{
                              'is-edit': editId === e.id,
                              'is-income': true,
                            }"
                          >
                            <template v-if="editId === e.id">
                              <td class="cb-pay-note__name">
                                <div class="cb-ac">
                                  <input
                                    :id="`cb-edit-desc-${e.id}`"
                                    v-model="edit.description"
                                    class="cb-cell"
                                    lang="th"
                                    inputmode="text"
                                    autocomplete="off"
                                    @input="onDescTyped('edit')"
                                    @blur="closeSuggest()"
                                    @keydown="onEditDescKey($event, e.id, row.day)"
                                  />
                                  <ul
                                    v-if="
                                      suggestOpen &&
                                      suggestFor === 'edit' &&
                                      filteredSuggestions.length
                                    "
                                    class="cb-ac__list"
                                    @mousedown.prevent
                                  >
                                    <li
                                      v-for="(s, i) in filteredSuggestions"
                                      :key="s"
                                      :class="{ active: i === suggestIndex }"
                                      @mousedown="
                                        pickSuggestion(s, row.day, 'edit')
                                      "
                                    >
                                      {{ s }}
                                    </li>
                                  </ul>
                                </div>
                              </td>
                              <td class="cb-pay-note__amt">
                                <input
                                  :id="`cb-edit-amt-${e.id}`"
                                  v-model="edit.amount"
                                  class="cb-cell cb-cell--amt cb-cell--in"
                                  lang="en"
                                  inputmode="decimal"
                                  pattern="[0-9]*"
                                  autocomplete="off"
                                  @input="onAmountTyped('edit')"
                                  @keydown="onEditAmtKey($event, row.day)"
                                />
                              </td>
                              <td class="cb-pay-note__amt cb-pay-note__run"></td>
                              <td class="cb-pay-note__act">
                                <button
                                  type="button"
                                  :disabled="saving"
                                  @click="saveEdit(row.day)"
                                >
                                  บันทึก
                                </button>
                                <button type="button" @click="cancelEdit">
                                  ยกเลิก
                                </button>
                              </td>
                            </template>
                            <template v-else>
                              <td
                                class="cb-pay-note__name is-clickable"
                                @click="startEdit(e)"
                              >
                                {{ lineLabel(e) }}
                              </td>
                              <td
                                class="cb-pay-note__amt cb-pay-note__amt--in is-clickable"
                                @click="startEdit(e)"
                              >
                                {{ baht(e.amount) }}
                              </td>
                              <td
                                class="cb-pay-note__amt cb-pay-note__run"
                                :class="
                                  (expandedRunning?.byId[e.id] ?? 0) >= 0
                                    ? 'cb-sale'
                                    : 'cb-pay'
                                "
                              >
                                {{ baht(expandedRunning?.byId[e.id] ?? 0) }}
                              </td>
                              <td class="cb-pay-note__act">
                                <button type="button" @click="startEdit(e)">
                                  แก้
                                </button>
                                <button type="button" @click="removeRow(e)">
                                  ลบ
                                </button>
                              </td>
                            </template>
                          </tr>
                        </template>

                        <template
                          v-for="g in expenseGroups(dayCache[row.day])"
                          :key="g.id"
                        >
                          <tr class="cb-group-row">
                            <td class="cb-group-row__label">{{ g.label }}</td>
                            <td class="cb-group-row__amt">{{ baht(g.total) }}</td>
                            <td></td>
                            <td></td>
                          </tr>
                          <tr
                            v-for="e in g.items"
                            :key="e.id"
                            :class="{
                              'is-edit': editId === e.id,
                              'is-locked': !canEditEntry(e),
                            }"
                          >
                            <template v-if="editId === e.id">
                              <td class="cb-pay-note__name">
                                <div class="cb-ac">
                                  <input
                                    :id="`cb-edit-desc-${e.id}`"
                                    v-model="edit.description"
                                    class="cb-cell"
                                    lang="th"
                                    inputmode="text"
                                    autocomplete="off"
                                    @input="onDescTyped('edit')"
                                    @blur="closeSuggest()"
                                    @keydown="onEditDescKey($event, e.id, row.day)"
                                  />
                                  <ul
                                    v-if="
                                      suggestOpen &&
                                      suggestFor === 'edit' &&
                                      filteredSuggestions.length
                                    "
                                    class="cb-ac__list"
                                    @mousedown.prevent
                                  >
                                    <li
                                      v-for="(s, i) in filteredSuggestions"
                                      :key="s"
                                      :class="{ active: i === suggestIndex }"
                                      @mousedown="
                                        pickSuggestion(s, row.day, 'edit')
                                      "
                                    >
                                      {{ s }}
                                    </li>
                                  </ul>
                                </div>
                              </td>
                              <td class="cb-pay-note__amt">
                                <input
                                  :id="`cb-edit-amt-${e.id}`"
                                  v-model="edit.amount"
                                  class="cb-cell cb-cell--amt"
                                  lang="en"
                                  inputmode="decimal"
                                  pattern="[0-9]*"
                                  autocomplete="off"
                                  @input="onAmountTyped('edit')"
                                  @keydown="onEditAmtKey($event, row.day)"
                                />
                              </td>
                              <td class="cb-pay-note__amt cb-pay-note__run"></td>
                              <td class="cb-pay-note__act">
                                <button
                                  type="button"
                                  :disabled="saving"
                                  @click="saveEdit(row.day)"
                                >
                                  บันทึก
                                </button>
                                <button type="button" @click="cancelEdit">
                                  ยกเลิก
                                </button>
                              </td>
                            </template>
                            <template v-else>
                              <td
                                class="cb-pay-note__name"
                                :class="{ 'is-clickable': canEditEntry(e) }"
                                @click="startEdit(e)"
                              >
                                {{ lineLabel(e) }}
                                <span
                                  v-if="entryTag(e)"
                                  class="cb-tag"
                                  :title="
                                    entryTag(e) === 'ประจำ'
                                      ? 'รายจ่ายประจำ · แก้/ลบได้'
                                      : entryTag(e) === 'ลิ้นชัก'
                                        ? 'จากค่าใช้จ่ายหน้าร้าน (ลิ้นชัก)'
                                        : 'อัตโนมัติจากระบบ'
                                  "
                                  >{{ entryTag(e) }}</span
                                >
                              </td>
                              <td
                                class="cb-pay-note__amt"
                                :class="{ 'is-clickable': canEditEntry(e) }"
                                @click="startEdit(e)"
                              >
                                {{ baht(e.amount) }}
                              </td>
                              <td
                                class="cb-pay-note__amt cb-pay-note__run"
                                :class="
                                  (expandedRunning?.byId[e.id] ?? 0) >= 0
                                    ? 'cb-sale'
                                    : 'cb-pay'
                                "
                              >
                                {{ baht(expandedRunning?.byId[e.id] ?? 0) }}
                              </td>
                              <td class="cb-pay-note__act">
                                <template v-if="canEditEntry(e)">
                                  <button type="button" @click="startEdit(e)">
                                    แก้
                                  </button>
                                  <button type="button" @click="removeRow(e)">
                                    ลบ
                                  </button>
                                </template>
                              </td>
                            </template>
                          </tr>
                        </template>

                        <!-- แถวว่างแบบ Excel -->
                        <tr class="cb-draft-row">
                          <td class="cb-pay-note__name">
                            <div class="cb-draft-line">
                              <select
                                v-model="draft.direction"
                                class="cb-dir"
                                :disabled="saving"
                                :title="draft.direction === 'in' ? 'เงินเข้า' : 'เงินออก'"
                              >
                                <option value="out">จ่าย</option>
                                <option value="in">รับ</option>
                              </select>
                              <div class="cb-ac cb-ac--grow">
                                <input
                                  :id="`cb-draft-desc-${row.day}`"
                                  v-model="draft.description"
                                  class="cb-cell"
                                  :placeholder="
                                    draft.direction === 'in'
                                      ? 'เช่น ยืมจากเจ้าของ (ปอ)'
                                      : 'พิมพ์รายการ…'
                                  "
                                  lang="th"
                                  inputmode="text"
                                  autocomplete="off"
                                  :disabled="saving"
                                  @input="onDescTyped('draft')"
                                  @blur="closeSuggest()"
                                  @keydown="onDraftDescKey($event, row.day)"
                                />
                                <ul
                                  v-if="
                                    suggestOpen &&
                                    suggestFor === 'draft' &&
                                    filteredSuggestions.length
                                  "
                                  class="cb-ac__list"
                                  @mousedown.prevent
                                >
                                  <li
                                    v-for="(s, i) in filteredSuggestions"
                                    :key="s"
                                    :class="{ active: i === suggestIndex }"
                                    @mousedown="pickSuggestion(s, row.day, 'draft')"
                                  >
                                    {{ s }}
                                  </li>
                                </ul>
                              </div>
                            </div>
                          </td>
                          <td class="cb-pay-note__amt">
                            <input
                              :id="`cb-draft-amt-${row.day}`"
                              v-model="draft.amount"
                              class="cb-cell cb-cell--amt"
                              :class="{ 'cb-cell--in': draft.direction === 'in' }"
                              placeholder="0"
                              lang="en"
                              inputmode="decimal"
                              pattern="[0-9]*"
                              autocomplete="off"
                              :disabled="saving"
                              @input="onAmountTyped('draft')"
                              @keydown="onDraftAmtKey($event, row.day)"
                            />
                          </td>
                          <td class="cb-pay-note__amt cb-pay-note__run"></td>
                          <td class="cb-pay-note__act">
                            <button
                              type="button"
                              class="cb-draft-go"
                              :disabled="saving"
                              @click="addDraft(row.day)"
                            >
                              {{ saving ? "…" : "↵" }}
                            </button>
                          </td>
                        </tr>
                      </tbody>
                      <tfoot>
                        <tr>
                          <td>รวมจ่าย</td>
                          <td class="cb-pay-note__amt">
                            {{ baht(dayCache[row.day]?.summary.expense || 0) }}
                          </td>
                          <td
                            class="cb-pay-note__amt cb-pay-note__run cb-strong"
                            :class="row.net >= 0 ? 'cb-sale' : 'cb-pay'"
                          >
                            {{ baht(row.net) }}
                          </td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
          <tfoot v-if="report">
            <tr>
              <th>รวมเดือน</th>
              <th
                v-for="b in branchCols"
                :key="`${b.id}-foot`"
                class="cb-num cb-branch-cell"
              >
                <div class="cb-b">
                  <div class="cb-b__total">{{ baht(branchMonthAmount(b.id)) }}</div>
                  <div
                    v-for="line in branchMonthLines(b.id)"
                    :key="line.key"
                    class="cb-b__row"
                    :class="`cb-b__row--${line.key}`"
                  >
                    <span class="cb-b__k">{{ line.label }}</span>
                    <span class="cb-b__v">
                      {{ baht(line.amount) }}
                      <span v-if="line.bills" class="cb-bill-n">({{ line.bills }})</span>
                    </span>
                  </div>
                </div>
              </th>
              <th class="cb-num">{{ baht(monthSales()) }}</th>
              <th class="cb-num">{{ baht(report.summary.expense) }}</th>
              <th class="cb-num">{{ baht(report.summary.net) }}</th>
              <th class="cb-num">{{ baht(report.summary.net) }}</th>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cb-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 16px 24px;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  margin-bottom: 10px;
}
.cb-buckets {
  padding: 0;
  margin-bottom: 14px;
  overflow: hidden;
}
.cb-buckets__toggle {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  width: 100%;
  padding: 12px 16px;
  border: 0;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: inherit;
}
.cb-buckets__toggle:hover {
  background: #fafaf9;
}
.cb-buckets__title {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 700;
  font-size: 0.9rem;
  color: #44403c;
}
.cb-buckets__peek {
  font-size: 0.78rem;
  color: #a8a29e;
  font-variant-numeric: tabular-nums;
}
.cb-buckets__body {
  padding: 0 16px 14px;
  border-top: 1px solid #f5f5f4;
}
.cb-buckets__section {
  margin: 12px 0 0;
  font-size: 0.78rem;
  font-weight: 700;
  color: #57534e;
}
.cb-buckets__section:first-child {
  margin-top: 12px;
}
.cb-kpis--buckets {
  padding-top: 8px;
}
.cb-month-nav {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.cb-nav-btn {
  min-width: 40px;
  font-size: 1.25rem;
  line-height: 1;
}
.cb-month-label {
  position: relative;
  min-width: 150px;
  text-align: center;
  padding: 0 8px;
}
.cb-month-label strong {
  font-size: 1.05rem;
}
.cb-month-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.cb-kpis {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.cb-kpi {
  min-width: 110px;
  padding: 8px 12px;
  border-radius: 10px;
  background: #f5f5f4;
}
.cb-kpi--in {
  background: #ecfdf5;
}
.cb-kpi--out {
  background: #fef2f2;
}
.cb-kpi__label {
  display: block;
  font-size: 0.75rem;
  color: #78716c;
}
.cb-kpi__sub {
  display: block;
  margin-top: 2px;
  font-size: 0.72rem;
  color: #a8a29e;
  line-height: 1.35;
  max-width: 160px;
}
.cb-kpi strong {
  font-variant-numeric: tabular-nums;
}
.cb-kpi--in strong {
  color: #047857;
}
.cb-kpi--out strong {
  color: #b91c1c;
}
.cb-kpi--rent {
  background: #eff6ff;
}
.cb-kpi--rent strong {
  color: #1d4ed8;
}
.cb-kpi--loan {
  background: #f0fdf4;
}
.cb-kpi--loan strong {
  color: #15803d;
}
.cb-kpi--check {
  background: linear-gradient(135deg, #ecfdf5 0%, #f0fdf4 55%, #fffbeb 100%);
  border: 1px solid #a7f3d0;
}
.cb-kpi--check .cb-kpi__label {
  color: #047857;
  font-weight: 700;
}
.cb-kpi--check strong {
  color: #065f46;
}
.cb-kpi--check .cb-kpi__sub {
  color: #059669;
}
.cb-day-loan {
  display: block;
  font-size: 0.72rem;
  font-weight: 700;
  color: #15803d;
  line-height: 1.2;
}

.cb-sheet {
  padding: 0;
  overflow: hidden;
}
.cb-table-wrap {
  overflow: auto;
}
.cb-sheet-table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}
.cb-sheet-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #ffedd5;
  color: #9a3412;
  font-size: 0.82rem;
  font-weight: 700;
  text-align: right;
  padding: 10px 12px;
  border-bottom: 1px solid #fed7aa;
  white-space: nowrap;
}
.cb-sheet-table th.cb-col-date,
.cb-sheet-table td.cb-col-date {
  text-align: left;
}
.cb-sheet-table th.cb-branch-head {
  text-align: center;
  border-left: 1px solid #fed7aa;
}
.cb-branch-cell {
  vertical-align: top;
  border-left: 1px solid #f5f5f4;
  min-width: 8.25rem;
}
.cb-b {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
}
.cb-b__total {
  font-size: 1rem;
  font-weight: 800;
  color: #1d4ed8;
  line-height: 1.2;
  padding-bottom: 5px;
  margin-bottom: 2px;
  border-bottom: 1px dashed #e7e5e4;
}
.cb-b__total--empty {
  color: #d6d3d1;
  font-weight: 600;
  border-bottom-color: transparent;
  padding-bottom: 0;
  margin-bottom: 0;
}
.cb-b__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  font-size: 0.72rem;
  line-height: 1.35;
}
.cb-b__k {
  color: #a8a29e;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.cb-b__k::before {
  content: "";
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 5px;
  border-radius: 99px;
  vertical-align: 0.05em;
  background: currentColor;
}
.cb-b__v {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.cb-b__row--cash .cb-b__k,
.cb-b__row--cash .cb-b__v {
  color: #2563eb;
}
.cb-b__row--xfer .cb-b__k,
.cb-b__row--xfer .cb-b__v {
  color: #0f766e;
}
.cb-b__row--gov .cb-b__k,
.cb-b__row--gov .cb-b__v {
  color: #7c3aed;
}
.cb-sheet-table tfoot .cb-branch-cell {
  border-left: 1px solid #fed7aa;
}
.cb-sheet-table tfoot .cb-b__total {
  border-bottom-color: #fdba74;
}
.cb-xfer {
  color: #0f766e;
  font-weight: 600;
}
.cb-bill-n {
  margin-left: 2px;
  font-size: 0.72em;
  font-weight: 700;
  color: #0f766e;
  opacity: 0.85;
}
.cb-gov {
  color: #7c3aed;
  font-weight: 600;
}
.cb-sheet-table td {
  padding: 9px 12px;
  border-bottom: 1px solid #f5f5f4;
  text-align: right;
  font-size: 0.92rem;
}
.cb-day-row {
  cursor: pointer;
}
.cb-day-row:hover td {
  background: #fff7ed;
}
.cb-day-row.open td {
  background: #ffedd5;
}
.cb-chevron {
  display: inline-block;
  width: 1rem;
  color: #a8a29e;
}
.cb-sale {
  color: #1d4ed8;
  font-weight: 600;
}
.cb-pay {
  color: #b91c1c;
  font-weight: 700;
}
.cb-strong {
  font-weight: 800;
}
.cb-num {
  text-align: right;
}
.cb-detail-row td {
  background: #fffbeb;
  padding: 0 12px 12px;
  border-bottom: 1px solid #fed7aa;
  text-align: left;
}
.cb-detail-loading {
  padding: 10px 4px;
  color: #78716c;
  font-size: 0.85rem;
}
.cb-pay-note {
  margin-left: auto;
  max-width: 560px;
  background: #fff;
  border: 1px solid #fde68a;
  border-radius: 10px;
  box-shadow: 0 8px 20px rgb(0 0 0 / 6%);
  overflow: visible;
}
.cb-pay-note__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  background: #fef3c7;
  color: #92400e;
  font-size: 0.8rem;
  font-weight: 700;
}
.cb-pay-note__hint {
  font-weight: 500;
  color: #a16207;
  font-size: 0.72rem;
}
.cb-pay-note__table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}
.cb-pay-note__table thead th {
  padding: 6px 12px;
  text-align: left;
  font-size: 0.72rem;
  font-weight: 700;
  color: #a8a29e;
  background: #fafaf9;
  border-bottom: 1px solid #f5f5f4;
}
.cb-pay-note__table thead th.cb-pay-note__amt {
  text-align: right;
}
.cb-pay-note__table td,
.cb-pay-note__table th {
  padding: 4px 10px;
  border-bottom: 1px solid #f5f5f4;
  font-size: 0.88rem;
}
.cb-group-row td {
  background: #fafaf9;
  border-bottom: 1px solid #e7e5e4;
  padding-top: 8px;
  padding-bottom: 6px;
}
.cb-group-row__label {
  text-align: left;
  font-size: 0.72rem !important;
  font-weight: 800;
  color: #78716c;
  letter-spacing: 0.02em;
  text-transform: none;
}
.cb-group-row__amt {
  text-align: right;
  font-size: 0.78rem !important;
  font-weight: 800;
  color: #78716c;
  white-space: nowrap;
}
.cb-pay-note__table tbody tr.is-locked td {
  color: #78716c;
}
.cb-pay-note__name {
  text-align: left;
  color: #44403c;
  padding-left: 18px !important;
}
.cb-group-row .cb-group-row__label {
  padding-left: 10px !important;
}
.cb-pay-note__name.is-clickable,
.cb-pay-note__amt.is-clickable {
  cursor: text;
}
.cb-pay-note__name.is-clickable:hover,
.cb-pay-note__amt.is-clickable:hover {
  background: #fff7ed;
}
.cb-pay-note__amt {
  text-align: right;
  color: #b91c1c;
  font-weight: 700;
  white-space: nowrap;
  width: 1%;
  min-width: 96px;
}
.cb-pay-note__run {
  text-align: right;
  white-space: nowrap;
  width: 1%;
  min-width: 104px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.cb-pay-note__run.cb-sale {
  color: #1d4ed8;
}
.cb-pay-note__run.cb-pay {
  color: #b91c1c;
}
.cb-pay-note__act {
  width: 1%;
  white-space: nowrap;
  text-align: right;
}
.cb-pay-note__act button {
  border: 0;
  background: none;
  color: #a8a29e;
  font: inherit;
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0 4px;
}
.cb-pay-note__act button:hover {
  color: #57534e;
}
.cb-pay-note__table tfoot td {
  border-top: 1px solid #fde68a;
  background: #fffbeb;
  font-weight: 800;
  color: #7c2d12;
  padding-top: 8px;
  padding-bottom: 8px;
}
.cb-tag {
  display: inline-block;
  margin-left: 6px;
  padding: 0 5px;
  border-radius: 4px;
  background: #f5f5f4;
  color: #78716c;
  font-size: 0.65rem;
  font-weight: 700;
  vertical-align: middle;
}

.cb-cell {
  width: 100%;
  border: 1px solid transparent;
  background: #fffbeb;
  border-radius: 4px;
  padding: 6px 8px;
  font: inherit;
  color: inherit;
  outline: none;
}
.cb-cell:focus {
  border-color: #f59e0b;
  background: #fff;
  box-shadow: 0 0 0 2px rgb(245 158 11 / 20%);
}
.cb-group-row--in td {
  background: #ecfdf5;
}
.cb-group-row__amt--in {
  color: #047857 !important;
}
.cb-pay-note__amt--in {
  color: #047857 !important;
}
.cb-draft-line {
  display: flex;
  align-items: stretch;
  gap: 6px;
}
.cb-dir {
  flex: 0 0 auto;
  border: 1px solid #fde68a;
  background: #fff;
  border-radius: 4px;
  padding: 4px 6px;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 700;
  color: #9a3412;
  cursor: pointer;
}
.cb-draft-row:has(.cb-dir) .cb-dir:focus {
  outline: none;
  border-color: #f59e0b;
}
.cb-ac--grow {
  flex: 1;
  min-width: 0;
}
.cb-cell--in {
  color: #047857 !important;
}
.cb-cell--amt {
  text-align: right;
  font-weight: 700;
  color: #b91c1c;
  min-width: 88px;
}
.cb-ac {
  position: relative;
}
.cb-ac__list {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 2px);
  z-index: 20;
  margin: 0;
  padding: 4px 0;
  list-style: none;
  max-height: 220px;
  overflow: auto;
  background: #fff;
  border: 1px solid #fde68a;
  border-radius: 8px;
  box-shadow: 0 10px 24px rgb(0 0 0 / 12%);
}
.cb-ac__list li {
  padding: 7px 10px;
  font-size: 0.85rem;
  color: #44403c;
  cursor: pointer;
}
.cb-ac__list li:hover,
.cb-ac__list li.active {
  background: #fff7ed;
  color: #9a3412;
}
.cb-draft-row td {
  background: #fff7ed;
  padding-top: 6px;
  padding-bottom: 6px;
}
.cb-draft-row .cb-cell {
  background: #fff;
  border-color: #fde68a;
}
.cb-draft-go {
  font-size: 1rem !important;
  color: #b45309 !important;
  font-weight: 700 !important;
  min-width: 28px;
}
.cb-draft-go:hover {
  color: #92400e !important;
}

@media (max-width: 800px) {
  .cb-pay-note {
    max-width: none;
    margin-left: 0;
  }
}
.cb-sheet-table tfoot th {
  background: #fff7ed;
  border-top: 2px solid #fdba74;
  font-size: 0.88rem;
}
</style>
