<script setup lang="ts">
type Member = {
  id: string;
  code: string;
  name: string;
  phone?: string;
  points: number;
};

type PointEntry = {
  id: string;
  delta: number;
  reason: string;
  saleId: string | null;
  billNo: string | null;
  branchId: string;
  branchName: string | null;
  createdAt: string;
  balanceAfter: number;
};

type HistoryPayload = {
  member: Member;
  entries: PointEntry[];
  ledgerSum: number;
};

const { get } = useAdminApi();
const route = useRoute();
const router = useRouter();

const q = ref(String(route.query.q ?? route.query.phone ?? ""));
const pending = ref(false);
const loadingHistory = ref(false);
const error = ref("");
const matches = ref<Member[]>([]);
const selectedId = ref<string | null>(
  typeof route.query.id === "string" ? route.query.id : null,
);
const history = ref<HistoryPayload | null>(null);

const reasonLabel: Record<string, string> = {
  sale_earn: "ได้แต้มจากบิล",
  sale_redeem: "ใช้แต้มเป็นส่วนลด",
  admin_adjust: "ปรับจากแอดมิน",
  "migrate sale earn": "ได้แต้มจากบิล (ย้ายข้อมูล)",
  "migrate sale redeem": "ใช้แต้ม (ย้ายข้อมูล)",
  "migrate opening points": "ยอดยกมาตอนย้ายข้อมูล",
};

function formatWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function reasonText(reason: string) {
  return reasonLabel[reason] ?? reason;
}

/** เปิดบิลด้วย saleId (ถ้ามี) — ไม่พึ่งกรองวันที่หน้า /sales */
function saleLink(row: PointEntry) {
  if (row.saleId) {
    const q: Record<string, string> = { id: row.saleId };
    if (row.billNo) q.q = row.billNo;
    return { path: "/sales", query: q };
  }
  return {
    path: "/sales",
    query: { q: row.billNo ?? "" },
  };
}

async function search(opts: { keepSelected?: boolean } = {}) {
  const term = q.value.trim();
  error.value = "";
  matches.value = [];
  if (!term) {
    if (!opts.keepSelected) {
      history.value = null;
      selectedId.value = null;
      await router.replace({ query: {} });
    }
    return;
  }
  pending.value = true;
  try {
    const rows = await get<Member[]>(
      `/members/points-history/search?q=${encodeURIComponent(term)}`,
    );
    matches.value = rows ?? [];
    await router.replace({
      query: {
        q: term,
        ...(selectedId.value ? { id: selectedId.value } : {}),
      },
    });
    if (matches.value.length === 1) {
      await selectMember(matches.value[0].id);
    } else if (
      selectedId.value &&
      !matches.value.some((m) => m.id === selectedId.value)
    ) {
      // มี id จากลิงก์ลึก — อย่าทิ้งแค่เพราะคำค้นไม่ครอบ
      if (!opts.keepSelected) {
        selectedId.value = null;
        history.value = null;
      }
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : "ค้นหาไม่สำเร็จ";
  } finally {
    pending.value = false;
  }
}

async function selectMember(id: string) {
  selectedId.value = id;
  loadingHistory.value = true;
  error.value = "";
  try {
    const data = await get<HistoryPayload>(`/members/${id}/points-history`);
    history.value = data;
    // ถ้ามาจากลิงก์ด้วยชื่อแปลก ๆ ให้โชว์ชื่อ/เบอร์จริงในช่องค้น
    if (data.member?.phone || data.member?.name) {
      const nicer = data.member.phone || data.member.name;
      if (!q.value.trim() || q.value.trim() === data.member.name) {
        q.value = nicer;
      }
    }
    await router.replace({
      query: {
        ...(q.value.trim() ? { q: q.value.trim() } : {}),
        id,
      },
    });
  } catch (e) {
    history.value = null;
    error.value = e instanceof Error ? e.message : "โหลดประวัติไม่สำเร็จ";
  } finally {
    loadingHistory.value = false;
  }
}

onMounted(async () => {
  // ลิงก์จากรายงานมี id — โหลดประวัติก่อน อย่าให้ search ล้างทิ้ง
  if (selectedId.value) {
    await selectMember(selectedId.value);
    if (q.value.trim()) await search({ keepSelected: true });
  } else if (q.value.trim()) {
    await search();
  }
});
</script>

<template>
  <div>
    <div class="ui-page-head">
      <div>
        <h1 class="ui-page-title">ประวัติแต้ม</h1>
        <p class="ui-page-sub">
          ดูได้แต้ม / ใช้แต้ม / ปรับแต้มของสมาชิก ตามบิลที่ sync แล้ว
        </p>
      </div>
      <div class="ui-page-head__actions">
        <NuxtLink to="/members" class="ui-btn ui-btn--ghost">สมาชิก</NuxtLink>
      </div>
    </div>

    <div class="ui-card ui-report-filters">
      <form class="ui-rdf" @submit.prevent="search">
        <label class="ui-field" style="flex: 1; min-width: 16rem">
          <span>ค้นหาชื่อ / รหัส / เบอร์</span>
          <input
            v-model="q"
            class="ui-input"
            type="search"
            placeholder="เช่น 0924945442"
            autofocus
          />
        </label>
        <button
          type="submit"
          class="ui-btn ui-btn--primary"
          :disabled="pending"
          style="align-self: end"
        >
          {{ pending ? "กำลังค้นหา..." : "ค้นหา" }}
        </button>
      </form>
    </div>

    <div v-if="error" class="ui-empty">{{ error }}</div>

    <div
      v-if="matches.length > 1"
      class="ui-card"
      style="margin-top: 1rem"
    >
      <div class="ui-card__toolbar">
        <span class="ui-toolbar-search__meta">
          พบ {{ matches.length }} คน — เลือกเพื่อดูประวัติ
        </span>
      </div>
      <div class="ui-table-wrap">
        <table class="ui-table ui-table--fit">
          <thead>
            <tr>
              <th>รหัส</th>
              <th>ชื่อ</th>
              <th>เบอร์</th>
              <th>แต้มปัจจุบัน</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="m in matches"
              :key="m.id"
              :class="{ 'is-selected': m.id === selectedId }"
            >
              <td>{{ m.code }}</td>
              <td>{{ m.name }}</td>
              <td>{{ m.phone || "-" }}</td>
              <td>
                <strong>{{ m.points.toLocaleString("th-TH") }}</strong>
              </td>
              <td class="ui-table__actions">
                <button
                  type="button"
                  class="ui-btn ui-btn--ghost"
                  @click="selectMember(m.id)"
                >
                  ดูประวัติ
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="loadingHistory" class="ui-empty">กำลังโหลดประวัติ...</div>

    <template v-if="history && !loadingHistory">
      <div class="ui-dash" style="margin-top: 1rem">
        <div class="ui-dash__kpi">
          <p class="ui-dash__kpi-label">สมาชิก</p>
          <p class="ui-dash__kpi-value" style="font-size: 1.25rem">
            {{ history.member.name }}
          </p>
          <p class="ui-dash__kpi-hint">
            {{ history.member.code }}
            · {{ history.member.phone || "ไม่มีเบอร์" }}
          </p>
        </div>
        <div class="ui-dash__kpi">
          <p class="ui-dash__kpi-label">แต้มปัจจุบัน</p>
          <p class="ui-dash__kpi-value">
            {{ history.member.points.toLocaleString("th-TH") }}
          </p>
          <p
            v-if="history.ledgerSum !== history.member.points"
            class="ui-dash__kpi-hint"
            style="color: #b45309"
          >
            รวมจากประวัติ {{ history.ledgerSum.toLocaleString("th-TH") }}
            (ไม่ตรง — อาจเคยแก้แต้มก่อนมีประวัติ)
          </p>
          <p v-else class="ui-dash__kpi-hint">ตรงกับประวัติในระบบ</p>
        </div>
        <div class="ui-dash__kpi">
          <p class="ui-dash__kpi-label">รายการ</p>
          <p class="ui-dash__kpi-value">
            {{ history.entries.length.toLocaleString("th-TH") }}
          </p>
          <p class="ui-dash__kpi-hint">เรียงใหม่ → เก่า</p>
        </div>
      </div>

      <div class="ui-card" style="margin-top: 1rem">
        <div v-if="!history.entries.length" class="ui-empty">
          ยังไม่มีประวัติแต้ม (ได้/ใช้แต้มจะขึ้นหลัง sync บิล)
        </div>
        <div v-else class="ui-table-wrap ui-points-ledger-wrap">
          <table class="ui-table ui-points-ledger">
            <thead>
              <tr>
                <th>วันเวลา</th>
                <th>รายการ</th>
                <th>บิล</th>
                <th>สาขา</th>
                <th class="ui-points-ledger__num">เปลี่ยนแปลง</th>
                <th class="ui-points-ledger__num">คงเหลือหลังรายการ</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in history.entries" :key="row.id">
                <td class="ui-points-ledger__when">{{ formatWhen(row.createdAt) }}</td>
                <td>{{ reasonText(row.reason) }}</td>
                <td class="ui-points-ledger__bill">
                  <NuxtLink
                    v-if="row.saleId || row.billNo"
                    :to="saleLink(row)"
                    class="ui-link"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {{ row.billNo || row.saleId }}
                  </NuxtLink>
                  <span v-else>-</span>
                </td>
                <td class="ui-points-ledger__branch">
                  {{ row.branchName || row.branchId || "-" }}
                </td>
                <td
                  class="ui-points-ledger__num"
                  :style="{
                    color: row.delta >= 0 ? '#15803d' : '#b91c1c',
                    fontWeight: 700,
                  }"
                >
                  {{ row.delta > 0 ? "+" : ""
                  }}{{ row.delta.toLocaleString("th-TH") }}
                </td>
                <td class="ui-points-ledger__num">
                  {{ row.balanceAfter.toLocaleString("th-TH") }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ui-points-ledger-wrap {
  overflow-x: auto !important;
}

.ui-points-ledger {
  width: max-content;
  min-width: 100%;
  table-layout: auto;
  border-collapse: collapse;
}

.ui-points-ledger th,
.ui-points-ledger td {
  overflow: visible;
  text-overflow: clip;
  white-space: nowrap;
  vertical-align: middle;
}

.ui-points-ledger__bill {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-variant-numeric: tabular-nums;
  font-size: 0.9rem;
  padding-right: 1.25rem !important;
}

.ui-points-ledger__branch {
  color: var(--ui-muted, #475569);
  padding-left: 0.5rem !important;
}

.ui-points-ledger__when {
  color: var(--ui-muted, #64748b);
  font-size: 0.88rem;
}

.ui-points-ledger__num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
