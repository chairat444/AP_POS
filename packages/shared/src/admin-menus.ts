/** เมนูหลังบ้านที่กำหนดสิทธิ์ได้ (ไม่รวมแดชบอร์ด / หน้าพนักงาน) */

export type AdminMenuItem = {
  key: string;
  path: string;
  label: string;
};

export type AdminMenuGroup = {
  id: string;
  label: string;
  items: AdminMenuItem[];
};

export const ADMIN_MENU_WILDCARD = "*";

export const ADMIN_MENU_GROUPS: AdminMenuGroup[] = [
  {
    id: "catalog",
    label: "สินค้า",
    items: [
      { key: "products", path: "/products", label: "รายการสินค้า" },
      { key: "products.quick", path: "/products/quick", label: "สินค้าด่วน" },
      { key: "units", path: "/units", label: "หน่วยสินค้า" },
      { key: "promos", path: "/promos", label: "โปรโมชัน" },
    ],
  },
  {
    id: "sales",
    label: "ขาย",
    items: [
      { key: "sales", path: "/sales", label: "บิลขาย" },
      { key: "shifts", path: "/shifts", label: "รอบกะ / เงินสด" },
    ],
  },
  {
    id: "reports",
    label: "รายงาน",
    items: [
      { key: "reports", path: "/reports", label: "สรุปยอดขาย" },
      { key: "reports.profit", path: "/reports/profit", label: "กำไร" },
      { key: "reports.cashflow", path: "/reports/cashflow", label: "รายรับ–รายจ่าย" },
      { key: "reports.commission", path: "/reports/commission", label: "ค่าแรงและค่าคอม" },
    ],
  },
  {
    id: "finance",
    label: "บัญชี / จัดซื้อ",
    items: [
      { key: "cash-book", path: "/cash-book", label: "สมุดรายวัน" },
      { key: "expenses", path: "/expenses", label: "ค่าใช้จ่ายหน้าร้าน" },
      {
        key: "expenses.categories",
        path: "/expenses/categories",
        label: "ประเภทค่าใช้จ่ายหน้าร้าน",
      },
      { key: "purchases", path: "/purchases", label: "แผงสรุปซื้อของ" },
      { key: "purchases.catalog", path: "/purchases/catalog", label: "รายการซื้อของ" },
    ],
  },
  {
    id: "members",
    label: "สมาชิก",
    items: [
      { key: "members", path: "/members", label: "รายชื่อสมาชิก" },
      { key: "members.points", path: "/members/points", label: "ประวัติแต้ม" },
    ],
  },
  {
    id: "org",
    label: "องค์กร",
    items: [
      { key: "branches", path: "/branches", label: "สาขา" },
      { key: "terminals", path: "/terminals", label: "เครื่อง POS" },
    ],
  },
  {
    id: "settings",
    label: "ตั้งค่า",
    items: [
      { key: "settings.branding", path: "/settings/branding", label: "โลโก้ร้าน" },
      { key: "settings.points", path: "/settings/points", label: "ตั้งค่าแต้ม" },
      { key: "settings.display", path: "/settings/display", label: "ตั้งค่าจอ" },
      {
        key: "settings.keybindings",
        path: "/settings/keybindings",
        label: "คีย์ลัด POS",
      },
      { key: "settings.backup", path: "/settings/backup", label: "สำรอง DB" },
    ],
  },
];

export const ALL_ADMIN_MENU_KEYS = ADMIN_MENU_GROUPS.flatMap((g) =>
  g.items.map((i) => i.key),
);

const MENU_KEY_SET = new Set(ALL_ADMIN_MENU_KEYS);

export function parseAdminMenus(raw: unknown): string[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      return [];
    }
  }
  const out: string[] = [];
  for (const item of list) {
    const key = String(item ?? "").trim();
    if (key === ADMIN_MENU_WILDCARD || MENU_KEY_SET.has(key)) {
      if (!out.includes(key)) out.push(key);
    }
  }
  return out;
}

export function resolveAdminMenus(
  role: string,
  stored: unknown,
): string[] {
  if (role === "admin") return [ADMIN_MENU_WILDCARD];
  if (stored == null || stored === "") return [ADMIN_MENU_WILDCARD];
  const list = parseAdminMenus(stored);
  if (list.includes(ADMIN_MENU_WILDCARD)) return [ADMIN_MENU_WILDCARD];
  return list;
}

export function hasAdminMenu(
  menus: string[] | null | undefined,
  key: string,
): boolean {
  if (!menus || menus.includes(ADMIN_MENU_WILDCARD)) return true;
  return menus.includes(key);
}

export function menuKeyForAdminPath(path: string): string | null {
  const p = String(path || "").split("?")[0].replace(/\/+$/, "") || "/";
  if (p === "/" || p === "") return null;
  if (p === "/staff" || p.startsWith("/staff/")) return "staff";
  const items = ADMIN_MENU_GROUPS.flatMap((g) => g.items).sort(
    (a, b) => b.path.length - a.path.length,
  );
  const hit = items.find((i) => p === i.path || p.startsWith(`${i.path}/`));
  return hit?.key ?? null;
}

const API_PREFIX_KEYS: Array<{
  prefix: string;
  keys: string[];
  getKeys?: string[];
}> = [
  { prefix: "/staff", keys: ["staff"] },
  { prefix: "/backup", keys: ["settings.backup"] },
  { prefix: "/terminals", keys: ["terminals"] },
  { prefix: "/branches", keys: ["branches"] },
  { prefix: "/members", keys: ["members", "members.points"] },
  { prefix: "/cash-book", keys: ["cash-book"] },
  { prefix: "/expense-categories", keys: ["expenses", "expenses.categories"] },
  { prefix: "/expenses", keys: ["expenses", "expenses.categories"] },
  { prefix: "/reports/cashflow", keys: ["reports.cashflow"] },
  { prefix: "/purchases", keys: ["purchases", "purchases.catalog"] },
  { prefix: "/promos", keys: ["promos"] },
  { prefix: "/units", keys: ["units"] },
  {
    prefix: "/products",
    keys: ["products", "products.quick"],
    getKeys: ["products", "products.quick", "promos"],
  },
  { prefix: "/shifts/commission-report", keys: ["reports.commission"] },
  { prefix: "/shifts/day-wage", keys: ["reports.commission"] },
  { prefix: "/shifts", keys: ["shifts"] },
  { prefix: "/sales/profit", keys: ["reports.profit"] },
  { prefix: "/sales/report", keys: ["reports"] },
  { prefix: "/sales", keys: ["sales", "reports", "reports.profit"] },
  { prefix: "/settings", keys: [] },
];

/** null = ไม่ต้องเช็คเมนูเพิ่ม */
export function requiredAdminMenusForApi(
  method: string,
  url: string,
): string[] | null {
  let path = String(url || "").split("?")[0];
  if (path.startsWith("/api/")) path = path.slice(4);
  if (!path.startsWith("/")) path = `/${path}`;
  const verb = method.toUpperCase();
  if (
    path.startsWith("/auth") ||
    path.startsWith("/health") ||
    path.startsWith("/uploads") ||
    path.startsWith("/sync")
  ) {
    return null;
  }
  if (verb === "GET") {
    if (
      path === "/sales/summary" ||
      path === "/sales/branches" ||
      path === "/branches" ||
      path === "/units"
    ) {
      return null;
    }
  }
  if (path.startsWith("/settings")) {
    if (verb === "GET") return null;
    return [
      "settings.branding",
      "settings.points",
      "settings.display",
      "settings.keybindings",
      "settings.backup",
    ];
  }
  const hit = API_PREFIX_KEYS.filter(
    (r) => path === r.prefix || path.startsWith(`${r.prefix}/`),
  ).sort((a, b) => b.prefix.length - a.prefix.length)[0];
  if (!hit) return null;
  const keys = verb === "GET" && hit.getKeys ? hit.getKeys : hit.keys;
  return keys.length ? keys : null;
}

export function canAccessAdminApi(
  role: string,
  menus: string[] | null | undefined,
  method: string,
  url: string,
): boolean {
  if (role === "admin" || menus?.includes(ADMIN_MENU_WILDCARD)) return true;
  const keys = requiredAdminMenusForApi(method, url);
  if (!keys) return true;
  if (keys.includes("staff")) return role === "admin";
  return keys.some((k) => hasAdminMenu(menus, k));
}
