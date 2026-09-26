<script setup lang="ts">
type BackupStatus = {
  ok: boolean;
  at: string | null;
  file: string | null;
  size: string | null;
  path: string | null;
  trigger: string | null;
  running: boolean;
  driveConfigured: boolean;
  scriptPath: string;
  elapsedMs?: number;
};

const { get, post } = useAdminApi();
const pending = ref(false);
const running = ref(false);
const error = ref("");
const ok = ref("");
const status = ref<BackupStatus | null>(null);

async function load() {
  pending.value = true;
  error.value = "";
  try {
    status.value = await get<BackupStatus>("/backup/status");
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : "โหลดสถานะสำรองไม่สำเร็จ";
  } finally {
    pending.value = false;
  }
}

async function runBackup() {
  if (running.value) return;
  if (
    !confirm(
      "สำรองฐานข้อมูลขึ้น Google Drive ตอนนี้?\nอาจใช้เวลา 1–3 นาที",
    )
  ) {
    return;
  }
  running.value = true;
  error.value = "";
  ok.value = "";
  try {
    const res = await post<BackupStatus>("/backup/run", {});
    status.value = res;
    ok.value = res.file
      ? `สำรองสำเร็จ · ${res.file}${res.size ? ` (${res.size})` : ""}`
      : "สำรองสำเร็จ";
  } catch (e) {
    const msg =
      (e as { data?: { message?: string | string[] } })?.data?.message ??
      (e instanceof Error ? e.message : "สำรองไม่สำเร็จ");
    error.value = Array.isArray(msg) ? msg.join(", ") : String(msg);
    await load().catch(() => undefined);
  } finally {
    running.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="ui-page-head">
      <div>
        <h1 class="ui-page-title">สำรองฐานข้อมูล</h1>
        <p class="ui-page-sub">
          อัปขึ้น Google Drive · อัตโนมัติทุกวัน 23:00 (5 ทุ่ม) · กดปุ่มเพื่อสำรองทันที
        </p>
      </div>
      <div class="ui-page-head__actions">
        <button
          type="button"
          class="ui-btn ui-btn--ghost"
          :disabled="pending || running"
          @click="load"
        >
          {{ pending ? "กำลังโหลด..." : "รีเฟรช" }}
        </button>
      </div>
    </div>

    <div v-if="error" class="ui-empty">{{ error }}</div>
    <div v-if="ok" class="ui-empty" style="color: #0f5a3d">{{ ok }}</div>

    <div class="ui-card" style="max-width: 40rem">
      <div class="ui-card__toolbar">
        <span class="ui-toolbar-meta ui-toolbar-meta--alone"
          >สำรองตอนนี้</span
        >
      </div>
      <div style="padding: 1.15rem 1.25rem 1.35rem">
        <p class="ui-field-hint" style="margin-top: 0">
          dump Postgres แล้วอัปโหลดไปโฟลเดอร์ Drive ที่ตั้งไว้ ·
          เฉพาะแอดมิน/ผู้จัดการ
        </p>
        <button
          type="button"
          class="ui-btn ui-btn--primary"
          style="margin-top: 0.85rem"
          :disabled="running || pending || (status && !status.driveConfigured)"
          @click="runBackup"
        >
          {{ running ? "กำลังสำรอง..." : "สำรอง DB ขึ้น Drive ตอนนี้" }}
        </button>
        <p
          v-if="status && !status.driveConfigured"
          class="ui-field-hint"
          style="color: #b45309; margin-top: 0.75rem"
        >
          ยังไม่ได้เชื่อม Google Drive — ตั้งค่า rclone ตาม
          <code>scripts/backup/README.md</code> ก่อน
        </p>
      </div>
    </div>

    <div class="ui-card" style="max-width: 40rem; margin-top: 1rem">
      <div class="ui-card__toolbar">
        <span class="ui-toolbar-meta ui-toolbar-meta--alone"
          >สถานะล่าสุด</span
        >
      </div>
      <div style="padding: 1.15rem 1.25rem 1.35rem" class="ui-backup-meta">
        <template v-if="status">
          <div>
            <span>Drive</span>
            <strong>{{
              status.driveConfigured ? "พร้อม" : "ยังไม่เชื่อม"
            }}</strong>
          </div>
          <div>
            <span>ครั้งล่าสุด</span>
            <strong>{{ status.at || "—" }}</strong>
          </div>
          <div>
            <span>ไฟล์</span>
            <strong>{{ status.file || "—" }}</strong>
          </div>
          <div>
            <span>ขนาด</span>
            <strong>{{ status.size || "—" }}</strong>
          </div>
          <div>
            <span>จาก</span>
            <strong>{{ status.trigger || "—" }}</strong>
          </div>
        </template>
        <p v-else class="ui-field-hint" style="margin: 0">ยังไม่มีข้อมูล</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ui-backup-meta {
  display: grid;
  gap: 0.65rem;
}
.ui-backup-meta > div {
  display: grid;
  grid-template-columns: 7rem minmax(0, 1fr);
  gap: 0.75rem;
  align-items: baseline;
}
.ui-backup-meta span {
  color: #64748b;
  font-size: 0.85rem;
}
.ui-backup-meta strong {
  font-weight: 650;
  color: #0f172a;
  word-break: break-all;
}
</style>
