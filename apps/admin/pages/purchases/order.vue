<script setup lang="ts">
definePageMeta({ layout: false });

type Branch = { id: string; code: string; name: string };
type SuggestItem = {
  key: string;
  name: string;
  catalogId: string | null;
  groupKey: string;
  aliases: string;
  recent: boolean;
  lastRemaining: string | null;
};
type Mode = "remain" | "spare" | "empty" | "order";
type OrderLine = {
  id: string;
  name: string;
  catalogId: string | null;
  groupKey: string;
  mode: Mode;
  remaining: string;
};

const config = useRuntimeConfig();
const apiBase = computed(() =>
  String(config.public.apiBase || "/api").replace(/\/$/, ""),
);

const ORDER_TOKEN_KEY = "ap-pos.purchase-order.token";
const ORDER_USER_KEY = "ap-pos.purchase-order.user";
const ORDER_BRANCH_KEY = "ap-pos.purchase-order.branchId";
/** draft ที่ยังไม่กดส่ง — ค้างเครื่องกันหายตอนรีเฟรช/โดนไล่ PIN */
const ORDER_DRAFT_PREFIX = "ap-pos.purchase-order.draft.";
/** ชี้ draft ล่าสุดของสาขา (Android ฆ่าแท็บ / ข้ามวันยังกู้ได้) */
const ORDER_DRAFT_LATEST_PREFIX = "ap-pos.purchase-order.draft-latest.";

type LocalDraft = {
  branchId: string;
  day: string;
  savedAt: number;
  lines: OrderLine[];
};

const PIN_LEN = 4;
const PIN_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"] as const;

const step = ref<"pin" | "branch" | "form">("pin");
const pin = ref("");
const pending = ref(false);
const saving = ref(false);
const error = ref("");
const message = ref("");
const pinShake = ref(false);
const token = ref("");
const user = ref<{ id: string; code: string; name: string } | null>(null);
const branches = ref<Branch[]>([]);
const branchId = ref("");
const day = ref("");
const catalog = ref<SuggestItem[]>([]);
const q = ref("");
const lines = ref<OrderLine[]>([]);
const submitted = ref(false);
const justSent = ref(false);
let justSentTimer: ReturnType<typeof setTimeout> | null = null;

/** ป๊อปอัปเพิ่ม/แก้ — ลิสต์สั้นเหมือนเดิม อ่านง่าย */
const modalOpen = ref(false);
const editingId = ref<string | null>(null);
const modalName = ref("");
const modalCatalogId = ref<string | null>(null);
const modalGroupKey = ref("market");
const modalMode = ref<Mode>("remain");
const modalRemaining = ref("");
const modalError = ref("");
/** ความสูงคีย์บอร์ด (debounce กันเด้งจอ Android) */
const kbInset = ref(0);
const searchFocused = ref(false);
const searchInput = ref<HTMLInputElement | null>(null);
let kbRaf = 0;

function shortBranch(name: string) {
  if (/หลุมดิน/.test(name)) return "หลุมดิน";
  if (/เจ็ดเสมียน/.test(name)) return "เจ็ดเสมียน";
  if (/บ้านฆ้อง|ฆ้อง/.test(name)) return "บ้านฆ้อง";
  return name;
}

const branchName = computed(
  () => branches.value.find((b) => b.id === branchId.value)?.name ?? "",
);

const searchHits = computed(() => {
  const s = q.value.trim().toLowerCase();
  if (s.length < 1) return [] as SuggestItem[];
  return catalog.value
    .filter((c) => {
      const name = c.name.toLowerCase();
      const aliases = (c.aliases || "").toLowerCase();
      return name.includes(s) || aliases.includes(s);
    })
    .slice(0, 8);
});

function lineSummary(line: OrderLine) {
  if (line.mode === "empty") return "หมด";
  if (line.mode === "order") {
    return line.remaining ? `ขอ${line.remaining}` : "ขอ";
  }
  if (line.mode === "spare") {
    return line.remaining ? `สำรอง · มี${line.remaining}` : "สำรอง";
  }
  return line.remaining ? `มี${line.remaining}` : "คงเหลือ";
}

function headers(): Record<string, string> {
  const h: Record<string, string> = {};
  if (token.value) h.Authorization = `Bearer ${token.value}`;
  return h;
}

async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}) {
  return await $fetch<T>(`${apiBase.value}${path}`, {
    method: (opts.method as "GET") ?? "GET",
    body: opts.body as Record<string, unknown> | undefined,
    headers: headers(),
    timeout: 60_000,
  });
}

function errMsg(e: unknown, fallback: string) {
  return String(
    (e as { data?: { message?: string } })?.data?.message ??
      (e as Error)?.message ??
      fallback,
  );
}

function persistSession() {
  try {
    if (token.value) storageSet(ORDER_TOKEN_KEY, token.value);
    else storageRemove(ORDER_TOKEN_KEY);
    if (user.value) storageSet(ORDER_USER_KEY, JSON.stringify(user.value));
    else storageRemove(ORDER_USER_KEY);
    if (branchId.value) storageSet(ORDER_BRANCH_KEY, branchId.value);
  } catch {
    /* ignore */
  }
}

/** วันสั่งของตามเวลาไทย — ให้ตรงกับเซิร์ฟ (ห้ามใช้ UTC) */
function todayBangkok() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function draftStorageKey(branch: string, dayKey: string) {
  return `${ORDER_DRAFT_PREFIX}${branch}|${dayKey}`;
}

function draftLatestKey(branch: string) {
  return `${ORDER_DRAFT_LATEST_PREFIX}${branch}`;
}

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
  // สำรอง — Chrome Android บางเครื่องเคลียร์ localStorage ภายใต้แรงกดพื้นที่
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function storageRemove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function parseDraftJson(raw: string | null, branch: string, dayKey?: string): LocalDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LocalDraft;
    if (!parsed || parsed.branchId !== branch) return null;
    if (dayKey && parsed.day !== dayKey) return null;
    if (!Array.isArray(parsed.lines) || !parsed.lines.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

function readLocalDraft(branch: string, dayKey: string): LocalDraft | null {
  if (!branch || !dayKey) return null;
  return parseDraftJson(storageGet(draftStorageKey(branch, dayKey)), branch, dayKey);
}

/** ลบ draft เครื่องของสาขาที่ไม่ใช่วันนี้ — ไม่กู้ข้ามวัน */
function purgeStaleLocalDrafts(branch: string, keepDay: string) {
  if (!branch || !keepDay) return;
  const prefix = `${ORDER_DRAFT_PREFIX}${branch}|`;
  const keepKey = draftStorageKey(branch, keepDay);
  const sweep = (store: Storage | undefined) => {
    if (!store) return;
    try {
      const keys: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (!k || !k.startsWith(prefix)) continue;
        if (k === keepKey) continue;
        keys.push(k);
      }
      for (const k of keys) {
        try {
          store.removeItem(k);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  };
  try {
    sweep(localStorage);
  } catch {
    /* ignore */
  }
  try {
    sweep(sessionStorage);
  } catch {
    /* ignore */
  }
  const latest = storageGet(draftLatestKey(branch));
  if (latest && latest !== keepDay) storageRemove(draftLatestKey(branch));
}

let serverDraftTimer: ReturnType<typeof setTimeout> | null = null;
let serverDraftInflight: Promise<void> | null = null;
let skipServerDraftSync = false;
/** หลังกดส่ง — กัน save-draft ที่ค้างในเน็ตเขียน draft กลับหลังเซิร์ฟเคลียร์แล้ว */
let blockServerDraft = false;
let serverDraftSeq = 0;

function writeLocalDraft() {
  const branch = branchId.value;
  const dayKey = day.value;
  if (!branch || !dayKey) return;
  if (!lines.value.length) {
    clearLocalDraft(branch, dayKey);
    if (!blockServerDraft) scheduleServerDraftSync();
    return;
  }
  // ผู้ใช้แก้ลิสต์หลังส่ง → เปิด sync ใหม่ได้
  blockServerDraft = false;
  const payload: LocalDraft = {
    branchId: branch,
    day: dayKey,
    savedAt: Date.now(),
    lines: lines.value.map((l) => ({ ...l })),
  };
  const json = JSON.stringify(payload);
  storageSet(draftStorageKey(branch, dayKey), json);
  storageSet(draftLatestKey(branch), dayKey);
  scheduleServerDraftSync();
}

function clearLocalDraft(branch?: string, dayKey?: string) {
  const b = branch ?? branchId.value;
  const d = dayKey ?? day.value;
  if (!b || !d) return;
  storageRemove(draftStorageKey(b, d));
  try {
    if (storageGet(draftLatestKey(b)) === d) storageRemove(draftLatestKey(b));
  } catch {
    /* ignore */
  }
}

/** เซฟ draft ขึ้นเซิร์ฟเงียบๆ ตามสาขา+วัน (debounce) — ไม่แจ้งเตือน */
function scheduleServerDraftSync(delayMs = 900) {
  if (skipServerDraftSync || blockServerDraft) return;
  if (step.value !== "form") return;
  if (!token.value || !branchId.value) return;
  if (serverDraftTimer) clearTimeout(serverDraftTimer);
  serverDraftTimer = setTimeout(() => {
    serverDraftTimer = null;
    void flushServerDraft();
  }, delayMs);
}

async function flushServerDraft(opts?: { forceEmpty?: boolean }) {
  // forceEmpty หลังส่งต้องผ่านได้ แม้กำลัง skip ตอน openForm
  if (skipServerDraftSync && !opts?.forceEmpty) return;
  if (blockServerDraft && !opts?.forceEmpty) return;
  if (!token.value || !branchId.value || !day.value) return;
  if (step.value !== "form" && !opts?.forceEmpty) return;
  if (serverDraftTimer) {
    clearTimeout(serverDraftTimer);
    serverDraftTimer = null;
  }
  const seq = ++serverDraftSeq;
  const payload = {
    branchId: branchId.value,
    day: day.value,
    lines: opts?.forceEmpty
      ? []
      : lines.value.map((l) => ({
          id: l.id,
          name: l.name,
          catalogId: l.catalogId,
          groupKey: l.groupKey,
          mode: l.mode,
          remaining: l.remaining,
        })),
  };
  const run = async () => {
    // ถูกยกเลิกโดย submit / sync ใหม่กว่า
    if (seq !== serverDraftSeq && !opts?.forceEmpty) return;
    if (blockServerDraft && !opts?.forceEmpty) return;
    try {
      await api<{ ok: boolean }>("/purchases/order/save-draft", {
        method: "POST",
        body: payload,
      });
    } catch (e: unknown) {
      // เน็ตหลุดไม่เป็นไร — ของยังอยู่ในเครื่อง · อย่าไล่ PIN จากตรงนี้
      if (isAuthExpired(e) && !opts?.forceEmpty) {
        writeLocalDraftWithoutServer();
        clearSession();
        error.value = "เซสชันหมด · รายการยังอยู่ ใส่ PIN ใหม่ได้";
      }
    }
  };
  serverDraftInflight = (serverDraftInflight ?? Promise.resolve())
    .then(run, run)
    .then(() => {
      serverDraftInflight = null;
    });
  await serverDraftInflight;
}

/** เซฟเครื่องอย่างเดียว — กัน loop ตอน sync เซิร์ฟ */
function writeLocalDraftWithoutServer(savedAt?: number) {
  const branch = branchId.value;
  const dayKey = day.value;
  if (!branch || !dayKey || !lines.value.length) return;
  const payload: LocalDraft = {
    branchId: branch,
    day: dayKey,
    // คง savedAt จากเซิร์ฟ — กันเครื่องนี้ชนะเครื่องอื่นโดยไม่แก้จริง
    savedAt: savedAt ?? Date.now(),
    lines: lines.value.map((l) => ({ ...l })),
  };
  storageSet(draftStorageKey(branch, dayKey), JSON.stringify(payload));
  storageSet(draftLatestKey(branch), dayKey);
}

async function stopServerDraftAfterSubmit() {
  blockServerDraft = true;
  serverDraftSeq += 1;
  if (serverDraftTimer) {
    clearTimeout(serverDraftTimer);
    serverDraftTimer = null;
  }
  try {
    await serverDraftInflight;
  } catch {
    /* ignore */
  }
  // เคลียร์ซ้ำ กันคำขอ save-draft ที่ค้างเขียนกลับหลัง submit
  try {
    await flushServerDraft({ forceEmpty: true });
  } catch {
    /* ignore */
  }
}

/** Android สลับแอป/ปิดจอ — เซฟทันทีก่อนแท็บถูกฆ่า */
function flushDraftForAndroid() {
  if (step.value !== "form") return;
  if (!branchId.value) return;
  persistSession();
  // ส่งแล้วกำลังบล็อก sync — อย่าเสก draft ในเครื่องกลับจากลิสต์บนจอ
  if (blockServerDraft) return;
  // ถ้ายังไม่มี day จากเซิร์ฟ ใช้วันไทยชั่วคราว — ห้าม UTC
  if (!day.value) {
    day.value = todayBangkok();
  }
  writeLocalDraftWithoutServer();
  void flushServerDraft();
}

function resumeOfflineForm(reason: string): boolean {
  const branch = branchId.value;
  if (!branch || !token.value || !user.value) return false;
  const dayKey = day.value || todayBangkok();
  const local = readLocalDraft(branch, dayKey);
  if (!local?.lines?.length) return false;
  if (local.day !== dayKey) return false;
  day.value = dayKey;
  lines.value = local.lines.map((l) => ({ ...l }));
  step.value = "form";
  error.value = reason;
  message.value = `กู้รายการค้าง ${local.lines.length} รายการ`;
  return true;
}

/** ไล่ PIN เฉพาะโทเคนหมด/ไม่มี — อย่าใช้ 403 (สิทธิ์อื่น/พร็อกซี) */
function isAuthExpired(e: unknown) {
  const status =
    (e as { statusCode?: number; status?: number })?.statusCode ??
    (e as { status?: number })?.status;
  return status === 401;
}

/** อ่าน exp จากโทเคนในเครื่อง — เช็คได้ทันที ไม่ต้องรอเรียก API */
function tokenExpiresAt(raw?: string): number | null {
  const t = raw ?? token.value;
  if (!t) return null;
  try {
    const body = t.split(".")[0];
    if (!body) return null;
    const payload = JSON.parse(
      atob(body.replace(/-/g, "+").replace(/_/g, "/")),
    ) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

function isTokenAlive(raw?: string): boolean {
  const exp = tokenExpiresAt(raw);
  if (exp == null) return false;
  // เผื่อนาฬิกาเครื่องเพี้ยนเล็กน้อย
  return exp > Math.floor(Date.now() / 1000) + 30;
}

/**
 * เช็คเซสชันตั้งแต่ต้น / ตอนกลับมาเปิดแท็บ
 * - โทเคนหมดในเครื่อง → ไล่ PIN ทันที (ก่อนให้น้องพิมพ์)
 * - โทเคนยังดีแต่เน็ตพลาด → ไม่ไล่ PIN
 */
function ensureLocalSession(kickMsg = "เซสชันหมด · ใส่ PIN ใหม่"): boolean {
  if (!token.value) {
    token.value = storageGet(ORDER_TOKEN_KEY) || "";
  }
  if (!user.value) {
    try {
      const raw = storageGet(ORDER_USER_KEY);
      user.value = raw ? JSON.parse(raw) : null;
    } catch {
      user.value = null;
    }
  }
  if (!token.value || !user.value || !isTokenAlive(token.value)) {
    clearSession();
    error.value = kickMsg;
    return false;
  }
  return true;
}

/** เรียกเซิร์ฟยืนยัน — ใช้ตอนเข้าหน้า/ก่อนส่งเท่านั้น ไม่เรียกตอนเพิ่มลิสต์ */
async function verifySessionWithServer(): Promise<"ok" | "expired" | "offline"> {
  if (!ensureLocalSession()) return "expired";
  try {
    await loadMeta();
    return "ok";
  } catch (e: unknown) {
    if (isAuthExpired(e)) {
      clearSession();
      error.value = "เซสชันหมด · ใส่ PIN ใหม่";
      return "expired";
    }
    return "offline";
  }
}

/** เคลียร์แค่ล็อกอิน — ห้ามลบ draft ในเครื่อง */
function clearSession() {
  // หลังส่งแล้วลิสต์ยังโชว์บนจอ — อย่าเสก draft กลับตอนกดออก
  if (
    !blockServerDraft &&
    branchId.value &&
    day.value &&
    lines.value.length
  ) {
    writeLocalDraftWithoutServer();
  }
  blockServerDraft = false;
  serverDraftSeq += 1;
  if (serverDraftTimer) {
    clearTimeout(serverDraftTimer);
    serverDraftTimer = null;
  }
  const keepBranch = branchId.value;
  token.value = "";
  user.value = null;
  lines.value = [];
  catalog.value = [];
  step.value = "pin";
  pin.value = "";
  message.value = "";
  pinShake.value = false;
  justSent.value = false;
  submitted.value = false;
  if (justSentTimer) {
    clearTimeout(justSentTimer);
    justSentTimer = null;
  }
  closeModal();
  persistSession();
  // คงสาขาไว้ — ใส่ PIN ใหม่แล้วกลับฟอร์มเดิม + กู้ draft
  if (keepBranch) {
    branchId.value = keepBranch;
    storageSet(ORDER_BRANCH_KEY, keepBranch);
  }
}

function triggerPinShake() {
  pinShake.value = false;
  requestAnimationFrame(() => {
    pinShake.value = true;
    window.setTimeout(() => {
      pinShake.value = false;
    }, 420);
  });
}

function onPinKey(key: string) {
  if (pending.value) return;
  if (key === "⌫") {
    pin.value = pin.value.slice(0, -1);
    error.value = "";
    return;
  }
  if (!/^\d$/.test(key)) return;
  if (pin.value.length >= PIN_LEN) return;
  pin.value = `${pin.value}${key}`;
  error.value = "";
  if (pin.value.length === PIN_LEN) {
    void loginPin();
  }
}

async function loginPin() {
  if (pending.value) return;
  if (pin.value.length < PIN_LEN) return;
  pending.value = true;
  error.value = "";
  try {
    const data = await api<{
      token: string;
      user: { id: string; code: string; name: string };
    }>("/purchases/order/login", {
      method: "POST",
      body: { pin: pin.value },
    });
    token.value = data.token;
    user.value = data.user;
    pin.value = "";
    persistSession();
    await loadMeta();
    // หลังโดนไล่ PIN — ใช้สาขาที่คงไว้ในแรม/storage (อย่าอ่านแค่ localStorage)
    const savedBranch =
      branchId.value || storageGet(ORDER_BRANCH_KEY) || "";
    if (savedBranch && branches.value.some((b) => b.id === savedBranch)) {
      branchId.value = savedBranch;
      await openForm();
    } else {
      step.value = "branch";
    }
  } catch (e: unknown) {
    error.value = errMsg(e, "PIN ไม่ถูกต้อง");
    pin.value = "";
    triggerPinShake();
  } finally {
    pending.value = false;
  }
}

async function loadMeta() {
  const data = await api<{ day: string; branches: Branch[] }>(
    "/purchases/order/meta",
  );
  day.value = data.day;
  branches.value = data.branches ?? [];
}

async function pickBranch(id: string) {
  branchId.value = id;
  persistSession();
  await openForm();
}

function parseDraftFlags(qtyText: string | null, note: string | null) {
  const blob = `${qtyText ?? ""} ${note ?? ""}`;
  if (/หมด/.test(blob)) {
    return { mode: "empty" as Mode, remaining: "" };
  }
  if (/ขอ|สั่ง/.test(blob)) {
    const m =
      blob.match(/(?:ขอ|สั่ง)\s*(\d+(?:\.\d+)?)/) ||
      blob.match(/(\d+(?:\.\d+)?)/);
    return { mode: "order" as Mode, remaining: m ? m[1] : "" };
  }
  const spare = /สำรอง/.test(blob);
  const m = blob.match(/มี\s*(\d+(?:\.\d+)?)/) || blob.match(/(\d+(?:\.\d+)?)/);
  return {
    mode: (spare ? "spare" : "remain") as Mode,
    remaining: m ? m[1] : "",
  };
}

async function openForm() {
  if (!branchId.value) return;
  pending.value = true;
  error.value = "";
  message.value = "";
  q.value = "";
  // เปิดฟอร์มใหม่ — ปลดบล็อกจากรอบส่งค้าง (เช่น โดนไล่ PIN กลางทาง)
  blockServerDraft = false;
  try {
    const [itemsData, draftData] = await Promise.all([
      api<{ items: SuggestItem[] }>(
        `/purchases/order/items?branchId=${encodeURIComponent(branchId.value)}`,
      ),
      api<{
        day: string;
        submitted: boolean;
        items: Array<{
          name: string;
          catalogId: string | null;
          groupKey: string;
          qtyText: string | null;
          note: string | null;
        }>;
        mobileDraft: {
          savedAt: number;
          staffName: string | null;
          lines: OrderLine[];
        } | null;
      }>(
        `/purchases/order/draft?branchId=${encodeURIComponent(branchId.value)}`,
      ),
    ]);

    catalog.value = itemsData.items ?? [];
    submitted.value = draftData.submitted;
    // ยึดวันจากเซิร์ฟเสมอ — draft ใช้ได้แค่วันนั้น
    if (draftData.day) day.value = draftData.day;
    const dayKey = day.value || todayBangkok();
    day.value = dayKey;
    purgeStaleLocalDrafts(branchId.value, dayKey);

    const submittedLines: OrderLine[] = (draftData.items ?? []).map(
      (prev, i) => {
        const flags = parseDraftFlags(prev.qtyText, prev.note);
        return {
          id: `line-${i}-${prev.name}`,
          name: prev.name,
          catalogId: prev.catalogId,
          groupKey: prev.groupKey,
          mode: flags.mode,
          remaining: flags.remaining,
        };
      },
    );

    // เฉพาะวันปัจจุบันเท่านั้น — ไม่กู้ข้ามวัน
    const local = readLocalDraft(branchId.value, dayKey);
    const remote = draftData.mobileDraft?.lines?.length
      ? draftData.mobileDraft
      : null;

    // เลือก draft วันนี้เท่านั้น · ถ้าส่งแล้วและไม่มี mobileDraft → โชว์ของที่ส่ง ไม่เอาร่างเก่าในเครื่องทับ
    skipServerDraftSync = true;
    let restoredDraft = false;
    try {
      const localAt = local?.savedAt ?? 0;
      const remoteAt = remote?.savedAt ?? 0;
      if (remote?.lines?.length && local?.lines?.length && localAt > remoteAt) {
        lines.value = local.lines.map((l) => ({ ...l }));
        message.value = `กู้รายการค้าง ${local.lines.length} รายการ`;
        restoredDraft = true;
      } else if (remote?.lines?.length) {
        lines.value = remote.lines.map((l) => ({
          ...l,
          mode: (["remain", "spare", "empty", "order"].includes(l.mode)
            ? l.mode
            : "remain") as Mode,
        }));
        const who = remote.staffName ? ` · จาก${remote.staffName}` : "";
        message.value = `กู้รายการค้าง ${remote.lines.length} รายการ${who}`;
        writeLocalDraftWithoutServer(remote.savedAt || undefined);
        restoredDraft = true;
      } else if (local?.lines?.length && !draftData.submitted) {
        lines.value = local.lines.map((l) => ({ ...l }));
        message.value = `กู้รายการค้าง ${local.lines.length} รายการ`;
        restoredDraft = true;
      } else if (draftData.submitted && submittedLines.length) {
        lines.value = submittedLines;
        clearLocalDraft(branchId.value, dayKey);
      } else {
        lines.value = [];
        if (local) clearLocalDraft(branchId.value, dayKey);
      }
    } finally {
      skipServerDraftSync = false;
    }
    step.value = "form";
    // sync เฉพาะตอนกู้ draft จริง — อย่าเอาของที่ส่งแล้วไปเขียนเป็น draft ใหม่
    if (restoredDraft) scheduleServerDraftSync(400);
  } catch (e: unknown) {
    if (isAuthExpired(e)) {
      clearSession();
      error.value = "เซสชันหมด · ใส่ PIN ใหม่";
      return;
    }
    // Android เน็ตหลุดบ่อย — อย่าดีดกลับ PIN ถ้ายังมีรายการในเครื่อง
    if (
      resumeOfflineForm(
        "เน็ตไม่นิ่ง · ใช้รายการในเครื่องต่อได้ · พอเน็ตกลับค่อยกดส่ง",
      )
    ) {
      return;
    }
    error.value = errMsg(e, "โหลดไม่สำเร็จ · ลองใหม่ได้ รายการในเครื่องยังอยู่");
  } finally {
    pending.value = false;
  }
}

function closeModal() {
  modalOpen.value = false;
  editingId.value = null;
  modalName.value = "";
  modalCatalogId.value = null;
  modalGroupKey.value = "market";
  modalMode.value = "remain";
  modalRemaining.value = "";
  modalError.value = "";
}

function blurActive() {
  const y = typeof window !== "undefined" ? window.scrollY : 0;
  try {
    (document.activeElement as HTMLElement | null)?.blur?.();
  } catch {
    /* ignore */
  }
  searchFocused.value = false;
  requestAnimationFrame(() => {
    try {
      window.scrollTo(0, y);
    } catch {
      /* ignore */
    }
  });
}

function openAddModal(name: string, catalogId: string | null, groupKey: string) {
  // เช็คในเครื่องก่อนเปิดฟอร์ม — อย่าให้น้องกรอกแล้วค่อยโดนไล่ PIN
  if (!ensureLocalSession("เซสชันหมด · ใส่ PIN ใหม่ก่อนเพิ่มรายการ")) return;
  const n = name.trim();
  if (!n) {
    error.value = "พิมพ์หรือเลือกชื่อของ";
    return;
  }
  editingId.value = null;
  modalName.value = n;
  modalCatalogId.value = catalogId;
  modalGroupKey.value = groupKey || "market";
  modalMode.value = "remain";
  modalRemaining.value = "";
  modalError.value = "";
  q.value = "";
  searchFocused.value = false;
  modalOpen.value = true;
  error.value = "";
  message.value = "";
  requestAnimationFrame(() => blurActive());
}

function onPlus() {
  const typed = q.value.trim();
  if (!typed) {
    error.value = "พิมพ์ชื่อของก่อน";
    return;
  }
  const typedKey = typed.toLowerCase().replace(/\s+/g, "");
  const exact = catalog.value.find((h) => {
    const nameKey = h.name.toLowerCase().replace(/\s+/g, "");
    if (nameKey === typedKey) return true;
    return (h.aliases || "")
      .split("|")
      .some((a) => a.trim().toLowerCase().replace(/\s+/g, "") === typedKey);
  });
  if (exact) {
    openAddModal(exact.name, exact.catalogId, exact.groupKey);
    return;
  }
  openAddModal(typed, null, "market");
}

function pickSuggest(it: SuggestItem) {
  openAddModal(it.name, it.catalogId, it.groupKey);
}

function openEdit(line: OrderLine) {
  blurActive();
  editingId.value = line.id;
  modalName.value = line.name;
  modalCatalogId.value = line.catalogId;
  modalGroupKey.value = line.groupKey;
  modalMode.value = line.mode;
  modalRemaining.value = line.remaining;
  modalError.value = "";
  q.value = "";
  searchFocused.value = false;
  modalOpen.value = true;
  error.value = "";
}

function onModalRemainingInput(e: Event) {
  const el = e.target as HTMLInputElement;
  modalRemaining.value = el.value
    .replace(/[^\d.]/g, "")
    .replace(/(\..*)\./g, "$1");
  modalError.value = "";
  if (modalMode.value === "empty") modalMode.value = "remain";
}

function bumpModal(delta: number) {
  const cur = Number(modalRemaining.value || 0);
  const next = Math.max(0, Math.round((cur + delta) * 100) / 100);
  modalRemaining.value = next === 0 ? "" : String(next);
  if (modalMode.value === "empty") modalMode.value = "remain";
}

function saveModal() {
  // เพิ่มลิสต์เป็นงานในเครื่องอย่างเดียว — ห้ามเรียก API / ห้ามไล่ PIN จากเน็ต
  if (!ensureLocalSession("เซสชันหมด · รายการที่พิมพ์ยังถูกเซฟไว้ ใส่ PIN ใหม่ได้")) {
    writeLocalDraft();
    closeModal();
    return;
  }
  if (modalMode.value === "order" && !modalRemaining.value.trim()) {
    modalError.value = "ใส่จำนวนที่ต้องการขอ";
    return;
  }

  const payload: OrderLine = {
    id: editingId.value || `line-${Date.now()}`,
    name: modalName.value.trim(),
    catalogId: modalCatalogId.value,
    groupKey: modalGroupKey.value,
    mode: modalMode.value,
    remaining:
      modalMode.value === "empty" ? "" : modalRemaining.value.trim(),
  };

  if (editingId.value) {
    const idx = lines.value.findIndex((l) => l.id === editingId.value);
    if (idx >= 0) lines.value[idx] = payload;
    message.value = `แก้「${payload.name}」แล้ว`;
  } else {
    const dup = lines.value.findIndex((l) => l.name === payload.name);
    if (dup >= 0) {
      lines.value[dup] = { ...payload, id: lines.value[dup].id };
      message.value = `อัปเดต「${payload.name}」ในลิสต์แล้ว`;
    } else {
      lines.value = [payload, ...lines.value];
      message.value = `เพิ่ม「${payload.name}」แล้ว`;
    }
  }
  q.value = "";
  error.value = "";
  closeModal();
  writeLocalDraft();
}

function syncKeyboardInset() {
  if (kbRaf) cancelAnimationFrame(kbRaf);
  kbRaf = requestAnimationFrame(() => {
    kbRaf = 0;
    const vv = window.visualViewport;
    if (!vv) {
      kbInset.value = 0;
      return;
    }
    const next = Math.max(
      0,
      Math.round(window.innerHeight - vv.height - vv.offsetTop),
    );
    // hysteresis — ค่ากระพริบเล็กน้อยไม่ต้องอัปเดต (กันเด้ง)
    if (next < 56) {
      if (kbInset.value !== 0) kbInset.value = 0;
      return;
    }
    if (Math.abs(next - kbInset.value) < 28) return;
    kbInset.value = next;
  });
}

function onSearchFocus() {
  searchFocused.value = true;
}

function onSearchBlur() {
  // หน่วงนิด กันคลิก suggest แล้ว blur ปิดลิสต์ก่อนเลือก
  window.setTimeout(() => {
    if (document.activeElement !== searchInput.value) {
      searchFocused.value = false;
    }
  }, 180);
}

function removeLine(line: OrderLine) {
  lines.value = lines.value.filter((l) => l.id !== line.id);
  message.value = `ลบ「${line.name}」แล้ว`;
  error.value = "";
  writeLocalDraft();
}

function showJustSent(count: number) {
  submitted.value = true;
  justSent.value = true;
  message.value = `ส่งแล้ว ${count} รายการ`;
  error.value = "";
  if (justSentTimer) clearTimeout(justSentTimer);
  justSentTimer = setTimeout(() => {
    justSent.value = false;
  }, 4000);
  try {
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch {
    /* ignore */
  }
}

async function submit() {
  if (!lines.value.length) {
    error.value = "ยังไม่มีรายการ · กด + เพิ่มก่อน";
    return;
  }
  const needQty = lines.value.find(
    (l) => l.mode === "order" && !String(l.remaining || "").trim(),
  );
  if (needQty) {
    error.value = `「${needQty.name}」เลือกขอแล้ว · แตะรายการแล้วใส่จำนวน`;
    openEdit(needQty);
    return;
  }
  if (saving.value) return;
  // กัน sync ค้างเขียน draft ทับหลังส่ง — เซฟแค่เครื่องก่อน
  blockServerDraft = true;
  serverDraftSeq += 1;
  if (serverDraftTimer) {
    clearTimeout(serverDraftTimer);
    serverDraftTimer = null;
  }
  writeLocalDraftWithoutServer();
  // ยืนยันกับเซิร์ฟก่อนส่ง — หมดอายุรู้ทันที ไม่เสียรายการ
  const session = await verifySessionWithServer();
  if (session === "expired") {
    // clearSession แล้ว — อย่าค้างบล็อก sync รอบหน้า
    return;
  }
  if (session === "offline") {
    blockServerDraft = false;
    error.value =
      "เน็ตไม่นิ่ง · รายการยังอยู่ ลองกดส่งอีกครั้งเมื่อสัญญาณกลับ";
    return;
  }
  saving.value = true;
  error.value = "";
  message.value = "";
  justSent.value = false;
  const count = lines.value.length;
  try {
    const items = lines.value.map((l) => ({
      name: l.name,
      catalogId: l.catalogId,
      remaining: l.mode === "empty" ? null : l.remaining || null,
      spare: l.mode === "spare",
      empty: l.mode === "empty",
      order: l.mode === "order",
      touched: true,
    }));
    const res = await api<{ ok: boolean; itemCount: number }>(
      "/purchases/order/submit",
      {
        method: "POST",
        body: {
          branchId: branchId.value,
          day: day.value,
          items,
        },
      },
    );
    await stopServerDraftAfterSubmit();
    clearLocalDraft();
    // โหลดรายการรวมหลังส่ง (ส่งซ้ำจะรวมกับของเดิม ไม่ทับทั้งก้อน)
    try {
      const draft = await api<{
        submitted: boolean;
        items: Array<{
          name: string;
          catalogId: string | null;
          groupKey: string;
          qtyText: string | null;
          note: string | null;
        }>;
      }>(
        `/purchases/order/draft?branchId=${encodeURIComponent(branchId.value)}`,
      );
      if (draft.items?.length) {
        skipServerDraftSync = true;
        try {
          lines.value = draft.items.map((prev, i) => {
            const flags = parseDraftFlags(prev.qtyText, prev.note);
            return {
              id: `line-${i}-${prev.name}`,
              name: prev.name,
              catalogId: prev.catalogId,
              groupKey: prev.groupKey,
              mode: flags.mode,
              remaining: flags.remaining,
            };
          });
          submitted.value = true;
        } finally {
          skipServerDraftSync = false;
        }
      }
    } catch {
      /* ใช้จำนวนจาก response ก็พอ */
    }
    showJustSent(
      typeof res.itemCount === "number"
        ? res.itemCount
        : lines.value.length || count,
    );
  } catch (e: unknown) {
    if (isAuthExpired(e)) {
      // เซฟรายการก่อนไล่ PIN — ล็อกอินใหม่แล้วกู้ต่อได้
      writeLocalDraftWithoutServer();
      clearSession();
      error.value = "เซสชันหมด · ใส่ PIN ใหม่ (รายการยังอยู่)";
      return;
    }
    // บางทีเซิร์ฟรับแล้ว แต่เน็ตมือถือตัดก่อนได้ response — รีโหลด draft เช็ค
    try {
      const draft = await api<{
        submitted: boolean;
        items: unknown[];
      }>(
        `/purchases/order/draft?branchId=${encodeURIComponent(branchId.value)}`,
      );
      if (draft.submitted && (draft.items?.length ?? 0) > 0) {
        await stopServerDraftAfterSubmit();
        clearLocalDraft();
        showJustSent(draft.items.length);
        return;
      }
    } catch {
      /* ignore */
    }
    blockServerDraft = false;
    writeLocalDraft();
    error.value = errMsg(e, "ส่งไม่สำเร็จ · ลองกดอีกครั้ง (รายการยังอยู่)");
  } finally {
    saving.value = false;
  }
}

function onPinKeydown(e: KeyboardEvent) {
  if (step.value !== "pin" || pending.value) return;
  if (e.key >= "0" && e.key <= "9") {
    e.preventDefault();
    onPinKey(e.key);
    return;
  }
  if (e.key === "Backspace" || e.key === "Delete") {
    e.preventDefault();
    onPinKey("⌫");
  }
}

function onVisibilityFlush() {
  if (document.visibilityState === "hidden") {
    flushDraftForAndroid();
    return;
  }
  // กลับมาเปิดแท็บ — เช็คโทเคนในเครื่องทันที ก่อนให้น้องพิมพ์ต่อ
  if (step.value === "form" || step.value === "branch") {
    ensureLocalSession();
  }
}

function onPageHideFlush() {
  flushDraftForAndroid();
}

function onPageShowRestore(e: PageTransitionEvent) {
  // กลับจาก bfcache / แท็บที่เคยถูกพัก — ถ้ารายการว่างแต่มี draft วันนี้ให้กู้
  if (e.persisted || (step.value === "form" && !lines.value.length)) {
    const dayKey = day.value || todayBangkok();
    const local = branchId.value
      ? readLocalDraft(branchId.value, dayKey)
      : null;
    if (local?.lines?.length && local.day === dayKey && !lines.value.length) {
      day.value = dayKey;
      lines.value = local.lines.map((l) => ({ ...l }));
      message.value = `กู้รายการค้าง ${local.lines.length} รายการ`;
    }
  }
}

onMounted(async () => {
  // กัน Android Chrome ดึงลงแล้วรีเฟรชทั้งหน้า (รายการในแรมหาย)
  try {
    document.documentElement.style.overscrollBehaviorY = "none";
    document.body.style.overscrollBehaviorY = "none";
  } catch {
    /* ignore */
  }
  window.addEventListener("keydown", onPinKeydown);
  window.addEventListener("resize", syncKeyboardInset);
  window.addEventListener("pagehide", onPageHideFlush);
  window.addEventListener("pageshow", onPageShowRestore);
  document.addEventListener("visibilitychange", onVisibilityFlush);
  window.visualViewport?.addEventListener("resize", syncKeyboardInset);
  window.visualViewport?.addEventListener("scroll", syncKeyboardInset);
  // Chrome Android: freeze/resume
  window.addEventListener("freeze", onPageHideFlush as EventListener);
  syncKeyboardInset();
  try {
    token.value = storageGet(ORDER_TOKEN_KEY) || "";
    const rawUser = storageGet(ORDER_USER_KEY);
    user.value = rawUser ? JSON.parse(rawUser) : null;
    branchId.value = storageGet(ORDER_BRANCH_KEY) || "";
  } catch {
    token.value = "";
  }
  // เช็คหมดอายุในเครื่องก่อน — หมดแล้วให้ใส่ PIN ทันที ไม่ต้องโหลดฟอร์ม
  if (!token.value || !user.value) return;
  if (!isTokenAlive(token.value)) {
    clearSession();
    error.value = "เซสชันหมด · ใส่ PIN ใหม่";
    return;
  }
  pending.value = true;
  try {
    const session = await verifySessionWithServer();
    if (session === "expired") return;
    if (session === "offline") {
      if (
        resumeOfflineForm(
          "เน็ตไม่นิ่ง · ใช้รายการในเครื่องต่อได้ · พอเน็ตกลับค่อยกดส่ง",
        )
      ) {
        return;
      }
      step.value = branchId.value ? "branch" : "pin";
      error.value =
        "เชื่อมต่อไม่สำเร็จ · ลองใหม่อีกครั้ง (รายการในเครื่องยังอยู่)";
      return;
    }
    if (branchId.value && branches.value.some((b) => b.id === branchId.value)) {
      await openForm();
    } else {
      step.value = "branch";
    }
  } catch (e: unknown) {
    // กันพลาด — ห้าม clearSession แบบเก่าที่ไล่ PIN ทุก error
    if (isAuthExpired(e)) {
      clearSession();
      error.value = "เซสชันหมด · ใส่ PIN ใหม่";
    } else if (
      resumeOfflineForm(
        "เน็ตไม่นิ่ง · ใช้รายการในเครื่องต่อได้ · พอเน็ตกลับค่อยกดส่ง",
      )
    ) {
      /* form เปิดจาก draft แล้ว */
    } else {
      step.value = branchId.value ? "branch" : "form";
      if (branchId.value && !lines.value.length) {
        const dayKey = day.value || todayBangkok();
        const local = readLocalDraft(branchId.value, dayKey);
        if (local?.lines?.length && local.day === dayKey) {
          day.value = dayKey;
          lines.value = local.lines.map((l) => ({ ...l }));
          step.value = "form";
        }
      }
      error.value = errMsg(
        e,
        "เชื่อมต่อไม่สำเร็จ · ลองใหม่อีกครั้ง (รายการในเครื่องยังอยู่)",
      );
    }
  } finally {
    pending.value = false;
  }
});

watch(
  lines,
  () => {
    if (skipServerDraftSync) return;
    if (step.value === "form" && branchId.value) {
      if (!day.value) day.value = todayBangkok();
      writeLocalDraft();
    }
  },
  { deep: true },
);

onBeforeUnmount(() => {
  flushDraftForAndroid();
  window.removeEventListener("keydown", onPinKeydown);
  window.removeEventListener("resize", syncKeyboardInset);
  window.removeEventListener("pagehide", onPageHideFlush);
  window.removeEventListener("pageshow", onPageShowRestore);
  document.removeEventListener("visibilitychange", onVisibilityFlush);
  window.removeEventListener("freeze", onPageHideFlush as EventListener);
  window.visualViewport?.removeEventListener("resize", syncKeyboardInset);
  window.visualViewport?.removeEventListener("scroll", syncKeyboardInset);
  if (kbRaf) cancelAnimationFrame(kbRaf);
});
</script>

<template>
  <div
    class="po"
    :class="{
      'po--gate': step !== 'form',
      'po--typing': searchFocused && !modalOpen,
    }"
    :style="{ '--kb-inset': `${kbInset}px` }"
  >
    <!-- PIN -->
    <section v-if="step === 'pin'" class="po-gate">
      <div class="po-gate__bg" aria-hidden="true" />
      <div class="po-gate__inner">
        <p class="po-gate__brand">เอพีหมูสด</p>
        <h1 class="po-gate__title">สั่งของ</h1>
        <p class="po-gate__lead">ใส่ PIN พนักงานเพื่อเริ่ม</p>

        <div
          class="po-pin"
          :class="{ 'is-shake': pinShake, 'is-busy': pending }"
          aria-label="PIN 4 หลัก"
        >
          <span
            v-for="i in PIN_LEN"
            :key="i"
            class="po-pin__dot"
            :class="{ 'is-on': pin.length >= i }"
          />
        </div>

        <p v-if="error" class="po-gate__err">{{ error }}</p>
        <p v-else-if="pending" class="po-gate__hint">กำลังเข้า...</p>
        <p v-else class="po-gate__hint">ครบ 4 หลักแล้วเข้าอัตโนมัติ</p>

        <div class="po-pad" role="group" aria-label="แป้นตัวเลข">
          <button
            v-for="(key, idx) in PIN_KEYS"
            :key="idx"
            type="button"
            class="po-pad__key"
            :class="{
              'is-ghost': !key,
              'is-action': key === '⌫',
            }"
            :disabled="!key || pending"
            :aria-label="key === '⌫' ? 'ลบ' : key || undefined"
            @click="key && onPinKey(key)"
          >
            <template v-if="key === '⌫'">⌫</template>
            <template v-else>{{ key }}</template>
          </button>
        </div>
      </div>
    </section>

    <!-- เลือกสาขา -->
    <section v-else-if="step === 'branch'" class="po-gate po-gate--branch">
      <div class="po-gate__bg" aria-hidden="true" />
      <div class="po-gate__inner">
        <header class="po-branch__head">
          <div>
            <p class="po-gate__brand po-gate__brand--sm">เอพีหมูสด</p>
            <h1 class="po-gate__title po-gate__title--sm">เลือกสาขา</h1>
            <p class="po-gate__lead">
              สวัสดี {{ user?.name || "พนักงาน" }}
            </p>
          </div>
          <button type="button" class="po-gate__out" @click="clearSession">
            ออก
          </button>
        </header>

        <p v-if="error" class="po-gate__err">{{ error }}</p>

        <div class="po-branch__list">
          <button
            v-for="b in branches"
            :key="b.id"
            type="button"
            class="po-branch__card"
            :disabled="pending"
            @click="pickBranch(b.id)"
          >
            <span class="po-branch__code">{{ b.code }}</span>
            <span class="po-branch__name">{{ shortBranch(b.name) }}</span>
            <span class="po-branch__go" aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </section>

    <!-- ฟอร์มสั่งของ -->
    <template v-else>
    <header class="po__top">
      <div>
        <h1>{{ shortBranch(branchName) }}</h1>
        <p v-if="user" class="po__sub">
          {{ user.name }}
          <template v-if="submitted"> · ส่งแล้ว</template>
        </p>
      </div>
      <button type="button" class="po__textbtn" @click="clearSession">
        ออก
      </button>
    </header>

    <p v-if="error" class="po__flash po__flash--err">{{ error }}</p>
    <p v-else-if="message && !justSent" class="po__flash po__flash--ok">{{ message }}</p>

    <section class="po__form">
      <div class="po__sticky">
        <div class="po__add" :class="{ 'is-open': q.trim() && searchHits.length }">
          <input
            ref="searchInput"
            v-model="q"
            class="po__search"
            type="search"
            enterkeyhint="done"
            placeholder="พิมพ์ชื่อของ"
            autocomplete="off"
            @focus="onSearchFocus"
            @blur="onSearchBlur"
            @keydown.enter.prevent="onPlus"
          />
          <button type="button" class="po__addbtn" @click="onPlus">+</button>
          <ul v-if="!modalOpen && q.trim() && searchHits.length" class="po__suggest">
            <li
              v-for="it in searchHits"
              :key="it.key"
              @pointerdown.prevent="pickSuggest(it)"
            >
              {{ it.name }}
            </li>
          </ul>
        </div>
        <h2 class="po__list-title">
          รายการที่สั่ง
          <span>{{ lines.length }}</span>
        </h2>
      </div>

      <div v-if="pending" class="po__empty">กำลังโหลด...</div>
      <div v-else-if="!lines.length" class="po__empty">
        ยังไม่มีรายการ<br />พิมพ์ชื่อแล้วกด +
      </div>

      <ul v-else class="po__list">
        <li v-for="line in lines" :key="line.id" class="po__item">
          <button type="button" class="po__item-info" @click="openEdit(line)">
            <strong>{{ line.name }}</strong>
            <span
              class="po__badge"
              :class="{
                'is-spare': line.mode === 'spare',
                'is-out': line.mode === 'empty',
                'is-order': line.mode === 'order',
              }"
            >
              {{ lineSummary(line) }}
            </span>
          </button>
          <button
            type="button"
            class="po__act po__act--del"
            aria-label="ลบ"
            @click="removeLine(line)"
          >
            ลบ
          </button>
        </li>
      </ul>
    </section>

    <div v-if="justSent" class="po__toast" role="status">
      ส่งสำเร็จ · {{ message || "ถึงแผงแล้ว" }}
    </div>

    <footer class="po__dock">
      <button type="button" class="po__secondary" @click="step = 'branch'">
        สาขา
      </button>
      <button
        type="button"
        class="po__primary"
        :class="{ 'is-sent': justSent && !saving }"
        :disabled="saving || !lines.length"
        @click="submit"
      >
        {{
          saving
            ? "กำลังส่ง..."
            : justSent
              ? "ส่งแล้ว ✓"
              : `ส่งทั้งหมด (${lines.length})`
        }}
      </button>
    </footer>

    <!-- ป๊อปอัป เหลือ / สำรอง / หมด / ขอ -->
    <div v-if="modalOpen" class="po__modal">
      <div class="po__sheet" role="dialog" aria-modal="true">
        <div class="po__sheet-head">
          <h2>{{ editingId ? "แก้ไข" : "เพิ่มรายการ" }}</h2>
          <button type="button" class="po__textbtn" @click="closeModal">ปิด</button>
        </div>
        <p class="po__sheet-name">{{ modalName }}</p>

        <div class="po__modes" role="group" aria-label="สถานะ">
          <button
            type="button"
            class="po__mode"
            :class="{ 'is-on': modalMode === 'remain' }"
            @click="modalMode = 'remain'"
          >
            เหลือ
          </button>
          <button
            type="button"
            class="po__mode"
            :class="{ 'is-on is-spare': modalMode === 'spare' }"
            @click="modalMode = 'spare'"
          >
            สำรอง
          </button>
          <button
            type="button"
            class="po__mode"
            :class="{ 'is-on is-out': modalMode === 'empty' }"
            @click="modalMode = 'empty'"
          >
            หมด
          </button>
          <button
            type="button"
            class="po__mode"
            :class="{ 'is-on is-order': modalMode === 'order' }"
            @click="modalMode = 'order'"
          >
            ขอ
          </button>
        </div>

        <div v-if="modalMode !== 'empty'" class="po__qty">
          <button type="button" class="po__step" @click="bumpModal(-1)">−</button>
          <input
            class="po__num"
            type="text"
            inputmode="decimal"
            :placeholder="modalMode === 'order' ? 'ต้องการกี่' : 'จำนวน (ไม่บังคับ)'"
            :value="modalRemaining"
            @input="onModalRemainingInput"
          />
          <button type="button" class="po__step" @click="bumpModal(1)">+</button>
        </div>
        <p v-if="modalError" class="po__sheet-hint po__sheet-hint--err">
          {{ modalError }}
        </p>
        <p v-else-if="modalMode === 'empty'" class="po__sheet-hint">
          ของหมดแล้ว · ไม่ต้องใส่เลข
        </p>
        <p v-else-if="modalMode === 'order'" class="po__sheet-hint">
          ใส่จำนวนที่ต้องการขอ
        </p>
        <p v-else-if="!modalRemaining.trim()" class="po__sheet-hint">
          ไม่ใส่เลขก็ได้ · แค่บอกว่ายังเหลือ
        </p>

        <button type="button" class="po__primary" @click="saveModal">
          {{ editingId ? "บันทึก" : "ใส่ในลิสต์" }}
        </button>
      </div>
    </div>

    </template>
  </div>
</template>

<style scoped>
.po {
  --po-ink: #1a1212;
  --po-red: #c62828;
  --po-red-deep: #8e1b1b;
  --po-red-soft: #fde8e8;
  --po-paper: #ffffff;
  --po-snow: #f7f4f4;
  --kb-inset: 0px;
  box-sizing: border-box;
  min-height: 100dvh;
  max-width: 26rem;
  margin: 0 auto;
  padding: 0.85rem 0.85rem 5.75rem;
  background: var(--po-snow);
  color: var(--po-ink);
  font-family: "IBM Plex Sans Thai", system-ui, sans-serif;
  /* Android Chrome: กันดึงลงแล้วรีโหลดทั้งหน้า */
  overscroll-behavior: none;
  overscroll-behavior-y: none;
  -webkit-overflow-scrolling: touch;
}
.po--gate {
  max-width: none;
  width: 100%;
  padding: 0;
  background: #ffffff;
}
.po *,
.po *::before,
.po *::after {
  box-sizing: border-box;
}
.po-gate {
  position: relative;
  min-height: 100dvh;
  display: flex;
  align-items: stretch;
  justify-content: center;
  overflow: hidden;
  color: var(--po-ink);
}
.po-gate__bg {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(100% 70% at 50% -5%, rgba(198, 40, 40, 0.16), transparent 55%),
    radial-gradient(80% 50% at 100% 100%, rgba(198, 40, 40, 0.08), transparent 50%),
    linear-gradient(180deg, #ffffff 0%, #fff8f8 48%, #ffffff 100%);
}
.po-gate__bg::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 0.35rem;
  background: linear-gradient(90deg, var(--po-red-deep), var(--po-red), #e85a5a);
}
.po-gate__bg::after {
  content: "";
  position: absolute;
  inset: 0;
  opacity: 0.045;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  pointer-events: none;
}
.po-gate__inner {
  position: relative;
  z-index: 1;
  width: min(26rem, 100%);
  margin: 0 auto;
  padding: calc(1.5rem + env(safe-area-inset-top)) 1.25rem
    calc(1.25rem + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  animation: po-rise 0.45s ease-out both;
}
@keyframes po-rise {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.po-gate__brand {
  margin: 0.55rem 0 0;
  font-family: "IBM Plex Sans Thai", system-ui, sans-serif;
  font-size: clamp(2.35rem, 9.5vw, 2.9rem);
  font-weight: 750;
  letter-spacing: -0.02em;
  line-height: 1.1;
  color: var(--po-red);
}
.po-gate__brand--sm {
  font-size: 1.45rem;
  letter-spacing: -0.01em;
  margin: 0;
}
.po-gate__title {
  margin: 0.55rem 0 0;
  font-size: 1.45rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--po-ink);
}
.po-gate__title--sm {
  font-size: 1.35rem;
  margin-top: 0.25rem;
}
.po-gate__lead {
  margin: 0.35rem 0 0;
  font-size: 0.95rem;
  color: #7a6666;
  font-weight: 400;
}
.po-gate__hint {
  margin: 0.85rem 0 0;
  text-align: center;
  font-size: 0.84rem;
  color: #9a8585;
  min-height: 1.25rem;
}
.po-gate__err {
  margin: 0.85rem 0 0;
  text-align: center;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--po-red);
  min-height: 1.25rem;
}
.po-gate__out {
  border: 1px solid #ead4d4;
  background: #fff;
  color: #7a6666;
  border-radius: 999px;
  padding: 0.45rem 0.9rem;
  font-size: 0.85rem;
  font-weight: 600;
}
.po-pin {
  display: flex;
  justify-content: center;
  gap: 0.85rem;
  margin-top: 1.75rem;
}
.po-pin.is-shake {
  animation: po-shake 0.4s ease;
}
.po-pin.is-busy {
  opacity: 0.65;
}
@keyframes po-shake {
  0%,
  100% {
    transform: translateX(0);
  }
  20% {
    transform: translateX(-8px);
  }
  40% {
    transform: translateX(8px);
  }
  60% {
    transform: translateX(-5px);
  }
  80% {
    transform: translateX(5px);
  }
}
.po-pin__dot {
  width: 0.95rem;
  height: 0.95rem;
  border-radius: 999px;
  border: 2px solid #e0c8c8;
  background: transparent;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    transform 0.15s ease;
}
.po-pin__dot.is-on {
  background: var(--po-red);
  border-color: var(--po-red);
  transform: scale(1.08);
  box-shadow: 0 0 0 4px rgba(198, 40, 40, 0.14);
}
.po-pad {
  margin-top: auto;
  padding-top: 1.5rem;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.55rem;
}
.po-pad__key {
  min-height: 3.55rem;
  border: 1px solid #eddede;
  border-radius: 1rem;
  background: #fff;
  color: var(--po-ink);
  font-size: 1.45rem;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  box-shadow: 0 1px 0 rgba(142, 27, 27, 0.04);
  touch-action: manipulation;
  transition:
    background 0.12s ease,
    border-color 0.12s ease,
    transform 0.08s ease;
}
.po-pad__key:active:not(:disabled) {
  background: var(--po-red-soft);
  border-color: #e5b0b0;
  color: var(--po-red-deep);
  transform: scale(0.97);
}
.po-pad__key:disabled {
  opacity: 0.35;
}
.po-pad__key.is-ghost {
  visibility: hidden;
  pointer-events: none;
}
.po-pad__key.is-action {
  font-size: 1.2rem;
  color: #8a7070;
  background: var(--po-snow);
}
.po-branch__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 0.35rem;
}
.po-branch__list {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  margin-top: 1.5rem;
  flex: 1;
}
.po-branch__card {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.85rem;
  width: 100%;
  text-align: left;
  border: 1px solid #ead4d4;
  background: #fff;
  border-radius: 1.05rem;
  padding: 1.05rem 1.1rem;
  color: var(--po-ink);
  box-shadow: 0 8px 24px rgba(142, 27, 27, 0.06);
  touch-action: manipulation;
  transition:
    background 0.15s ease,
    transform 0.12s ease,
    border-color 0.15s ease;
}
.po-branch__card:active:not(:disabled) {
  background: var(--po-red-soft);
  border-color: #e5b0b0;
  transform: scale(0.985);
}
.po-branch__card:disabled {
  opacity: 0.55;
}
.po-branch__code {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2.6rem;
  height: 2.6rem;
  border-radius: 0.75rem;
  background: var(--po-red);
  border: 0;
  color: #fff;
  font-size: 0.78rem;
  font-weight: 750;
  letter-spacing: 0.04em;
}
.po-branch__name {
  font-size: 1.2rem;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.po-branch__go {
  font-size: 1.25rem;
  color: var(--po-red);
  opacity: 0.7;
}
.po__form {
  padding-bottom: 0.5rem;
}
.po__sticky {
  position: sticky;
  top: 0;
  z-index: 25;
  background: #f7f4f4f5;
  padding: 0.15rem 0 0.35rem;
  margin: 0 -0.15rem;
  padding-left: 0.15rem;
  padding-right: 0.15rem;
}
.po__top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}
.po__top h1 {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 750;
}
.po__sub {
  margin: 0.2rem 0 0;
  font-size: 0.85rem;
  color: #6b6b6b;
}
.po__textbtn {
  border: 0;
  background: transparent;
  color: #6b6b6b;
  font-size: 0.9rem;
  padding: 0.25rem 0;
}
.po__flash {
  margin: 0 0 0.65rem;
  padding: 0.55rem 0.7rem;
  border-radius: 0.55rem;
  font-size: 0.88rem;
}
.po__flash--err {
  background: #fde8e8;
  color: #9b1c1c;
}
.po__flash--ok {
  background: #e5f6ea;
  color: #14532d;
}
.po__primary,
.po__secondary {
  border: 0;
  border-radius: 0.85rem;
  font-weight: 700;
  font-size: 1.05rem;
  min-height: 3.1rem;
  padding: 0.75rem 1rem;
}
.po__primary {
  background: var(--po-red);
  color: #fff;
  width: 100%;
}
.po__primary:disabled {
  opacity: 0.4;
}
.po__primary.is-sent {
  background: #1b7a45;
  opacity: 1;
}
.po__secondary {
  background: #f0eaea;
  color: #1a1212;
}
.po__toast {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: calc(4.6rem + env(safe-area-inset-bottom));
  z-index: 40;
  width: min(24rem, calc(100% - 1.5rem));
  padding: 0.85rem 1rem;
  border-radius: 0.85rem;
  background: #14532d;
  color: #fff;
  font-size: 1rem;
  font-weight: 700;
  text-align: center;
  box-shadow: 0 10px 28px rgba(20, 83, 45, 0.35);
  animation: po-toast-in 0.28s ease-out both;
}
@keyframes po-toast-in {
  from {
    opacity: 0;
    transform: translate(-50%, 12px);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}
.po__add {
  position: relative;
  display: flex;
  gap: 0.4rem;
  margin-bottom: 1rem;
}
.po__add.is-open {
  z-index: 35;
}
.po__search {
  flex: 1;
  min-width: 0;
  border: 1px solid #ddd;
  border-radius: 0.75rem;
  padding: 0.85rem 0.9rem;
  font-size: 1.05rem;
  background: #fff;
  min-height: 3.1rem;
}
.po__addbtn {
  width: 3.4rem;
  min-height: 3.1rem;
  border: 0;
  border-radius: 0.75rem;
  background: var(--po-red);
  color: #fff;
  font-size: 1.7rem;
  font-weight: 700;
  touch-action: manipulation;
}
.po__suggest {
  position: absolute;
  z-index: 40;
  left: 0;
  right: 3.6rem;
  top: calc(100% + 2px);
  margin: 0;
  padding: 0.25rem 0;
  list-style: none;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 0.65rem;
  max-height: 11.5rem;
  overflow: auto;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.12);
  -webkit-overflow-scrolling: touch;
}
.po__suggest li {
  padding: 0.85rem 0.9rem;
  font-size: 1.05rem;
  touch-action: manipulation;
}
.po__suggest li:active {
  background: var(--po-red-soft);
}
/* ตอนพิมพ์ — ซ่อนแถบล่างแบบนิ่ง (ไม่ผูกกับความสูงคีย์บอร์ดที่กระพริบ) */
.po--typing .po__dock {
  visibility: hidden;
  pointer-events: none;
}
.po__list-title {
  margin: 0.15rem 0 0;
  font-size: 0.92rem;
  font-weight: 700;
  display: flex;
  justify-content: space-between;
  color: #444;
}
.po__list-title span {
  color: var(--po-red);
}
.po__empty {
  padding: 2.5rem 0.5rem;
  text-align: center;
  color: #8a8a8a;
  font-size: 0.95rem;
  line-height: 1.5;
}
.po__list {
  list-style: none;
  margin: 0.4rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.po__item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 3.25rem;
  gap: 0.4rem;
  align-items: center;
  background: #fff;
  border: 1px solid #e5e5e1;
  border-radius: 0.65rem;
  padding: 0.35rem 0.35rem 0.35rem 0.65rem;
  min-height: 3rem;
}
.po__item-info {
  border: 0;
  background: transparent;
  text-align: left;
  padding: 0.35rem 0;
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.35rem 0.55rem;
  min-width: 0;
  font: inherit;
  color: inherit;
  touch-action: manipulation;
}
.po__item-info strong {
  font-size: 0.98rem;
  font-weight: 700;
  line-height: 1.2;
  min-width: 0;
}
.po__badge {
  font-size: 0.84rem;
  font-weight: 750;
  color: var(--po-red);
  white-space: nowrap;
}
.po__badge.is-spare {
  color: #8a6a00;
}
.po__badge.is-out {
  color: #9b1c1c;
}
.po__badge.is-order {
  color: #0b6e4f;
}
.po__act {
  border: 0;
  border-radius: 0.55rem;
  min-height: 2.75rem;
  font-size: 0.88rem;
  font-weight: 750;
  background: #ecece8;
  color: #222;
  touch-action: manipulation;
}
.po__act--del {
  background: #fde8e8;
  color: #9b1c1c;
}
.po__act:active {
  filter: brightness(0.96);
}
.po__dock {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: 0;
  width: min(26rem, 100%);
  z-index: 30;
  display: grid;
  grid-template-columns: 5rem 1fr;
  gap: 0.45rem;
  padding: 0.65rem 1rem calc(0.65rem + env(safe-area-inset-bottom));
  background: #fffffff2;
  border-top: 1px solid #ead4d4;
}
.po__modal {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: rgba(20, 20, 20, 0.45);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  /* เลื่อน sheet เหนือคีย์บอร์ดตอนพิมพ์จำนวน — ไม่มี transition กันเด้ง */
  padding-bottom: var(--kb-inset, 0px);
}
.po__sheet {
  width: min(26rem, 100%);
  max-height: min(32rem, calc(100dvh - var(--kb-inset, 0px) - 0.75rem));
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  background: #fff;
  border-radius: 1.1rem 1.1rem 0 0;
  padding: 1rem 1rem calc(1rem + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.po__sheet-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.po__sheet-head h2 {
  margin: 0;
  font-size: 1.1rem;
}
.po__sheet-name {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 750;
}
.po__sheet-hint {
  margin: 0;
  text-align: center;
  color: #8a8a8a;
  font-size: 0.9rem;
}
.po__sheet-hint--err {
  color: #9b1c1c;
  font-weight: 650;
}
.po__modes {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr;
  gap: 0.35rem;
}
.po__mode {
  height: 2.8rem;
  border: 1px solid #ddd;
  border-radius: 0.7rem;
  background: #fff;
  font-size: 0.95rem;
  font-weight: 700;
  color: #555;
}
.po__mode.is-on {
  background: var(--po-red-soft);
  border-color: var(--po-red);
  color: var(--po-red-deep);
}
.po__mode.is-on.is-spare {
  background: #fff4d6;
  border-color: #e6c35c;
  color: #8a6a00;
}
.po__mode.is-on.is-out {
  background: #fde8e8;
  border-color: #e5a0a0;
  color: #9b1c1c;
}
.po__mode.is-on.is-order {
  background: #e6f6ef;
  border-color: #7bc4a4;
  color: #0b6e4f;
}
.po__qty {
  display: grid;
  grid-template-columns: 3.2rem 1fr 3.2rem;
  gap: 0.4rem;
}
.po__step {
  height: 3rem;
  border: 1px solid #ddd;
  border-radius: 0.7rem;
  background: #f7f7f5;
  font-size: 1.4rem;
  font-weight: 700;
}
.po__num {
  height: 3rem;
  border: 1px solid #ddd;
  border-radius: 0.7rem;
  text-align: center;
  font-size: 1.35rem;
  font-weight: 750;
  background: #fff;
  min-width: 0;
}
</style>
