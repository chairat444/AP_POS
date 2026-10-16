<script setup lang="ts">
import {
  DEFAULT_KEYBINDINGS,
  POS_ACTION_LABELS_TH,
  SALE_SCREEN_ACTION_IDS,
  formatChord,
  formatChords,
  type KeyChord,
  type KeybindingMap,
  type SaleScreenActionId,
} from "@ap-pos/shared";

const { get, post } = useAdminApi();
const pending = ref(false);
const saving = ref(false);
const error = ref("");
const ok = ref("");
const capturing = ref<SaleScreenActionId | null>(null);

/** ค่าที่แก้ในฟอร์ม — เก็บ chord แรกของแต่ละ action (หน้าขายใช้คีย์หลักอันเดียว) */
const form = ref<Record<SaleScreenActionId, KeyChord>>(
  Object.fromEntries(
    SALE_SCREEN_ACTION_IDS.map((id) => [
      id,
      { ...(DEFAULT_KEYBINDINGS[id][0] ?? { key: "" }) },
    ]),
  ) as Record<SaleScreenActionId, KeyChord>,
);

function chordLabel(c: KeyChord | undefined) {
  if (!c?.key) return "— กดเพื่อตั้งค่า —";
  return formatChord(c);
}

function defaultLabel(id: SaleScreenActionId) {
  return formatChords(DEFAULT_KEYBINDINGS[id]);
}

function applyMap(map: KeybindingMap | null | undefined) {
  for (const id of SALE_SCREEN_ACTION_IDS) {
    const chords = map?.[id]?.length ? map[id]! : DEFAULT_KEYBINDINGS[id];
    form.value[id] = { ...(chords[0] ?? { key: "" }) };
  }
}

async function load() {
  pending.value = true;
  error.value = "";
  ok.value = "";
  capturing.value = null;
  try {
    const data = await get<{ keybindings?: KeybindingMap }>("/settings");
    applyMap(data.keybindings);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "โหลดคีย์ลัดไม่สำเร็จ";
    applyMap(null);
  } finally {
    pending.value = false;
  }
}

async function save() {
  saving.value = true;
  error.value = "";
  ok.value = "";
  capturing.value = null;
  try {
    const keybindings: KeybindingMap = {};
    for (const id of SALE_SCREEN_ACTION_IDS) {
      const c = form.value[id];
      if (!c?.key) continue;
      keybindings[id] = [{ ...c }];
    }
    await post("/settings/keybindings", { keybindings });
    ok.value = "บันทึกแล้ว — POS จะได้รับตอน sync / เปิดรอบใหม่";
    await load();
  } catch (e: unknown) {
    const msg =
      (e as { data?: { message?: string | string[] } })?.data?.message ??
      (e as Error)?.message ??
      "บันทึกไม่สำเร็จ";
    error.value = Array.isArray(msg) ? msg.join(", ") : String(msg);
  } finally {
    saving.value = false;
  }
}

async function resetDefaults() {
  saving.value = true;
  error.value = "";
  ok.value = "";
  capturing.value = null;
  try {
    await post("/settings/keybindings/reset");
    ok.value = "รีเซ็ตเป็นค่าเริ่มต้นแล้ว";
    await load();
  } catch (e: unknown) {
    const msg =
      (e as { data?: { message?: string | string[] } })?.data?.message ??
      (e as Error)?.message ??
      "รีเซ็ตไม่สำเร็จ";
    error.value = Array.isArray(msg) ? msg.join(", ") : String(msg);
  } finally {
    saving.value = false;
  }
}

function startCapture(id: SaleScreenActionId) {
  capturing.value = id;
}

function onCaptureKey(e: KeyboardEvent) {
  const id = capturing.value;
  if (!id) return;
  e.preventDefault();
  e.stopPropagation();

  // ไม่รับ modifier เปล่า
  if (
    e.key === "Shift" ||
    e.key === "Control" ||
    e.key === "Alt" ||
    e.key === "Meta"
  ) {
    return;
  }

  form.value[id] = {
    key: e.key,
    ctrl: e.ctrlKey || undefined,
    shift: e.shiftKey || undefined,
    alt: e.altKey || undefined,
    meta: e.metaKey || undefined,
  };
  capturing.value = null;
}

function clearChord(id: SaleScreenActionId) {
  form.value[id] = { ...(DEFAULT_KEYBINDINGS[id][0] ?? { key: "" }) };
}

onMounted(() => {
  window.addEventListener("keydown", onCaptureKey, true);
  void load();
});
onUnmounted(() => {
  window.removeEventListener("keydown", onCaptureKey, true);
});
</script>

<template>
  <div>
    <div class="ui-page-head">
      <div>
        <h1 class="ui-page-title">คีย์ลัด POS</h1>
        <p class="ui-page-sub">
          กำหนด F-key / ปุ่มลัดของหน้าขาย · กดช่องแล้วกดคีย์บนคีย์บอร์ด · sync ไป POS
        </p>
      </div>
      <div class="ui-page-head__actions">
        <button
          type="button"
          class="ui-btn ui-btn--ghost"
          :disabled="pending || saving"
          @click="load"
        >
          {{ pending ? "กำลังโหลด..." : "รีเฟรช" }}
        </button>
        <button
          type="button"
          class="ui-btn ui-btn--ghost"
          :disabled="saving"
          @click="resetDefaults"
        >
          รีเซ็ตค่าเริ่มต้น
        </button>
        <button
          type="button"
          class="ui-btn ui-btn--primary"
          :disabled="saving || pending"
          @click="save"
        >
          {{ saving ? "กำลังบันทึก..." : "บันทึก" }}
        </button>
      </div>
    </div>

    <div v-if="error" class="ui-empty">{{ error }}</div>
    <div v-if="ok" class="ui-empty" style="color: #0f5a3d">{{ ok }}</div>
    <div v-if="capturing" class="ui-empty" style="color: #0f766e">
      กำลังรอคีย์สำหรับ 「{{ POS_ACTION_LABELS_TH[capturing] }}」 — กดปุ่มบนคีย์บอร์ด
      (Esc = ตั้งเป็น Escape)
    </div>

    <div class="ui-card">
      <div class="ui-card__toolbar">
        <span class="ui-toolbar-meta ui-toolbar-meta--alone">
          ปุ่มหน้าขาย / งานรอบ
        </span>
      </div>
      <div class="ui-table-wrap">
        <table class="ui-table ui-table--fit">
          <thead>
            <tr>
              <th>ฟังก์ชัน</th>
              <th>คีย์ปัจจุบัน</th>
              <th>ค่าเริ่มต้น</th>
              <th class="ui-table__actions">ตั้งค่า</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="id in SALE_SCREEN_ACTION_IDS" :key="id">
              <td>
                <strong>{{ POS_ACTION_LABELS_TH[id] }}</strong>
                <div style="opacity: 0.55; font-size: 0.78rem">{{ id }}</div>
              </td>
              <td>
                <code
                  :style="{
                    fontWeight: 700,
                    color: capturing === id ? '#0f766e' : undefined,
                  }"
                >
                  {{
                    capturing === id
                      ? "กดคีย์..."
                      : chordLabel(form[id])
                  }}
                </code>
              </td>
              <td>
                <code style="opacity: 0.65">{{ defaultLabel(id) }}</code>
              </td>
              <td class="ui-table__actions">
                <button
                  type="button"
                  class="ui-btn ui-btn--ghost"
                  :disabled="saving"
                  @click="startCapture(id)"
                >
                  {{ capturing === id ? "รอคีย์..." : "กดตั้งค่า" }}
                </button>
                <button
                  type="button"
                  class="ui-btn ui-btn--ghost"
                  :disabled="saving"
                  @click="clearChord(id)"
                >
                  ค่าเริ่มต้น
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
