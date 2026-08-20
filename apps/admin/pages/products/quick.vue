<script setup lang="ts">
type Product = {
  id: string;
  barcode: string;
  productCode?: string | null;
  name: string;
  unit: string;
  price: number | null;
  isQuick: boolean;
  quickSort: number;
  isOpenPrice: boolean;
  active?: boolean;
  imageUrl?: string | null;
};

const PAGE_SIZE = 16;
const MIN_TABS = 2;

const { get, put, assetUrl } = useAdminApi();
const { askConfirm } = useConfirmDialog();
const pending = ref(false);
const saving = ref(false);
const error = ref("");
const message = ref("");
const all = ref<Product[]>([]);
/** แต่ละแท็บ = รายการสูงสุด PAGE_SIZE */
const tabs = ref<Product[][]>([[], []]);
const activeTab = ref(0);
const dragFrom = ref<{ tab: number; index: number } | null>(null);
const addQ = ref("");
const addPage = ref(0);

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveSeq = 0;

const eligible = computed(() =>
  all.value.filter((p) => p.price != null && !p.isOpenPrice && p.active !== false),
);

const boardIds = computed(() => new Set(tabs.value.flat().map((p) => p.id)));

const totalCount = computed(() => tabs.value.reduce((n, t) => n + t.length, 0));

const activeItems = computed(() => tabs.value[activeTab.value] ?? []);

const slots = computed(() => {
  const items = activeItems.value;
  return Array.from({ length: PAGE_SIZE }, (_, i) => ({
    index: i,
    item: items[i] ?? null,
  }));
});

function matchesQuery(p: Product, q: string) {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return (
    p.name.toLowerCase().includes(s) ||
    p.barcode.toLowerCase().includes(s) ||
    (p.productCode ?? "").toLowerCase().includes(s)
  );
}

const availableAll = computed(() => {
  const s = addQ.value.trim();
  return eligible.value
    .filter((p) => !boardIds.value.has(p.id))
    .filter((p) => matchesQuery(p, s))
    .sort((a, b) => a.name.localeCompare(b.name, "th"));
});

const addPageCount = computed(() =>
  Math.max(1, Math.ceil(availableAll.value.length / PAGE_SIZE)),
);

const available = computed(() => {
  const start = addPage.value * PAGE_SIZE;
  return availableAll.value.slice(start, start + PAGE_SIZE);
});

/** แท็บที่จะต่อท้ายเมื่อกดเพิ่ม (ตามรายการสุดท้ายจริง) */
const appendHint = computed(() => {
  const { tabIndex, isNew } = resolveAppendTarget(tabs.value);
  if (isNew) return `แท็บใหม่ (${tabIndex + 1})`;
  const len = tabs.value[tabIndex]?.length ?? 0;
  return `แท็บ ${tabIndex + 1} ช่อง ${len + 1}`;
});

watch(addQ, () => {
  addPage.value = 0;
});

watch(addPageCount, (n) => {
  if (addPage.value > n - 1) addPage.value = Math.max(0, n - 1);
});

function resolveAppendTarget(current: Product[][]) {
  let lastTab = -1;
  for (let i = current.length - 1; i >= 0; i--) {
    if ((current[i]?.length ?? 0) > 0) {
      lastTab = i;
      break;
    }
  }
  if (lastTab < 0) {
    return { tabIndex: 0, isNew: false };
  }
  if ((current[lastTab]?.length ?? 0) < PAGE_SIZE) {
    return { tabIndex: lastTab, isNew: false };
  }
  if (lastTab + 1 < current.length) {
    return { tabIndex: lastTab + 1, isNew: false };
  }
  return { tabIndex: lastTab + 1, isNew: true };
}

function chunkBoard(list: Product[]): Product[][] {
  const out: Product[][] = [];
  for (let i = 0; i < list.length; i += PAGE_SIZE) {
    out.push(list.slice(i, i + PAGE_SIZE));
  }
  while (out.length < MIN_TABS) out.push([]);
  return out;
}

async function load() {
  pending.value = true;
  error.value = "";
  try {
    const data = await get<{ products: Product[] }>("/products");
    all.value = data.products ?? [];
    const board = [...all.value]
      .filter((p) => p.isQuick)
      .sort((a, b) => a.quickSort - b.quickSort);
    const keepCount = Math.max(MIN_TABS, tabs.value.length, chunkBoard(board).length);
    const next = chunkBoard(board);
    while (next.length < keepCount) next.push([]);
    tabs.value = next;
    if (activeTab.value >= tabs.value.length) activeTab.value = 0;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "โหลดไม่สำเร็จ";
  } finally {
    pending.value = false;
  }
}

function addTab() {
  tabs.value = [...tabs.value, []];
  activeTab.value = tabs.value.length - 1;
}

async function removeTab(tabIndex: number) {
  if (tabs.value.length <= MIN_TABS) return;
  const items = tabs.value[tabIndex] ?? [];
  if (items.length) {
    const ok = await askConfirm({
      title: "ลบแท็บ",
      message: `แท็บ ${tabIndex + 1} มี ${items.length} รายการ — ลบแท็บแล้วจะจัดเรียงรวมใหม่ทีละ ${PAGE_SIZE}?`,
      detail: "ลำดับรวมจะถูกบันทึกอัตโนมัติ",
      confirmLabel: "ลบแท็บ",
    });
    if (!ok) return;
    const flat = tabs.value.flat();
    tabs.value = chunkBoard(flat);
  } else {
    const copy = tabs.value.filter((_, i) => i !== tabIndex);
    while (copy.length < MIN_TABS) copy.push([]);
    tabs.value = copy;
  }
  if (activeTab.value >= tabs.value.length) {
    activeTab.value = tabs.value.length - 1;
  } else if (activeTab.value > tabIndex) {
    activeTab.value -= 1;
  }
  scheduleSave("อัปเดตแท็บ · กำลังบันทึก…");
}

function selectTab(i: number) {
  activeTab.value = i;
}

function onDragStart(index: number, e: DragEvent) {
  if (!activeItems.value[index]) {
    e.preventDefault();
    return;
  }
  dragFrom.value = { tab: activeTab.value, index };
  e.dataTransfer?.setData("text/plain", `${activeTab.value}:${index}`);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
}

function onDragOver(e: DragEvent) {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
}

function onDropSlot(toIndex: number, e: DragEvent) {
  e.preventDefault();
  const from = dragFrom.value;
  dragFrom.value = null;
  if (!from) return;
  moveItem(from.tab, from.index, activeTab.value, toIndex);
}

function onDropTab(toTab: number, e: DragEvent) {
  e.preventDefault();
  const from = dragFrom.value;
  dragFrom.value = null;
  if (!from) return;
  const targetLen = tabs.value[toTab]?.length ?? 0;
  if (from.tab === toTab) return;
  if (targetLen >= PAGE_SIZE) {
    error.value = `แท็บ ${toTab + 1} เต็มแล้ว (สูงสุด ${PAGE_SIZE})`;
    return;
  }
  moveItem(from.tab, from.index, toTab, targetLen);
}

function moveItem(fromTab: number, fromIndex: number, toTab: number, toIndex: number) {
  const next = tabs.value.map((t) => [...t]);
  const src = next[fromTab];
  const dst = next[toTab];
  if (!src || !dst) return;
  const [item] = src.splice(fromIndex, 1);
  if (!item) return;

  if (fromTab === toTab) {
    const clamped = Math.max(0, Math.min(toIndex, src.length));
    src.splice(clamped, 0, item);
  } else {
    if (dst.length >= PAGE_SIZE) {
      error.value = `แท็บ ${toTab + 1} เต็มแล้ว (สูงสุด ${PAGE_SIZE})`;
      src.splice(fromIndex, 0, item);
      return;
    }
    const clamped = Math.max(0, Math.min(toIndex, dst.length));
    dst.splice(clamped, 0, item);
  }
  tabs.value = next;
  scheduleSave("เรียงลำดับแล้ว · กำลังบันทึก…");
}

function moveWithin(index: number, dir: -1 | 1) {
  const to = index + dir;
  if (to < 0 || to >= activeItems.value.length) return;
  moveItem(activeTab.value, index, activeTab.value, to);
}

function sendToTab(index: number, toTab: number) {
  if (toTab === activeTab.value) return;
  const targetLen = tabs.value[toTab]?.length ?? 0;
  if (targetLen >= PAGE_SIZE) {
    error.value = `แท็บ ${toTab + 1} เต็มแล้ว (สูงสุด ${PAGE_SIZE})`;
    return;
  }
  moveItem(activeTab.value, index, toTab, targetLen);
}

function onSendToTab(index: number, e: Event) {
  const el = e.target as HTMLSelectElement;
  sendToTab(index, Number(el.value));
  el.value = String(activeTab.value);
}

async function removeAt(index: number) {
  const item = activeItems.value[index];
  if (!item) return;
  const ok = await askConfirm({
    title: "เอาออกจากแผงด่วน",
    message: `เอา 「${item.name}」 ออกจากแผงสินค้าด่วน?`,
    detail: "ระบบจะอัปเดตแผงบน POS อัตโนมัติหลังบันทึก",
    confirmLabel: "เอาออก",
  });
  if (!ok) return;
  const next = tabs.value.map((t) => [...t]);
  next[activeTab.value]?.splice(index, 1);
  tabs.value = next;
  scheduleSave("เอาออกแล้ว · กำลังบันทึก…");
}

function addProduct(p: Product) {
  if (boardIds.value.has(p.id)) return;
  const next = tabs.value.map((t) => [...t]);
  const { tabIndex, isNew } = resolveAppendTarget(next);
  if (isNew || !next[tabIndex]) {
    while (next.length <= tabIndex) next.push([]);
  }
  next[tabIndex] = [...(next[tabIndex] ?? []), p];
  tabs.value = next;
  activeTab.value = tabIndex;
  scheduleSave(`เพิ่ม 「${p.name}」 ต่อท้าย · กำลังบันทึก…`);
}

async function persistBoard() {
  const seq = ++saveSeq;
  saving.value = true;
  error.value = "";
  try {
    await put("/products/quick-board", {
      productIds: tabs.value.flat().map((p) => p.id),
    });
    if (seq !== saveSeq) return;
    message.value = "อัปเดตแผงสินค้าด่วนแล้ว · POS จะดึงรอบ sync ถัดไป";
    const data = await get<{ products: Product[] }>("/products");
    if (seq !== saveSeq) return;
    all.value = data.products ?? [];
  } catch (e) {
    if (seq !== saveSeq) return;
    error.value = e instanceof Error ? e.message : "บันทึกไม่สำเร็จ";
    message.value = "";
  } finally {
    if (seq === saveSeq) saving.value = false;
  }
}

function scheduleSave(pendingMsg?: string) {
  if (pendingMsg) message.value = pendingMsg;
  error.value = "";
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persistBoard();
  }, 350);
}

onMounted(load);
onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer);
});
</script>

<template>
  <div class="qb">
    <div class="ui-page-head">
      <div>
        <h1 class="ui-page-title">สินค้าด่วน</h1>
        <p class="ui-page-sub">
          แท็บละ {{ PAGE_SIZE }} รายการ · ลากเรียง / ย้ายแท็บ · บันทึกอัตโนมัติ · รวม
          {{ totalCount }} รายการ
        </p>
      </div>
      <div class="ui-page-head__actions">
        <span v-if="saving" class="qb-save-status">กำลังบันทึก…</span>
        <span v-else-if="message && !error" class="qb-save-status qb-save-status--ok">
          บันทึกอัตโนมัติ
        </span>
        <button type="button" class="ui-btn ui-btn--ghost" :disabled="pending" @click="load">
          {{ pending ? "กำลังโหลด..." : "รีเฟรช" }}
        </button>
      </div>
    </div>

    <div v-if="error" class="ui-empty">{{ error }}</div>
    <div v-else-if="message" class="qb-flash">{{ message }}</div>

    <div class="qb-layout">
      <section class="ui-card qb-panel qb-panel--board">
        <div class="qb-tabs" @dragover="onDragOver">
          <button
            v-for="(tab, i) in tabs"
            :key="i"
            type="button"
            class="qb-tab"
            :class="{ 'is-active': activeTab === i }"
            @click="selectTab(i)"
            @dragover="onDragOver"
            @drop="onDropTab(i, $event)"
          >
            <span class="qb-tab__label">แท็บ {{ i + 1 }}</span>
            <span class="qb-tab__count">{{ tab.length }}/{{ PAGE_SIZE }}</span>
            <span
              v-if="tabs.length > MIN_TABS"
              class="qb-tab__x"
              title="ลบแท็บ"
              @click.stop="removeTab(i)"
            >
              ×
            </span>
          </button>
          <button type="button" class="qb-tab qb-tab--add" title="เพิ่มแท็บ" @click="addTab">
            + แท็บ
          </button>
        </div>

        <div class="qb-panel__meta">
          <h2>แผงแท็บ {{ activeTab + 1 }}</h2>
          <span>ลากเรียง · ↑↓ · เลือกแท็บเพื่อย้าย</span>
        </div>

        <div v-if="pending && !totalCount" class="qb-hint">กำลังโหลด...</div>
        <ul v-else class="qb-slots">
          <li
            v-for="slot in slots"
            :key="slot.index"
            class="qb-slot"
            :class="{
              'is-empty': !slot.item,
              'is-dragging':
                dragFrom?.tab === activeTab && dragFrom?.index === slot.index,
            }"
            :draggable="Boolean(slot.item)"
            @dragstart="onDragStart(slot.index, $event)"
            @dragover="onDragOver"
            @drop="onDropSlot(slot.index, $event)"
            @dragend="dragFrom = null"
          >
            <template v-if="slot.item">
              <span class="qb-slot__grip" title="ลาก">⋮⋮</span>
              <span class="qb-slot__seq">{{ slot.index + 1 }}</span>
              <div class="qb-slot__thumb">
                <img
                  v-if="slot.item.imageUrl"
                  :src="assetUrl(slot.item.imageUrl)"
                  :alt="slot.item.name"
                />
              </div>
              <div class="qb-slot__info">
                <NuxtLink
                  class="qb-slot__name qb-slot__name--link"
                  :to="`/products?edit=${slot.item.id}&from=quick`"
                  :title="`แก้ไข · ${slot.item.name}`"
                  @click.stop
                >
                  {{ slot.item.name }}
                </NuxtLink>
                <span class="qb-slot__meta">
                  {{ slot.item.productCode || "-" }} · {{ slot.item.price?.toFixed(0) }}฿
                </span>
              </div>
              <div class="qb-slot__actions">
                <NuxtLink
                  class="qb-icon-btn qb-icon-btn--link"
                  :to="`/products?edit=${slot.item.id}&from=quick`"
                  title="แก้ไขสินค้า"
                  @click.stop
                >
                  ✎
                </NuxtLink>
                <button
                  type="button"
                  class="qb-icon-btn"
                  title="ขึ้น"
                  :disabled="slot.index === 0"
                  @click="moveWithin(slot.index, -1)"
                >
                  ↑
                </button>
                <button
                  type="button"
                  class="qb-icon-btn"
                  title="ลง"
                  :disabled="slot.index >= activeItems.length - 1"
                  @click="moveWithin(slot.index, 1)"
                >
                  ↓
                </button>
                <select
                  class="qb-tab-select"
                  :value="activeTab"
                  title="ย้ายไปแท็บ"
                  @change="onSendToTab(slot.index, $event)"
                >
                  <option v-for="(_, ti) in tabs" :key="ti" :value="ti">
                    T{{ ti + 1 }}
                  </option>
                </select>
                <button
                  type="button"
                  class="qb-icon-btn qb-icon-btn--danger"
                  title="เอาออก"
                  @click="removeAt(slot.index)"
                >
                  ×
                </button>
              </div>
            </template>
            <template v-else>
              <span class="qb-slot__seq qb-slot__seq--empty">{{ slot.index + 1 }}</span>
              <span class="qb-slot__empty">ว่าง</span>
            </template>
          </li>
        </ul>
      </section>

      <section class="ui-card qb-panel qb-panel--add">
        <div class="qb-panel__head">
          <h2>เพิ่มเข้าแผง</h2>
          <p class="qb-panel__hint">
            แสดงทีละ {{ PAGE_SIZE }} · กดเพิ่มจะต่อท้ายที่ {{ appendHint }}
          </p>
          <input
            v-model="addQ"
            class="ui-input qb-search"
            type="search"
            placeholder="ค้นหาชื่อ / รหัส / บาร์โค้ด…"
            autocomplete="off"
          />
        </div>

        <div v-if="!availableAll.length" class="qb-hint">
          {{ addQ.trim() ? "ไม่พบสินค้าที่เพิ่มได้" : "ไม่มีสินค้าให้เพิ่ม" }}
        </div>
        <template v-else>
          <ul class="qb-add-list">
            <li v-for="p in available" :key="p.id" class="qb-add-row">
              <div class="qb-slot__thumb">
                <img v-if="p.imageUrl" :src="assetUrl(p.imageUrl)" :alt="p.name" />
              </div>
              <div class="qb-slot__info">
                <div class="qb-slot__name">{{ p.name }}</div>
                <div class="qb-slot__meta">
                  {{ p.productCode || "-" }} · {{ p.price?.toFixed(0) }}฿
                </div>
              </div>
              <div class="qb-add-actions">
                <NuxtLink
                  class="qb-icon-btn qb-icon-btn--link"
                  :to="`/products?edit=${p.id}&from=quick`"
                  title="แก้ไขสินค้า"
                >
                  ✎
                </NuxtLink>
                <button
                  type="button"
                  class="ui-btn ui-btn--primary qb-add-btn"
                  :disabled="saving"
                  @click="addProduct(p)"
                >
                  เพิ่ม
                </button>
              </div>
            </li>
          </ul>
          <div class="qb-add-pager">
            <button
              type="button"
              class="qb-icon-btn"
              :disabled="addPage <= 0"
              title="หน้าก่อน"
              @click="addPage = Math.max(0, addPage - 1)"
            >
              ‹
            </button>
            <span>
              {{ addPage + 1 }}/{{ addPageCount }}
              <small>· {{ availableAll.length }} รายการ</small>
            </span>
            <button
              type="button"
              class="qb-icon-btn"
              :disabled="addPage >= addPageCount - 1"
              title="หน้าถัดไป"
              @click="addPage = Math.min(addPageCount - 1, addPage + 1)"
            >
              ›
            </button>
          </div>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.qb {
  display: flex;
  flex-direction: column;
}

.qb-flash {
  margin-bottom: 0.75rem;
  padding: 0.65rem 0.9rem;
  border-radius: 0.65rem;
  background: #ecfdf5;
  color: #047857;
  font-size: 0.88rem;
  font-weight: 650;
}

.qb-layout {
  display: grid;
  grid-template-columns: minmax(0, 40rem) minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
  max-width: 76rem;
}

@media (max-width: 1100px) {
  .qb-layout {
    grid-template-columns: 1fr;
    max-width: none;
  }
}

.qb-save-status {
  align-self: center;
  font-size: 0.82rem;
  font-weight: 650;
  color: #64748b;
}

.qb-save-status--ok {
  color: #047857;
}

.qb-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.qb-panel--board {
  min-height: 0;
}

.qb-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  padding: 0.75rem 0.85rem 0.55rem;
  border-bottom: 1px solid #eef2f7;
  background: #f8fafc;
}

.qb-tab {
  appearance: none;
  border: 1px solid #dbe3ee;
  background: #fff;
  border-radius: 999px;
  padding: 0.4rem 0.75rem;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 700;
  color: #475569;
}

.qb-tab.is-active {
  border-color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 12%, white);
  color: var(--ui-primary-dark);
}

.qb-tab--add {
  border-style: dashed;
  color: #64748b;
  font-weight: 650;
}

.qb-tab__count {
  font-size: 0.72rem;
  font-weight: 750;
  font-variant-numeric: tabular-nums;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  background: #f1f5f9;
  color: #64748b;
}

.qb-tab.is-active .qb-tab__count {
  background: color-mix(in srgb, var(--ui-primary) 18%, white);
  color: var(--ui-primary-dark);
}

.qb-tab__x {
  display: inline-grid;
  place-items: center;
  width: 1.1rem;
  height: 1.1rem;
  border-radius: 999px;
  color: #94a3b8;
  font-weight: 800;
  line-height: 1;
}

.qb-tab__x:hover {
  background: #fee2e2;
  color: #b91c1c;
}

.qb-panel__meta,
.qb-panel__head {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.7rem 1rem 0.55rem;
  border-bottom: 1px solid #eef2f7;
}

.qb-panel__meta h2,
.qb-panel__head h2 {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 750;
  color: #0f172a;
}

.qb-panel__meta span,
.qb-panel__hint {
  font-size: 0.78rem;
  color: #64748b;
  font-weight: 600;
}

.qb-panel__hint {
  margin: 0;
}

.qb-search {
  width: 100%;
}

.qb-hint {
  padding: 1.5rem 1rem;
  text-align: center;
  color: #64748b;
  font-size: 0.9rem;
}

.qb-slots {
  list-style: none;
  margin: 0;
  padding: 0.5rem 0.55rem 0.65rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  overflow: auto;
}

.qb-slot {
  display: grid;
  grid-template-columns: 1.1rem 1.35rem 2.5rem minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.45rem;
  height: 2.85rem;
  padding: 0 0.55rem;
  border: 1px solid #e2e8f0;
  border-radius: 0.55rem;
  background: #fff;
  min-width: 0;
  cursor: grab;
  user-select: none;
}

.qb-slot:active {
  cursor: grabbing;
}

.qb-slot.is-empty {
  grid-template-columns: 1.35rem minmax(0, 1fr);
  background: #f8fafc;
  border-style: dashed;
  color: #94a3b8;
  cursor: default;
}

.qb-slot.is-dragging {
  opacity: 0.55;
  border-color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 8%, white);
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
}

.qb-slot__grip {
  color: #94a3b8;
  font-size: 0.78rem;
  letter-spacing: -0.06em;
  line-height: 1;
  text-align: center;
}

.qb-slot.is-empty .qb-slot__grip {
  display: none;
}

.qb-slot__seq {
  width: 1.35rem;
  height: 1.35rem;
  display: inline-grid;
  place-items: center;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-primary) 14%, white);
  color: var(--ui-primary-dark);
  font-size: 0.7rem;
  font-weight: 750;
  flex-shrink: 0;
}

.qb-slot__seq--empty {
  background: #e2e8f0;
  color: #64748b;
}

.qb-slot__empty {
  font-size: 0.78rem;
  font-weight: 600;
}

.qb-slot__thumb {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.4rem;
  overflow: hidden;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  flex-shrink: 0;
}

.qb-slot__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.qb-slot__info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  justify-content: center;
}

.qb-slot__name {
  font-size: 0.86rem;
  font-weight: 700;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.15;
}

.qb-slot__name--link {
  text-decoration: none;
  color: inherit;
}

.qb-slot__name--link:hover {
  color: #1d4ed8;
  text-decoration: underline;
}

.qb-slot__meta {
  font-size: 0.7rem;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.qb-slot__actions {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  flex-shrink: 0;
}

.qb-icon-btn {
  appearance: none;
  width: 1.55rem;
  height: 1.55rem;
  border: 1px solid #dbe3ee;
  border-radius: 0.35rem;
  background: #fff;
  color: #475569;
  font-size: 0.72rem;
  font-weight: 800;
  cursor: pointer;
  line-height: 1;
  padding: 0;
  flex-shrink: 0;
}

.qb-icon-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.qb-icon-btn--danger {
  color: #b91c1c;
  border-color: #fecaca;
  background: #fff5f5;
}

.qb-icon-btn--link {
  display: inline-grid;
  place-items: center;
  text-decoration: none;
  color: #1d4ed8;
  border-color: #bfdbfe;
  background: #eff6ff;
}

.qb-add-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  flex-shrink: 0;
}

.qb-tab-select {
  height: 1.55rem;
  border: 1px solid #dbe3ee;
  border-radius: 0.35rem;
  background: #fff;
  font: inherit;
  font-size: 0.68rem;
  font-weight: 700;
  color: #475569;
  padding: 0 0.2rem;
  max-width: 2.7rem;
  flex-shrink: 0;
}

.qb-add-btn {
  padding: 0.28rem 0.6rem;
  font-size: 0.78rem;
  white-space: nowrap;
}

.qb-add-list {
  list-style: none;
  margin: 0;
  padding: 0.5rem 0.55rem 0.35rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  overflow: auto;
  flex: 1;
  min-height: 0;
}

.qb-add-row {
  display: grid;
  grid-template-columns: 2.5rem minmax(0, 1fr) auto;
  gap: 0.45rem;
  align-items: center;
  height: 2.85rem;
  padding: 0 0.55rem;
  border: 1px solid #e2e8f0;
  border-radius: 0.55rem;
  background: #fff;
  min-width: 0;
}

.qb-add-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.65rem;
  padding: 0.55rem 0.75rem 0.7rem;
  border-top: 1px solid #eef2f7;
  font-size: 0.8rem;
  font-weight: 700;
  color: #475569;
  font-variant-numeric: tabular-nums;
}

.qb-add-pager small {
  font-weight: 600;
  color: #94a3b8;
  margin-left: 0.2rem;
}

.qb-add-pager .qb-icon-btn {
  width: 1.85rem;
  height: 1.85rem;
  font-size: 1rem;
}
</style>
