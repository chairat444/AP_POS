<script setup lang="ts">
const route = useRoute();
const config = useRuntimeConfig();
const { user, logout } = useAuth();
const { get, assetUrl } = useAdminApi();
const appName = computed(() => String(config.public.appName || "AP POS Admin"));
const appShort = computed(() => String(config.public.appShortName || "AP"));

const brandName = ref("");
const brandLogo = ref("");
const displayName = computed(() => brandName.value || appName.value);
const logoSrc = computed(() =>
  brandLogo.value ? assetUrl(brandLogo.value) : "/favicon.png",
);

async function loadBranding() {
  try {
    const data = await get<{
      branding?: { storeName?: string; logoUrl?: string | null };
    }>("/settings");
    brandName.value = data.branding?.storeName?.trim() || "";
    brandLogo.value = data.branding?.logoUrl || "";
  } catch {
    /* ignore */
  }
}

onMounted(loadBranding);
watch(() => route.path, (p) => {
  if (p.startsWith("/settings")) void loadBranding();
});

type NavItem = {
  to: string;
  label: string;
  icon: string;
  exact?: boolean;
};

type NavGroup = {
  id: string;
  label: string;
  icon: string;
  items: NavItem[];
};

const dashboard: NavItem = {
  to: "/",
  label: "แดชบอร์ด",
  icon: "home",
  exact: true,
};

const groups: NavGroup[] = [
  {
    id: "catalog",
    label: "สินค้า",
    icon: "box",
    items: [
      { to: "/products", label: "รายการสินค้า", icon: "box" },
      { to: "/products/quick", label: "สินค้าด่วน", icon: "zap" },
      { to: "/units", label: "หน่วยสินค้า", icon: "ruler" },
      { to: "/promos", label: "โปรโมชัน", icon: "tag" },
    ],
  },
  {
    id: "sales",
    label: "ขาย",
    icon: "receipt",
    items: [
      { to: "/sales", label: "บิลขาย", icon: "receipt" },
    ],
  },
  {
    id: "reports",
    label: "รายงาน",
    icon: "chart",
    items: [
      { to: "/reports", label: "สรุปยอดขาย", icon: "chart" },
      { to: "/reports/cashflow", label: "รายรับ–รายจ่าย", icon: "coin" },
      { to: "/shifts", label: "รอบกะ / เงินสด", icon: "shift" },
      { to: "/reports/commission", label: "ค่าแรงและค่าคอม", icon: "coin" },
    ],
  },
  {
    id: "people",
    label: "องค์กร",
    icon: "users",
    items: [
      { to: "/branches", label: "สาขา", icon: "store" },
      { to: "/terminals", label: "เครื่อง POS", icon: "terminal" },
      { to: "/members", label: "สมาชิก", icon: "user" },
      { to: "/members/points", label: "ประวัติแต้ม", icon: "coin" },
      { to: "/staff", label: "พนักงาน", icon: "badge" },
      { to: "/expenses", label: "ค่าใช้จ่าย", icon: "coin" },
      { to: "/purchases", label: "รายการซื้อของ", icon: "box" },
    ],
  },
  {
    id: "settings",
    label: "ตั้งค่า",
    icon: "settings",
    items: [
      { to: "/settings/branding", label: "โลโก้ร้าน", icon: "store" },
      { to: "/settings/points", label: "ตั้งค่าแต้ม", icon: "coin" },
      { to: "/settings/display", label: "ตั้งค่าจอ", icon: "terminal" },
      { to: "/settings/keybindings", label: "คีย์ลัด POS", icon: "terminal" },
    ],
  },
];

const flatItems = computed(() => [
  dashboard,
  ...groups.flatMap((g) => g.items),
]);

const openGroups = ref<Record<string, boolean>>(
  Object.fromEntries(groups.map((g) => [g.id, false])),
);

const crumb = computed(() => {
  const hit = [...flatItems.value]
    .slice()
    .reverse()
    .find((n) =>
      n.exact
        ? route.path === n.to
        : route.path === n.to || route.path.startsWith(`${n.to}/`),
    );
  return hit && hit.to !== "/" ? hit.label : "";
});

function isActive(to: string, exact = false) {
  if (exact || to === "/") return route.path === to;
  // กัน /members ไฮไลต์ตอนอยู่ /members/points
  if (to === "/products" || to === "/reports" || to === "/members") {
    return route.path === to;
  }
  return route.path === to || route.path.startsWith(`${to}/`);
}

function isGroupActive(group: NavGroup) {
  return group.items.some((i) => isActive(i.to, i.exact));
}

/** เปิดได้ทีละกลุ่ม (accordion) */
function toggleGroup(id: string) {
  const nextOpen = !openGroups.value[id];
  openGroups.value = Object.fromEntries(
    groups.map((g) => [g.id, nextOpen && g.id === id]),
  );
}

watch(
  () => route.path,
  () => {
    const activeId = groups.find((g) => isGroupActive(g))?.id ?? null;
    openGroups.value = Object.fromEntries(
      groups.map((g) => [g.id, g.id === activeId]),
    );
  },
  { immediate: true },
);

async function onLogout() {
  logout();
  await navigateTo("/login");
}
</script>

<template>
  <div class="ui-shell">
    <aside class="ui-sidebar">
      <div class="ui-sidebar__brand">
        <NuxtLink to="/" class="ui-sidebar__brand-link" :title="displayName">
          <img
            class="ui-sidebar__brand-logo"
            :src="logoSrc"
            alt=""
            width="36"
            height="36"
          />
          <div class="ui-sidebar__brand-text">
            <span class="ui-sidebar__brand-full">{{ displayName }}</span>
            <span class="ui-sidebar__brand-short" aria-hidden="true">{{
              appShort
            }}</span>
          </div>
        </NuxtLink>
      </div>

      <nav class="ui-sidebar__nav">
        <div class="ui-sidebar__nav-main">
          <NuxtLink
            :to="dashboard.to"
            class="ui-nav-top"
            :class="{ 'is-active': isActive(dashboard.to, true) }"
            :title="dashboard.label"
          >
            <UiNavIcon :name="dashboard.icon" class="ui-nav-top__icon" />
            <span class="ui-nav-top__text">{{ dashboard.label }}</span>
          </NuxtLink>

          <div
            v-for="group in groups"
            :key="group.id"
            class="ui-nav-group"
            :class="{ 'is-open': openGroups[group.id] }"
          >
            <button
              type="button"
              class="ui-nav-group__head"
              :title="group.label"
              @click="toggleGroup(group.id)"
            >
              <UiNavIcon :name="group.icon" class="ui-nav-group__icon" />
              <span class="ui-nav-group__label">{{ group.label }}</span>
              <span class="ui-nav-group__chevron" aria-hidden="true">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 7.5 10 12.5 15 7.5" />
                </svg>
              </span>
            </button>
            <ul v-show="openGroups[group.id]" class="ui-nav-tree">
              <li v-for="item in group.items" :key="item.to">
                <NuxtLink
                  :to="item.to"
                  class="ui-nav-link"
                  :class="{ 'is-active': isActive(item.to, item.exact) }"
                  :title="item.label"
                >
                  <UiNavIcon :name="item.icon" class="ui-nav-link__icon" />
                  <span class="ui-nav-link__text">{{ item.label }}</span>
                </NuxtLink>
              </li>
            </ul>
          </div>
        </div>
      </nav>
    </aside>

    <div class="ui-main">
      <header class="ui-topbar">
        <ol class="ui-breadcrumb">
          <li>
            <NuxtLink to="/" class="ui-breadcrumb__link">หน้าแรก</NuxtLink>
          </li>
          <template v-if="crumb">
            <li class="ui-breadcrumb__sep">/</li>
            <li>
              <span class="ui-breadcrumb__link is-current">{{ crumb }}</span>
            </li>
          </template>
        </ol>
        <div class="ui-topbar__user">
          <div class="ui-topbar__user-meta">
            <span class="ui-topbar__user-name">{{ user?.name || "Admin" }}</span>
            <span class="ui-topbar__user-role">
              {{ user?.code || "-" }} · {{ user?.role || "admin" }}
            </span>
          </div>
          <button type="button" class="ui-btn ui-btn--ghost ui-topbar__logout-btn" @click="onLogout">
            ออก
          </button>
        </div>
      </header>
      <main class="ui-content">
        <slot />
      </main>
    </div>
    <UiConfirmHost />
  </div>
</template>
