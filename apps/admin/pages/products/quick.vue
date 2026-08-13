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

const { get, put, assetUrl } = useAdminApi();
const { askConfirm } = useConfirmDialog();
const pending = ref(false);
const saving = ref(false);
const error = ref("");
const message = ref("");
const all = ref<Product[]>([]);
const board = ref<Product[]>([]);
const dragIndex = ref<number | null>(null);
const addQ = ref("");
const boardQ = ref("");

/** รวมคำขอบันทึกติด ๆ กัน (ลากวางหลายครั้ง) */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveSeq = 0;

const eligible = computed(() =>
  all.value.filter((p) => p.price != null && !p.isOpenPrice && p.active !== false),
);

const boardIds = computed(() => new Set(board.value.map((p) => p.id)));

function matchesQuery(p: Product, q: string) {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return (
    p.name.toLowerCase().includes(s) ||
    p.barcode.toLowerCase().includes(s) ||
    (p.productCode ?? "").toLowerCase().includes(s)
  );
}

const boardView = computed(() => {
  const s = boardQ.value.trim();
  if (!s) return board.value.map((item, index) => ({ item, index }));
  return board.value
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => matchesQuery(item, s));
});

const available = computed(() => {
  const s = addQ.value.trim();
  const list = eligible.value
    .filter((p) => !boardIds.value.has(p.id))
    .filter((p) => matchesQuery(p, s))
    .sort((a, b) => a.name.localeCompare(b.name, "th"));
  // ไม่ค้น = โชว์จำกัด, ค้นแล้วโชว์มากขึ้น
  return list.slice(0, s ? 80 : 30);
});

async function load() {
  pending.value = true;
  error.value = "";
  try {
    const data = await get<{ products: Product[] }>("/products");
    all.value = data.products ?? [];
    board.value = [...all.value]
      .filter((p) => p.isQuick)
      .sort((a, b) => a.quickSort - b.quickSort);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "โหลดไม่สำเร็จ";
  } finally {
    pending.value = false;
  }
}

function onDragStart(index: number, e: DragEvent) {
  dragIndex.value = index;
  e.dataTransfer?.setData("text/plain", String(index));
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
}

function onDragOver(e: DragEvent) {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
}

function onDrop(index: number, e: DragEvent) {
  e.preventDefault();
  const from = dragIndex.value;
  dragIndex.value = null;
  if (from == null || from === index) return;
  const next = [...board.value];
  const [item] = next.splice(from, 1);
  next.splice(index, 0, item);
  board.value = next;
  scheduleSave("เรียงลำดับแล้ว · กำลังบันทึก…");
}

async function removeAt(index: number) {
  const item = board.value[index];
  if (!item) return;
  const ok = await askConfirm({
    title: "เอาออกจากแผงด่วน",
    message: `เอา 「${item.name}」 ออกจากแผงสินค้าด่วน?`,
    detail: "ระบบจะอัปเดตแผงบน POS อัตโนมัติหลังบันทึก",
    confirmLabel: "เอาออก",
  });
  if (!ok) return;
  board.value = board.value.filter((_, i) => i !== index);
  scheduleSave("เอาออกแล้ว · กำลังบันทึก…");
}

function addProduct(p: Product) {
  if (boardIds.value.has(p.id)) return;
  board.value = [...board.value, p];
  scheduleSave(`เพิ่ม 「${p.name}」 · กำลังบันทึก…`);
}

/** บันทึกแผงขึ้น API — เรียกอัตโนมัติหลังเรียง/เพิ่ม/เอาออก */
async function persistBoard() {
  const seq = ++saveSeq;
  saving.value = true;
  error.value = "";
  try {
    await put("/products/quick-board", {
      productIds: board.value.map((p) => p.id),
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
          ลากเรียงหรือกดเพิ่ม — บันทึกอัตโนมัติ · เฉพาะสินค้าที่มีราคาคงที่
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
    <div v-else-if="message" class="ui-error" style="background: #ecfdf5; color: #047857">
      {{ message }}
    </div>

    <div class="qb-layout">
      <section class="ui-card qb-panel">
        <div class="qb-panel__head">
          <h2>แผงสินค้าด่วน ({{ board.length }})</h2>
          <input
            v-model="boardQ"
            class="ui-input qb-search"
            type="search"
            placeholder="ค้นหาในแผง…"
          />
        </div>

        <div v-if="pending && !board.length" class="qb-hint">กำลังโหลด...</div>
        <div v-else-if="!board.length" class="qb-hint">ยังไม่มีสินค้าด่วน — เพิ่มจากด้านขวา</div>
        <div v-else-if="!boardView.length" class="qb-hint">ไม่พบในแผงด่วน</div>
        <ul v-else class="qb-list">
          <li
            v-for="{ item, index } in boardView"
            :key="item.id"
            class="qb-row"
            :class="{ 'is-dragging': dragIndex === index }"
            draggable="true"
            @dragstart="onDragStart(index, $event)"
            @dragover="onDragOver"
            @drop="onDrop(index, $event)"
            @dragend="dragIndex = null"
          >
            <span class="qb-row__grip" title="ลาก">⋮⋮</span>
            <span class="qb-row__seq">{{ index + 1 }}</span>
            <div class="qb-row__thumb">
              <img
                v-if="item.imageUrl"
                :src="assetUrl(item.imageUrl)"
                :alt="item.name"
              />
            </div>
            <div class="qb-row__info">
              <div class="qb-row__name">{{ item.name }}</div>
              <div class="qb-row__meta">
                {{ item.productCode || "-" }} · {{ item.barcode }} ·
                {{ item.price?.toFixed(2) }} ฿
              </div>
            </div>
            <div class="qb-row__btns">
              <NuxtLink
                class="ui-btn ui-btn--ghost"
                :to="`/products?edit=${item.id}&from=quick`"
              >
                แก้ไข
              </NuxtLink>
              <button
                type="button"
                class="ui-btn ui-btn--ghost-danger"
                @click="removeAt(index)"
              >
                เอาออก
              </button>
            </div>
          </li>
        </ul>
      </section>

      <section class="ui-card qb-panel">
        <div class="qb-panel__head">
          <h2>เพิ่มเข้าแผง</h2>
          <input
            v-model="addQ"
            class="ui-input qb-search"
            type="search"
            placeholder="ค้นหาชื่อ / รหัส / บาร์โค้ด…"
            autocomplete="off"
          />
        </div>

        <div v-if="!available.length" class="qb-hint">
          {{ addQ.trim() ? "ไม่พบสินค้าที่เพิ่มได้" : "ไม่มีสินค้าให้เพิ่ม" }}
        </div>
        <ul v-else class="qb-list">
          <li v-for="p in available" :key="p.id" class="qb-row qb-row--add">
            <div class="qb-row__thumb">
              <img v-if="p.imageUrl" :src="assetUrl(p.imageUrl)" :alt="p.name" />
            </div>
            <div class="qb-row__info">
              <div class="qb-row__name">{{ p.name }}</div>
              <div class="qb-row__meta">
                {{ p.productCode || "-" }} · {{ p.price?.toFixed(2) }} ฿
                ·
                <NuxtLink
                  class="qb-row__edit"
                  :to="`/products?edit=${p.id}&from=quick`"
                >
                  แก้ไข
                </NuxtLink>
              </div>
            </div>
            <button
              type="button"
              class="ui-btn ui-btn--primary qb-row__add-btn"
              :disabled="saving"
              @click="addProduct(p)"
            >
              เพิ่ม
            </button>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.qb-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
}

@media (max-width: 960px) {
  .qb-layout {
    grid-template-columns: 1fr;
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
  overflow: hidden;
}

.qb-panel__head {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  padding: 1rem 1.1rem 0.75rem;
  border-bottom: 1px solid #eef2f7;
}

.qb-panel__head h2 {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  color: #0f172a;
}

.qb-search {
  width: 100%;
}

.qb-hint {
  padding: 1.75rem 1rem;
  text-align: center;
  color: #64748b;
  font-size: 0.9rem;
}

.qb-list {
  list-style: none;
  margin: 0;
  padding: 0.65rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  max-height: min(68vh, 38rem);
  overflow: auto;
}

.qb-row {
  display: grid;
  grid-template-columns: auto auto 3rem minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.55rem;
  padding: 0.55rem 0.65rem;
  border: 1px solid #e2e8f0;
  border-radius: 0.7rem;
  background: #fff;
  min-width: 0;
}

.qb-row--add {
  grid-template-columns: 3rem minmax(0, 1fr) auto;
  cursor: default;
}

.qb-row.is-dragging {
  opacity: 0.55;
  border-color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 8%, white);
}

.qb-row__grip {
  color: #94a3b8;
  font-size: 0.8rem;
  letter-spacing: -0.08em;
  cursor: grab;
  user-select: none;
}

.qb-row__seq {
  width: 1.45rem;
  height: 1.45rem;
  display: inline-grid;
  place-items: center;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-primary) 14%, white);
  color: var(--ui-primary-dark);
  font-size: 0.75rem;
  font-weight: 700;
}

.qb-row__thumb {
  width: 3rem;
  height: 3rem;
  border-radius: 0.5rem;
  overflow: hidden;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
}

.qb-row__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.qb-row__info {
  min-width: 0;
}

.qb-row__name {
  font-size: 0.92rem;
  font-weight: 650;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qb-row__meta {
  margin-top: 0.12rem;
  font-size: 0.78rem;
  color: #64748b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qb-row__edit {
  color: var(--ui-primary-dark);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.qb-row__btns {
  display: flex;
  gap: 0.3rem;
  flex-shrink: 0;
}

.qb-row__btns :deep(.ui-btn),
.qb-row__add-btn {
  padding: 0.35rem 0.65rem;
  font-size: 0.82rem;
  white-space: nowrap;
}

.qb-row__add-btn {
  flex-shrink: 0;
}
</style>
