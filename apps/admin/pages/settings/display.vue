<script setup lang="ts">
type DisplayConfig = {
  customerScreenEnabled: boolean;
  bannerUrl?: string | null;
  panelUrl?: string | null;
};

type CustomerAdItem = {
  id: string;
  type: "image" | "video";
  url: string;
  name: string;
  sort: number;
  active: boolean;
  durationSec: number;
};

type CustomerAdsConfig = {
  enabled: boolean;
  imageDurationSec: number;
  items: CustomerAdItem[];
};

type SettingsRecord = {
  display?: DisplayConfig;
  customerAds?: CustomerAdsConfig;
};

const { get, patch, upload, del, assetUrl } = useAdminApi();
const pending = ref(false);
const saving = ref(false);
const uploading = ref(false);
const mediaBusy = ref<"banner" | "panel" | null>(null);
const error = ref("");
const ok = ref("");
const form = reactive({
  customerScreenEnabled: true,
  bannerUrl: "" as string,
  panelUrl: "" as string,
});
const ads = reactive({
  enabled: true,
  imageDurationSec: 8,
  items: [] as CustomerAdItem[],
});
const fileInput = ref<HTMLInputElement | null>(null);
const bannerInput = ref<HTMLInputElement | null>(null);
const panelInput = ref<HTMLInputElement | null>(null);

const statusLabel = computed(() =>
  form.customerScreenEnabled ? "เปิดใช้งาน" : "ปิดอยู่",
);

const sortedAds = computed(() =>
  [...ads.items].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)),
);

const activeAdsCount = computed(
  () => sortedAds.value.filter((it) => it.active).length,
);

const previewAd = computed(() => {
  if (!ads.enabled) return null;
  return sortedAds.value.find((it) => it.active) ?? null;
});

async function load() {
  pending.value = true;
  error.value = "";
  ok.value = "";
  try {
    const data = await get<SettingsRecord>("/settings");
    form.customerScreenEnabled = data.display?.customerScreenEnabled !== false;
    form.bannerUrl = data.display?.bannerUrl || "";
    form.panelUrl = data.display?.panelUrl || "";
    ads.enabled = data.customerAds?.enabled !== false;
    ads.imageDurationSec = Math.max(
      3,
      Math.min(120, Number(data.customerAds?.imageDurationSec) || 8),
    );
    ads.items = Array.isArray(data.customerAds?.items)
      ? data.customerAds!.items.map((it) => ({ ...it }))
      : [];
  } catch (e) {
    error.value = e instanceof Error ? e.message : "โหลดตั้งค่าไม่สำเร็จ";
  } finally {
    pending.value = false;
  }
}

async function save() {
  saving.value = true;
  error.value = "";
  ok.value = "";
  try {
    await patch("/settings/display", {
      customerScreenEnabled: form.customerScreenEnabled,
    });
    await patch("/settings/customer-ads", {
      enabled: ads.enabled,
      imageDurationSec: ads.imageDurationSec,
      items: ads.items,
    });
    ok.value = "บันทึกแล้ว — POS จะได้รับตอน sync";
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

async function onPickDisplayMedia(slot: "banner" | "panel", e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  mediaBusy.value = slot;
  error.value = "";
  ok.value = "";
  try {
    const fd = new FormData();
    fd.append("file", file);
    const data = await upload<SettingsRecord>(
      `/settings/display/${slot}`,
      fd,
    );
    form.bannerUrl = data.display?.bannerUrl || "";
    form.panelUrl = data.display?.panelUrl || "";
    ok.value =
      slot === "banner"
        ? "อัปโหลดแบนเนอร์แล้ว — POS รับตอน sync"
        : "อัปโหลดรูปด้านล่างแล้ว — POS รับตอน sync";
  } catch (err: unknown) {
    const msg =
      (err as { data?: { message?: string | string[] } })?.data?.message ??
      (err as Error)?.message ??
      "อัปโหลดไม่สำเร็จ";
    error.value = Array.isArray(msg) ? msg.join(", ") : String(msg);
  } finally {
    mediaBusy.value = null;
  }
}

async function clearDisplayMedia(slot: "banner" | "panel") {
  if (!confirm(slot === "banner" ? "ลบแบนเนอร์?" : "ลบรูปด้านล่าง?")) return;
  mediaBusy.value = slot;
  error.value = "";
  try {
    const data = await del<SettingsRecord>(`/settings/display/${slot}`);
    form.bannerUrl = data.display?.bannerUrl || "";
    form.panelUrl = data.display?.panelUrl || "";
    ok.value = "ลบแล้ว";
  } catch (e: unknown) {
    const msg =
      (e as { data?: { message?: string | string[] } })?.data?.message ??
      (e as Error)?.message ??
      "ลบไม่สำเร็จ";
    error.value = Array.isArray(msg) ? msg.join(", ") : String(msg);
  } finally {
    mediaBusy.value = null;
  }
}

async function onPickFiles(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  input.value = "";
  if (!files.length) return;
  uploading.value = true;
  error.value = "";
  ok.value = "";
  try {
    for (const file of files) {
      const fd = new FormData();
      fd.append("file", file);
      const data = await upload<{ customerAds?: CustomerAdsConfig }>(
        "/settings/customer-ads",
        fd,
      );
      if (data.customerAds) {
        ads.enabled = data.customerAds.enabled !== false;
        ads.imageDurationSec = data.customerAds.imageDurationSec;
        ads.items = data.customerAds.items.map((it) => ({ ...it }));
      }
    }
    ok.value = `อัปโหลดแล้ว ${files.length} ไฟล์ — กดบันทึกถ้าปรับค่าอื่น`;
  } catch (err: unknown) {
    const msg =
      (err as { data?: { message?: string | string[] } })?.data?.message ??
      (err as Error)?.message ??
      "อัปโหลดไม่สำเร็จ";
    error.value = Array.isArray(msg) ? msg.join(", ") : String(msg);
  } finally {
    uploading.value = false;
  }
}

async function removeAd(id: string) {
  if (!confirm("ลบสื่อนี้?")) return;
  error.value = "";
  try {
    const data = await del<{ customerAds?: CustomerAdsConfig }>(
      `/settings/customer-ads/${id}`,
    );
    if (data.customerAds) {
      ads.items = data.customerAds.items.map((it) => ({ ...it }));
    } else {
      ads.items = ads.items.filter((it) => it.id !== id);
    }
    ok.value = "ลบแล้ว";
  } catch (e: unknown) {
    const msg =
      (e as { data?: { message?: string | string[] } })?.data?.message ??
      (e as Error)?.message ??
      "ลบไม่สำเร็จ";
    error.value = Array.isArray(msg) ? msg.join(", ") : String(msg);
  }
}

function moveAd(id: string, dir: -1 | 1) {
  const list = [...sortedAds.value];
  const idx = list.findIndex((it) => it.id === id);
  const swap = idx + dir;
  if (idx < 0 || swap < 0 || swap >= list.length) return;
  const a = list[idx]!;
  const b = list[swap]!;
  const tmp = a.sort;
  a.sort = b.sort;
  b.sort = tmp;
  ads.items = list.map((it, i) => ({ ...it, sort: i }));
}

onMounted(load);
</script>

<template>
  <div class="dsp">
    <header class="dsp-head">
      <div>
        <p class="dsp-kicker">จอลูกค้า · จอ 2</p>
        <h1 class="ui-page-title">ตั้งค่าจอ</h1>
        <p class="ui-page-sub">
          จัดเลย์เอาต์แบนเนอร์ รูปด้านล่าง และโฆษณา · sync ไป POS อัตโนมัติ
        </p>
      </div>
      <div class="dsp-head__actions">
        <button type="button" class="ui-btn ui-btn--ghost" :disabled="pending" @click="load">
          {{ pending ? "กำลังโหลด..." : "รีเฟรช" }}
        </button>
        <button type="button" class="ui-btn ui-btn--primary" :disabled="saving" @click="save">
          {{ saving ? "กำลังบันทึก..." : "บันทึกการตั้งค่า" }}
        </button>
      </div>
    </header>

    <div v-if="error" class="dsp-flash dsp-flash--err">{{ error }}</div>
    <div v-if="ok" class="dsp-flash dsp-flash--ok">{{ ok }}</div>

    <div class="dsp-shell" :class="{ 'is-off': !form.customerScreenEnabled }">
      <!-- Live preview -->
      <aside class="dsp-preview">
        <div class="dsp-preview__bar">
          <span>ตัวอย่างจอ 2</span>
          <em :class="form.customerScreenEnabled ? 'is-on' : 'is-off'">
            {{ statusLabel }}
          </em>
        </div>

        <div class="dsp-screen" aria-hidden="true">
          <div class="dsp-screen__brand">
            <div v-if="form.bannerUrl" class="dsp-screen__banner">
              <img :src="assetUrl(form.bannerUrl)" alt="" />
            </div>
            <div v-else class="dsp-screen__logo-fallback">
              <span class="dsp-screen__mark">AP</span>
              <div>
                <strong>ชื่อร้าน</strong>
                <small>โลโก้ + ชื่อ (ค่าเริ่มต้น)</small>
              </div>
            </div>

            <div v-if="previewAd" class="dsp-screen__media">
              <img
                v-if="previewAd.type === 'image'"
                :src="assetUrl(previewAd.url)"
                alt=""
              />
              <video
                v-else-if="previewAd.type === 'video'"
                :src="assetUrl(previewAd.url)"
                muted
                autoplay
                loop
                playsinline
              />
              <div v-else class="dsp-screen__video-ph">วิดีโอโฆษณา</div>
              <span class="dsp-screen__chip">โฆษณา</span>
            </div>
            <div v-else-if="!form.panelUrl" class="dsp-screen__welcome">
              <strong>ยินดีต้อนรับ</strong>
              <span>รอสแกนสินค้า</span>
            </div>

            <div v-if="form.panelUrl" class="dsp-screen__panel">
              <img :src="assetUrl(form.panelUrl)" alt="" />
              <span class="dsp-screen__chip">รูปด้านล่าง</span>
            </div>
          </div>

          <div class="dsp-screen__ticket">
            <header>
              <div>
                <span>รายการสินค้า</span>
                <strong>0 ชิ้น</strong>
              </div>
              <div class="dsp-screen__member">
                <span>สมาชิก</span>
                <strong>ลูกค้าทั่วไป</strong>
              </div>
            </header>
            <div class="dsp-screen__empty">ยังไม่มีรายการ</div>
            <footer>
              <span>รวมทั้งสิ้น</span>
              <strong>0.00</strong>
            </footer>
          </div>
        </div>

        <p class="dsp-preview__hint">
          ซ้าย = แบนเนอร์ / โฆษณา / รูปด้านล่าง · ขวา = สมาชิก + รายการและยอดรวม
        </p>
      </aside>

      <!-- Controls -->
      <div class="dsp-editor">
        <section class="dsp-block">
          <div class="dsp-block__head">
            <span class="dsp-step">1</span>
            <div>
              <h2>เปิดใช้งาน</h2>
              <p>ควบคุมว่า POS จะเปิดหน้าต่างจอลูกค้าหรือไม่</p>
            </div>
          </div>
          <label class="dsp-toggle">
            <input v-model="form.customerScreenEnabled" type="checkbox" />
            <span class="dsp-toggle__ui" aria-hidden="true" />
            <span class="dsp-toggle__copy">
              <strong>ใช้งานจอลูกค้า (จอ 2)</strong>
              <small>
                {{
                  form.customerScreenEnabled
                    ? "เปิดบนจอที่สองระหว่างเปิดรอบขาย"
                    : "ใช้แคชเชียร์จอเดียว — ไม่เปิดจอลูกค้า"
                }}
              </small>
            </span>
          </label>
        </section>

        <section class="dsp-block" :class="{ 'is-dim': !form.customerScreenEnabled }">
          <div class="dsp-block__head">
            <span class="dsp-step">2</span>
            <div>
              <h2>เลย์เอาต์คงที่</h2>
              <p>แบนเนอร์บน + รูป/GIF ล่าง · อัปโหลดแล้ว sync ทันที</p>
            </div>
          </div>

          <div class="dsp-media-grid">
            <div class="dsp-media">
              <div class="dsp-media__label">
                <strong>แบนเนอร์ด้านบน</strong>
                <span>แทนโลโก้ + ชื่อ</span>
              </div>
              <button
                type="button"
                class="dsp-drop"
                :disabled="mediaBusy === 'banner'"
                @click="bannerInput?.click()"
              >
                <img v-if="form.bannerUrl" :src="assetUrl(form.bannerUrl)" alt="" />
                <div v-else class="dsp-drop__empty">
                  <em>อัปโหลดแบนเนอร์</em>
                  <small>JPG PNG WebP GIF · ≤ 8MB</small>
                </div>
              </button>
              <div class="dsp-media__actions">
                <button
                  type="button"
                  class="ui-btn ui-btn--ghost"
                  :disabled="mediaBusy === 'banner'"
                  @click="bannerInput?.click()"
                >
                  {{ mediaBusy === "banner" ? "กำลังอัปโหลด..." : "เลือกไฟล์" }}
                </button>
                <button
                  v-if="form.bannerUrl"
                  type="button"
                  class="ui-btn ui-btn--ghost-danger"
                  :disabled="mediaBusy === 'banner'"
                  @click="clearDisplayMedia('banner')"
                >
                  ลบ
                </button>
              </div>
              <input
                ref="bannerInput"
                class="dsp-file"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                @change="onPickDisplayMedia('banner', $event)"
              />
            </div>

            <div class="dsp-media">
              <div class="dsp-media__label">
                <strong>รูปด้านล่าง</strong>
                <span>แทนข้อความต้อนรับ · รองรับ GIF</span>
              </div>
              <button
                type="button"
                class="dsp-drop dsp-drop--tall"
                :disabled="mediaBusy === 'panel'"
                @click="panelInput?.click()"
              >
                <img v-if="form.panelUrl" :src="assetUrl(form.panelUrl)" alt="" />
                <div v-else class="dsp-drop__empty">
                  <em>อัปโหลดรูป / GIF</em>
                  <small>โชว์เมื่อไม่มีโฆษณาเลื่อน</small>
                </div>
              </button>
              <div class="dsp-media__actions">
                <button
                  type="button"
                  class="ui-btn ui-btn--ghost"
                  :disabled="mediaBusy === 'panel'"
                  @click="panelInput?.click()"
                >
                  {{ mediaBusy === "panel" ? "กำลังอัปโหลด..." : "เลือกไฟล์" }}
                </button>
                <button
                  v-if="form.panelUrl"
                  type="button"
                  class="ui-btn ui-btn--ghost-danger"
                  :disabled="mediaBusy === 'panel'"
                  @click="clearDisplayMedia('panel')"
                >
                  ลบ
                </button>
              </div>
              <input
                ref="panelInput"
                class="dsp-file"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                @change="onPickDisplayMedia('panel', $event)"
              />
            </div>
          </div>
        </section>

        <section class="dsp-block" :class="{ 'is-dim': !form.customerScreenEnabled }">
          <div class="dsp-block__head">
            <span class="dsp-step">3</span>
            <div>
              <h2>โฆษณาเลื่อน</h2>
              <p>หลายรูป/วิดีโอสลับวน · ทับรูปด้านล่างตอนมีรายการที่เปิดใช้</p>
            </div>
            <span class="dsp-count">{{ activeAdsCount }}/{{ ads.items.length || 0 }} เปิดใช้</span>
          </div>

          <div class="dsp-ads-toolbar">
            <label class="dsp-toggle dsp-toggle--compact">
              <input v-model="ads.enabled" type="checkbox" />
              <span class="dsp-toggle__ui" aria-hidden="true" />
              <span class="dsp-toggle__copy">
                <strong>เปิดโฆษณาเลื่อน</strong>
              </span>
            </label>

            <label class="dsp-duration">
              <span>วินาที / รูป</span>
              <input
                v-model.number="ads.imageDurationSec"
                class="ui-input"
                type="number"
                min="3"
                max="120"
                step="1"
              />
            </label>

            <button
              type="button"
              class="ui-btn ui-btn--primary"
              :disabled="uploading || ads.items.length >= 20"
              @click="fileInput?.click()"
            >
              {{ uploading ? "กำลังอัปโหลด..." : "เพิ่มสื่อ" }}
            </button>
            <input
              ref="fileInput"
              class="dsp-file"
              type="file"
              accept="image/*,video/*"
              multiple
              @change="onPickFiles"
            />
          </div>
          <p class="dsp-fine">
            รูป ≤ 5MB · วิดีโอ ≤ 40MB · สูงสุด 20 รายการ · ตอนนี้ {{ ads.items.length }}/20
          </p>

          <div v-if="!sortedAds.length" class="dsp-empty">
            ยังไม่มีโฆษณา — กด “เพิ่มสื่อ” เพื่ออัปโหลดรูปหรือวิดีโอ
          </div>

          <ul v-else class="dsp-ads">
            <li v-for="item in sortedAds" :key="item.id" class="dsp-ad">
              <div class="dsp-ad__thumb">
                <img
                  v-if="item.type === 'image'"
                  :src="assetUrl(item.url)"
                  alt=""
                  loading="lazy"
                />
                <video
                  v-else
                  :src="assetUrl(item.url)"
                  muted
                  preload="metadata"
                  playsinline
                />
                <span>{{ item.type === "video" ? "วิดีโอ" : "รูป" }}</span>
              </div>
              <div class="dsp-ad__body">
                <strong :title="item.name">{{ item.name }}</strong>
                <div class="dsp-ad__row">
                  <label class="dsp-check">
                    <input v-model="item.active" type="checkbox" />
                    แสดง
                  </label>
                  <label v-if="item.type === 'image'" class="dsp-check">
                    วินาที
                    <input
                      v-model.number="item.durationSec"
                      class="ui-input"
                      type="number"
                      min="3"
                      max="120"
                    />
                  </label>
                </div>
              </div>
              <div class="dsp-ad__ops">
                <button type="button" class="ui-btn ui-btn--ghost" title="ขึ้น" @click="moveAd(item.id, -1)">
                  ↑
                </button>
                <button type="button" class="ui-btn ui-btn--ghost" title="ลง" @click="moveAd(item.id, 1)">
                  ↓
                </button>
                <button
                  type="button"
                  class="ui-btn ui-btn--ghost-danger"
                  @click="removeAd(item.id)"
                >
                  ลบ
                </button>
              </div>
            </li>
          </ul>
        </section>

        <p class="dsp-footnote">
          เปลี่ยนแล้วกดบันทึก · POS รับค่าตอน sync รอบถัดไป (~15 วินาที) · ต้องมีจอภายนอกถึงจะเห็นจอ 2 แยก
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dsp {
  --dsp-ink: #0f172a;
  --dsp-muted: #64748b;
  --dsp-line: #e2e8f0;
  --dsp-soft: #f4f8f6;
  --dsp-card: #fff;
  max-width: 72rem;
}

.dsp-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem 1.25rem;
  margin-bottom: 1.25rem;
}

.dsp-kicker {
  margin: 0 0 0.2rem;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ui-primary-dark);
}

.dsp-head__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.dsp-flash {
  margin-bottom: 0.85rem;
  padding: 0.75rem 1rem;
  border-radius: 0.75rem;
  font-size: 0.9rem;
  font-weight: 600;
}

.dsp-flash--err {
  background: #fef2f2;
  color: #991b1b;
  border: 1px solid #fecaca;
}

.dsp-flash--ok {
  background: #ecfdf5;
  color: #0f5a3d;
  border: 1px solid #a7f3d0;
}

.dsp-shell {
  display: grid;
  grid-template-columns: minmax(280px, 0.95fr) minmax(0, 1.15fr);
  gap: 1.15rem;
  align-items: start;
}

.dsp-shell.is-off .dsp-preview,
.dsp-block.is-dim {
  opacity: 0.55;
  transition: opacity 0.2s ease;
}

.dsp-preview {
  position: sticky;
  top: 1rem;
  padding: 1rem;
  border-radius: 1.1rem;
  background:
    radial-gradient(600px 280px at 0% 0%, #e8f7ef 0%, transparent 60%),
    linear-gradient(180deg, #fff 0%, var(--dsp-soft) 100%);
  border: 1px solid color-mix(in srgb, var(--ui-primary) 16%, var(--dsp-line));
  box-shadow: 0 10px 28px rgba(15, 61, 42, 0.06);
}

.dsp-preview__bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--dsp-muted);
}

.dsp-preview__bar em {
  font-style: normal;
  padding: 0.18rem 0.55rem;
  border-radius: 999px;
  font-size: 0.72rem;
}

.dsp-preview__bar em.is-on {
  background: color-mix(in srgb, var(--ui-primary) 18%, white);
  color: var(--ui-primary-dark);
}

.dsp-preview__bar em.is-off {
  background: #eef2f6;
  color: #64748b;
}

.dsp-screen {
  display: grid;
  grid-template-columns: 1.05fr 1fr;
  min-height: 22rem;
  border-radius: 0.85rem;
  overflow: hidden;
  border: 1px solid #0f172a;
  background: #0f172a;
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.22);
}

.dsp-screen__brand {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding: 0.7rem;
  background:
    linear-gradient(165deg, #fffaf7 0%, #f5f5f4 100%);
  color: var(--dsp-ink);
  min-width: 0;
}

.dsp-screen__banner,
.dsp-screen__media {
  position: relative;
  border-radius: 0.55rem;
  overflow: hidden;
  background: #0f172a;
  min-height: 3.5rem;
}

.dsp-screen__banner img,
.dsp-screen__media img,
.dsp-screen__media video {
  display: block;
  width: 100%;
  height: 100%;
  max-height: 5.5rem;
  object-fit: contain;
}

.dsp-screen__media {
  flex: 1;
  min-height: 5rem;
}

.dsp-screen__media img,
.dsp-screen__media video {
  max-height: none;
  height: 100%;
}

.dsp-screen__panel {
  position: relative;
  flex: 0 0 auto;
  margin-top: auto;
  border-radius: 0.55rem;
  overflow: hidden;
  background: #0f172a;
  min-height: 3.2rem;
  max-height: 4.5rem;
}

.dsp-screen__panel img {
  display: block;
  width: 100%;
  height: 100%;
  max-height: 4.5rem;
  object-fit: contain;
}

.dsp-screen__video-ph {
  display: grid;
  place-items: center;
  height: 100%;
  min-height: 5rem;
  color: #94a3b8;
  font-size: 0.78rem;
  font-weight: 700;
}

.dsp-screen__chip {
  position: absolute;
  left: 0.4rem;
  bottom: 0.4rem;
  padding: 0.12rem 0.4rem;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.72);
  color: #fff;
  font-size: 0.62rem;
  font-weight: 700;
}

.dsp-screen__logo-fallback {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}

.dsp-screen__mark {
  display: grid;
  place-items: center;
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 0.55rem;
  background: #fff;
  border: 1px solid var(--dsp-line);
  font-size: 0.78rem;
  font-weight: 800;
  color: var(--ui-primary-dark);
}

.dsp-screen__logo-fallback strong {
  display: block;
  font-size: 0.88rem;
  line-height: 1.2;
}

.dsp-screen__logo-fallback small {
  color: var(--dsp-muted);
  font-size: 0.68rem;
}

.dsp-screen__member {
  display: grid;
  gap: 0.05rem;
  justify-items: end;
  text-align: right;
  font-size: 0.68rem;
  padding-left: 0.55rem;
  border-left: 1px solid var(--dsp-line);
}

.dsp-screen__member span {
  color: var(--dsp-muted);
  font-weight: 650;
}

.dsp-screen__member strong {
  font-size: 0.82rem;
}

.dsp-screen__welcome {
  margin-top: auto;
  padding: 0.75rem;
  border-radius: 0.65rem;
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid var(--dsp-line);
}

.dsp-screen__welcome strong {
  display: block;
  font-size: 0.95rem;
}

.dsp-screen__welcome span {
  font-size: 0.72rem;
  color: var(--dsp-muted);
}

.dsp-screen__ticket {
  display: flex;
  flex-direction: column;
  background: #fff;
  color: var(--dsp-ink);
  min-width: 0;
}

.dsp-screen__ticket header,
.dsp-screen__ticket footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.55rem 0.75rem;
}

.dsp-screen__ticket header {
  border-bottom: 1px solid var(--dsp-line);
  background: #fafaf9;
  font-size: 0.72rem;
  gap: 0.5rem;
}

.dsp-screen__ticket header > div:first-child {
  display: grid;
  gap: 0.05rem;
}

.dsp-screen__ticket header > div:first-child span {
  color: var(--dsp-muted);
  font-weight: 650;
}

.dsp-screen__ticket header > div:first-child strong {
  font-size: 0.92rem;
}

.dsp-screen__ticket footer {
  margin-top: auto;
  background: linear-gradient(180deg, #fff 0%, #f0fdfa 100%);
  border-top: 1px solid var(--dsp-line);
}

.dsp-screen__ticket footer strong {
  font-size: 1.25rem;
  color: var(--ui-primary-dark);
  font-variant-numeric: tabular-nums;
}

.dsp-screen__empty {
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--dsp-muted);
  font-size: 0.78rem;
  padding: 1rem;
}

.dsp-preview__hint {
  margin: 0.75rem 0 0;
  font-size: 0.78rem;
  color: var(--dsp-muted);
  line-height: 1.45;
}

.dsp-editor {
  display: grid;
  gap: 0.9rem;
  min-width: 0;
}

.dsp-block {
  padding: 1.1rem 1.15rem 1.2rem;
  border-radius: 1rem;
  background: var(--dsp-card);
  border: 1px solid var(--dsp-line);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  transition: opacity 0.2s ease;
}

.dsp-block__head {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.dsp-block__head h2 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 800;
  color: var(--dsp-ink);
}

.dsp-block__head p {
  margin: 0.2rem 0 0;
  font-size: 0.84rem;
  color: var(--dsp-muted);
  line-height: 1.4;
}

.dsp-step {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 1.7rem;
  height: 1.7rem;
  border-radius: 999px;
  background: var(--ui-primary);
  color: #fff;
  font-size: 0.82rem;
  font-weight: 800;
}

.dsp-count {
  margin-left: auto;
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--dsp-muted);
  white-space: nowrap;
}

.dsp-toggle {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  cursor: pointer;
  user-select: none;
}

.dsp-toggle input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.dsp-toggle__ui {
  flex: 0 0 auto;
  width: 2.6rem;
  height: 1.45rem;
  margin-top: 0.1rem;
  border-radius: 999px;
  background: #cbd5e1;
  position: relative;
  transition: background 0.15s ease;
}

.dsp-toggle__ui::after {
  content: "";
  position: absolute;
  top: 0.18rem;
  left: 0.18rem;
  width: 1.1rem;
  height: 1.1rem;
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.2);
  transition: transform 0.15s ease;
}

.dsp-toggle input:checked + .dsp-toggle__ui {
  background: var(--ui-primary);
}

.dsp-toggle input:checked + .dsp-toggle__ui::after {
  transform: translateX(1.15rem);
}

.dsp-toggle__copy {
  display: grid;
  gap: 0.15rem;
  min-width: 0;
}

.dsp-toggle__copy strong {
  font-size: 0.95rem;
  color: var(--dsp-ink);
}

.dsp-toggle__copy small {
  font-size: 0.82rem;
  color: var(--dsp-muted);
  line-height: 1.4;
}

.dsp-toggle--compact {
  align-items: center;
}

.dsp-toggle--compact .dsp-toggle__ui {
  margin-top: 0;
}

.dsp-media-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.85rem;
}

.dsp-media {
  display: grid;
  gap: 0.55rem;
  min-width: 0;
}

.dsp-media__label {
  display: grid;
  gap: 0.1rem;
}

.dsp-media__label strong {
  font-size: 0.9rem;
}

.dsp-media__label span {
  font-size: 0.78rem;
  color: var(--dsp-muted);
}

.dsp-drop {
  display: grid;
  place-items: center;
  width: 100%;
  min-height: 7.5rem;
  padding: 0;
  border: 1px dashed color-mix(in srgb, var(--ui-primary) 35%, #cbd5e1);
  border-radius: 0.85rem;
  background: var(--dsp-soft);
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.dsp-drop:hover:not(:disabled) {
  border-color: var(--ui-primary);
  background: #eaf7f0;
}

.dsp-drop:disabled {
  opacity: 0.7;
  cursor: wait;
}

.dsp-drop--tall {
  min-height: 10rem;
}

.dsp-drop img {
  width: 100%;
  height: 100%;
  min-height: 7.5rem;
  object-fit: contain;
  background: #0f172a;
  display: block;
}

.dsp-drop--tall img {
  min-height: 10rem;
}

.dsp-drop__empty {
  display: grid;
  gap: 0.25rem;
  justify-items: center;
  padding: 1rem;
  text-align: center;
}

.dsp-drop__empty em {
  font-style: normal;
  font-weight: 800;
  color: var(--ui-primary-dark);
  font-size: 0.9rem;
}

.dsp-drop__empty small {
  color: var(--dsp-muted);
  font-size: 0.76rem;
}

.dsp-media__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.dsp-file {
  display: none;
}

.dsp-ads-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1rem;
  margin-bottom: 0.45rem;
}

.dsp-duration {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.82rem;
  font-weight: 650;
  color: var(--dsp-muted);
}

.dsp-duration .ui-input {
  width: 4.25rem;
  padding: 0.35rem 0.45rem;
}

.dsp-fine {
  margin: 0 0 0.85rem;
  font-size: 0.78rem;
  color: var(--dsp-muted);
}

.dsp-empty {
  padding: 1.25rem 1rem;
  border-radius: 0.75rem;
  border: 1px dashed var(--dsp-line);
  background: #f8fafc;
  color: var(--dsp-muted);
  text-align: center;
  font-size: 0.88rem;
}

.dsp-ads {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.65rem;
}

.dsp-ad {
  display: grid;
  grid-template-columns: 6.5rem minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: center;
  padding: 0.55rem;
  border-radius: 0.75rem;
  border: 1px solid var(--dsp-line);
  background: #fff;
}

.dsp-ad__thumb {
  position: relative;
  width: 6.5rem;
  height: 4.2rem;
  border-radius: 0.45rem;
  overflow: hidden;
  background: #0f172a;
}

.dsp-ad__thumb img,
.dsp-ad__thumb video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.dsp-ad__thumb span {
  position: absolute;
  left: 0.3rem;
  bottom: 0.3rem;
  padding: 0.08rem 0.35rem;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.72);
  color: #fff;
  font-size: 0.62rem;
  font-weight: 700;
}

.dsp-ad__body {
  min-width: 0;
  display: grid;
  gap: 0.35rem;
}

.dsp-ad__body strong {
  font-size: 0.9rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsp-ad__row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem 0.85rem;
}

.dsp-check {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.8rem;
  color: var(--dsp-muted);
}

.dsp-check .ui-input {
  width: 3.8rem;
  padding: 0.2rem 0.35rem;
}

.dsp-ad__ops {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  justify-content: flex-end;
}

.dsp-footnote {
  margin: 0.15rem 0 0;
  font-size: 0.8rem;
  color: var(--dsp-muted);
  line-height: 1.5;
}

@media (max-width: 980px) {
  .dsp-shell {
    grid-template-columns: 1fr;
  }

  .dsp-preview {
    position: static;
  }
}

@media (max-width: 640px) {
  .dsp-media-grid,
  .dsp-ad,
  .dsp-screen {
    grid-template-columns: 1fr;
  }

  .dsp-screen {
    min-height: 0;
  }

  .dsp-screen__ticket {
    min-height: 10rem;
  }
}
</style>
