import initSqlJs, { type Database as SqlJsDatabase } from "sql.js/dist/sql-asm.js";
import { app } from "electron";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";

export type LocalProduct = {
  id: string;
  barcode: string;
  productCode?: string | null;
  name: string;
  unit: string;
  costPrice?: number | null;
  price: number | null;
  isQuick: boolean;
  quickSort: number;
  imageUrl?: string | null;
  isOpenPrice: boolean;
  openPriceMax: number;
  updatedAt: string;
};

export type LocalMember = {
  id: string;
  code: string;
  name: string;
  phone?: string | null;
  points: number;
  updatedAt: string;
};

export type LocalSaleInput = {
  id: string;
  billNo: string;
  branchId: string;
  terminalId: string;
  shiftId?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  subtotal: number;
  discount: number;
  pointsRedeemed: number;
  pointsEarned: number;
  total: number;
  paid: number;
  change: number;
  createdAt: string;
  payments: Array<{
    method: string;
    amount: number;
    tendered?: number;
  }>;
  lines: Array<{
    id: string;
    barcode: string;
    productCode?: string;
    name: string;
    qty: number;
    unit: string;
    unitPrice: number;
    discount: number;
    lineTotal: number;
  }>;
};

let sqlite: SqlJsDatabase | null = null;
let dbPath = "";
let ready: Promise<void> | null = null;

function nowIso() {
  return new Date().toISOString();
}

function persist() {
  if (!sqlite || !dbPath) return;
  const data = sqlite.export();
  const tmp = `${dbPath}.tmp`;
  // เขียนไฟล์ชั่วคราวแล้ว rename — ลดโอกาสไฟล์พังตอนไฟดับกลางคัน
  writeFileSync(tmp, Buffer.from(data));
  renameSync(tmp, dbPath);
}

async function ensureDb() {
  if (sqlite) return { sqlite, dbPath };
  if (!ready) {
    ready = (async () => {
      const dir = join(app.getPath("userData"), "db");
      mkdirSync(dir, { recursive: true });
      dbPath = join(dir, "ap-pos-local.sqlite");
      const SQL = await initSqlJs();
      if (existsSync(dbPath)) {
        const buf = readFileSync(dbPath);
        sqlite = new SQL.Database(buf);
      } else {
        sqlite = new SQL.Database();
      }
      sqlite.run(`
        CREATE TABLE IF NOT EXISTS products (
          id TEXT PRIMARY KEY,
          barcode TEXT NOT NULL,
          product_code TEXT,
          name TEXT NOT NULL,
          unit TEXT NOT NULL DEFAULT 'ชิ้น',
          cost_price REAL,
          price REAL,
          is_quick INTEGER NOT NULL DEFAULT 0,
          quick_sort INTEGER NOT NULL DEFAULT 0,
          image_url TEXT,
          is_open_price INTEGER NOT NULL DEFAULT 0,
          open_price_max REAL NOT NULL DEFAULT 100,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS customers (
          id TEXT PRIMARY KEY,
          code TEXT NOT NULL,
          name TEXT NOT NULL,
          phone TEXT,
          points INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sales (
          id TEXT PRIMARY KEY,
          bill_no TEXT NOT NULL,
          branch_id TEXT NOT NULL,
          terminal_id TEXT NOT NULL,
          shift_id TEXT,
          customer_id TEXT,
          customer_name TEXT,
          subtotal REAL NOT NULL,
          discount REAL NOT NULL DEFAULT 0,
          points_redeemed INTEGER NOT NULL DEFAULT 0,
          points_earned INTEGER NOT NULL DEFAULT 0,
          total REAL NOT NULL,
          paid REAL NOT NULL DEFAULT 0,
          change REAL NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'completed',
          created_at TEXT NOT NULL,
          synced_at TEXT
        );
        CREATE TABLE IF NOT EXISTS sale_lines (
          id TEXT PRIMARY KEY,
          sale_id TEXT NOT NULL,
          barcode TEXT NOT NULL,
          product_code TEXT,
          name TEXT NOT NULL,
          qty REAL NOT NULL,
          unit TEXT NOT NULL,
          unit_price REAL NOT NULL,
          discount REAL NOT NULL DEFAULT 0,
          line_total REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sale_payments (
          id TEXT PRIMARY KEY,
          sale_id TEXT NOT NULL,
          method TEXT NOT NULL,
          amount REAL NOT NULL,
          tendered REAL
        );
        CREATE TABLE IF NOT EXISTS sync_outbox (
          id TEXT PRIMARY KEY,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT
        );
        CREATE TABLE IF NOT EXISTS shifts (
          id TEXT PRIMARY KEY,
          branch_id TEXT NOT NULL,
          terminal_id TEXT NOT NULL,
          opened_at TEXT NOT NULL,
          closed_at TEXT,
          open_cash REAL NOT NULL DEFAULT 0,
          close_cash REAL,
          status TEXT NOT NULL DEFAULT 'open',
          synced_at TEXT
        );
        CREATE TABLE IF NOT EXISTS shift_audits (
          id TEXT PRIMARY KEY,
          shift_id TEXT NOT NULL,
          branch_id TEXT NOT NULL,
          terminal_id TEXT NOT NULL,
          staff_id TEXT,
          staff_name TEXT NOT NULL,
          type TEXT NOT NULL,
          barcode TEXT,
          product_name TEXT,
          qty REAL,
          amount REAL NOT NULL,
          bill_total_before REAL,
          item_count_before INTEGER,
          created_at TEXT NOT NULL,
          synced_at TEXT
        );
        CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      try {
        sqlite.run("ALTER TABLE products ADD COLUMN cost_price REAL");
      } catch {
        /* column already exists */
      }
      try {
        sqlite.run(`
          CREATE TABLE IF NOT EXISTS shift_audits (
            id TEXT PRIMARY KEY,
            shift_id TEXT NOT NULL,
            branch_id TEXT NOT NULL,
            terminal_id TEXT NOT NULL,
            staff_id TEXT,
            staff_name TEXT NOT NULL,
            type TEXT NOT NULL,
            barcode TEXT,
            product_name TEXT,
            qty REAL,
            amount REAL NOT NULL,
            bill_total_before REAL,
            item_count_before INTEGER,
            created_at TEXT NOT NULL,
            synced_at TEXT
          )
        `);
      } catch {
        /* ignore */
      }
      persist();
      await applyBundledSeedIfNeeded();
    })();
  }
  await ready;
  return { sqlite: sqlite!, dbPath };
}

/** แพ็กใน installer ที่ resources/seed/offline-snapshot.json */
export type OfflineSeedSnapshot = {
  version?: string;
  exportedAt?: string;
  products?: LocalProduct[];
  members?: LocalMember[];
  promos?: unknown[];
  settings?: unknown;
  staff?: unknown[];
  branches?: unknown[];
  terminals?: unknown[];
  printer?: {
    paperWidth?: "58mm" | "80mm";
    autoPrint?: boolean;
    silent?: boolean;
    printerName?: string;
    openDrawer?: boolean;
    headerText?: string;
    footerHours?: string;
    footerPhones?: string;
  };
};

function resolveSeedSnapshotPath(): string | null {
  const candidates = [
    // electron-builder extraResources → process.resourcesPath/seed/
    join(process.resourcesPath, "seed", "offline-snapshot.json"),
    // dev / electron-vite
    join(__dirname, "../../resources/seed/offline-snapshot.json"),
    join(app.getAppPath(), "resources/seed/offline-snapshot.json"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function productCount(): number {
  const rows = queryAll<{ c: number }>("SELECT COUNT(*) AS c FROM products");
  return Number(rows[0]?.c ?? 0);
}

/**
 * ติดตั้งครั้งแรก / DB ว่าง → ใส่สินค้า สมาชิก พนักงาน ตั้งค่า จาก seed ใน Setup
 * ไม่ทับเครื่องที่ sync แล้ว · ไม่ตั้ง sync-cursor (ออนไลน์ครั้งแรกจะ bootstrap ใหม่)
 */
async function applyBundledSeedIfNeeded() {
  if (!sqlite) return;
  const already = queryAll<{ value: string }>(
    "SELECT value FROM meta WHERE key = ?",
    ["seed-applied"],
  );
  if (already[0]?.value) return;
  if (productCount() > 0) {
    exec(
      `INSERT INTO meta(key, value, updated_at) VALUES(?,?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
      ["seed-applied", "skipped-has-products", nowIso()],
    );
    persist();
    return;
  }

  const seedPath = resolveSeedSnapshotPath();
  if (!seedPath) {
    console.warn("[offline-seed] ไม่พบ offline-snapshot.json — ข้าม");
    return;
  }

  let snap: OfflineSeedSnapshot;
  try {
    snap = JSON.parse(readFileSync(seedPath, "utf8")) as OfflineSeedSnapshot;
  } catch (e) {
    console.warn("[offline-seed] อ่าน seed ไม่ได้", e);
    return;
  }

  const products = Array.isArray(snap.products) ? snap.products : [];
  const members = Array.isArray(snap.members) ? snap.members : [];
  if (!products.length && !members.length && !snap.staff) {
    console.warn("[offline-seed] snapshot ว่าง — รัน seed:export ก่อน build");
    return;
  }

  for (const p of products) {
    if (!p?.id) continue;
    exec(
      `INSERT INTO products(
        id, barcode, product_code, name, unit, cost_price, price, is_quick, quick_sort,
        image_url, is_open_price, open_price_max, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        barcode=excluded.barcode,
        product_code=excluded.product_code,
        name=excluded.name,
        unit=excluded.unit,
        cost_price=excluded.cost_price,
        price=excluded.price,
        is_quick=excluded.is_quick,
        quick_sort=excluded.quick_sort,
        image_url=excluded.image_url,
        is_open_price=excluded.is_open_price,
        open_price_max=excluded.open_price_max,
        updated_at=excluded.updated_at`,
      [
        p.id,
        p.barcode ?? "",
        p.productCode ?? null,
        p.name ?? "",
        p.unit ?? "ชิ้น",
        p.costPrice ?? null,
        p.price ?? null,
        p.isQuick ? 1 : 0,
        p.quickSort ?? 0,
        p.imageUrl ?? null,
        p.isOpenPrice ? 1 : 0,
        p.openPriceMax ?? 100,
        p.updatedAt ?? nowIso(),
      ],
    );
  }

  for (const m of members) {
    if (!m?.id) continue;
    exec(
      `INSERT INTO customers(id, code, name, phone, points, updated_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         code=excluded.code,
         name=excluded.name,
         phone=excluded.phone,
         points=excluded.points,
         updated_at=excluded.updated_at`,
      [
        m.id,
        m.code ?? "",
        m.name ?? "",
        m.phone ?? null,
        Math.max(0, Math.floor(Number(m.points) || 0)),
        m.updatedAt ?? nowIso(),
      ],
    );
  }

  const metaPuts: Array<[string, unknown]> = [
    ["cached-promos", snap.promos ?? []],
    ["cached-settings", snap.settings ?? {}],
    ["cached-staff", snap.staff ?? []],
    ["cached-branches", snap.branches ?? []],
    ["cached-terminals", snap.terminals ?? []],
  ];
  if (snap.printer && typeof snap.printer === "object") {
    metaPuts.push(["printer-config", snap.printer]);
  }

  for (const [key, value] of metaPuts) {
    exec(
      `INSERT INTO meta(key, value, updated_at) VALUES(?,?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
      [key, JSON.stringify(value), nowIso()],
    );
  }

  const version = String(snap.version || snap.exportedAt || "1");
  exec(
    `INSERT INTO meta(key, value, updated_at) VALUES(?,?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
    ["seed-applied", version, nowIso()],
  );
  persist();
  console.info(
    `[offline-seed] ใส่ข้อมูลเริ่มต้นแล้ว · สินค้า ${products.length} · สมาชิก ${members.length} · จาก ${seedPath}`,
  );
}

function queryAll<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): T[] {
  if (!sqlite) return [];
  const stmt = sqlite.prepare(sql);
  stmt.bind(params as never[]);
  const rows: T[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return rows;
}

function exec(sql: string, params: unknown[] = []) {
  if (!sqlite) return;
  sqlite.run(sql, params as never[]);
}

function run(sql: string, params: unknown[] = []) {
  exec(sql, params);
  persist();
}

/** เดิมลบบิลที่ sync แล้ว — ตอนนี้เก็บไว้ในเครื่องเสมอ (ดู synced_at) */
export async function purgeSyncedSales() {
  await ensureDb();
  // no-op: เก็บประวัติบิลใน SQLite เพื่อกู้ / ส่งซ้ำได้
  return 0;
}

/** ล้างข้อมูลขาย/กะ/outbox ในเครื่อง — ใช้โหมดทดสอบเท่านั้น (กันล้างเครื่องขายจริง) */
export async function wipeTestSalesData(): Promise<{ sales: number }> {
  await ensureDb();
  const mode = queryAll<{ value: string }>(
    "SELECT value FROM meta WHERE key = ?",
    ["pos-env-mode"],
  )[0]?.value;
  if (mode !== "test") {
    throw new Error("ล้างข้อมูลได้เฉพาะโหมดทดสอบ");
  }
  const rows = queryAll<{ c: number }>("SELECT COUNT(*) AS c FROM sales");
  const sales = Number(rows[0]?.c ?? 0);
  exec("DELETE FROM sale_payments");
  exec("DELETE FROM sale_lines");
  exec("DELETE FROM sales");
  exec("DELETE FROM sync_outbox");
  exec("DELETE FROM shift_audits");
  exec("DELETE FROM shifts");
  exec(
    `DELETE FROM meta WHERE key = 'active-shift-session'
      OR key = 'pending-member-creates'
      OR key LIKE 'bill-seq-%'`,
  );
  persist();
  return { sales };
}

export type LocalSaleStatusRow = {
  id: string;
  billNo: string;
  shiftId: string | null;
  total: number;
  createdAt: string;
  syncedAt: string | null;
  status: "pending" | "synced";
};

/** รายการบิลในเครื่อง — สำหรับแท็บซิงค์ */
export async function listLocalSales(opts?: {
  limit?: number;
  pendingOnly?: boolean;
}): Promise<LocalSaleStatusRow[]> {
  await ensureDb();
  const limit = Math.max(1, Math.min(500, opts?.limit ?? 80));
  const where = opts?.pendingOnly ? "WHERE synced_at IS NULL" : "";
  const rows = queryAll<{
    id: string;
    bill_no: string;
    shift_id: string | null;
    total: number;
    created_at: string;
    synced_at: string | null;
  }>(
    `SELECT id, bill_no, shift_id, total, created_at, synced_at
     FROM sales ${where}
     ORDER BY created_at DESC
     LIMIT ${limit}`,
  );
  return rows.map((r) => ({
    id: r.id,
    billNo: r.bill_no,
    shiftId: r.shift_id,
    total: Number(r.total) || 0,
    createdAt: r.created_at,
    syncedAt: r.synced_at,
    status: r.synced_at ? "synced" : "pending",
  }));
}

export async function countPendingSales(): Promise<number> {
  await ensureDb();
  const rows = queryAll<{ c: number }>(
    "SELECT COUNT(*) AS c FROM sales WHERE synced_at IS NULL",
  );
  return Number(rows[0]?.c ?? 0);
}

function buildSaleEnvelopeFromDb(saleId: string): {
  id: string;
  type: "sale";
  payload: LocalSaleInput;
} | null {
  const sales = queryAll<{
    id: string;
    bill_no: string;
    branch_id: string;
    terminal_id: string;
    shift_id: string | null;
    customer_id: string | null;
    customer_name: string | null;
    subtotal: number;
    discount: number;
    points_redeemed: number;
    points_earned: number;
    total: number;
    paid: number;
    change: number;
    created_at: string;
  }>("SELECT * FROM sales WHERE id = ?", [saleId]);
  const sale = sales[0];
  if (!sale) return null;

  const lines = queryAll<{
    id: string;
    barcode: string;
    product_code: string | null;
    name: string;
    qty: number;
    unit: string;
    unit_price: number;
    discount: number;
    line_total: number;
  }>("SELECT * FROM sale_lines WHERE sale_id = ?", [saleId]);

  const pays = queryAll<{
    method: string;
    amount: number;
    tendered: number | null;
  }>("SELECT method, amount, tendered FROM sale_payments WHERE sale_id = ?", [
    saleId,
  ]);

  // บิลที่รายการหาย (พังตอนเซฟ) — สร้างบรรทัดรวมจากยอดบิล เพื่อให้ส่งขึ้นเซิร์ฟได้
  const linePayload =
    lines.length > 0
      ? lines.map((l) => ({
          id: l.id,
          barcode: l.barcode,
          productCode: l.product_code ?? undefined,
          name: l.name,
          qty: Number(l.qty) || 0,
          unit: l.unit,
          unitPrice: Number(l.unit_price) || 0,
          discount: Number(l.discount) || 0,
          lineTotal: Number(l.line_total) || 0,
        }))
      : [
          {
            id: `${sale.id}:line:recovered`,
            barcode: "RECOVERED",
            productCode: undefined,
            name: `บิลรวม ${sale.bill_no} (กู้รายการ)`,
            qty: 1,
            unit: "บิล",
            unitPrice: Number(sale.total) || 0,
            discount: 0,
            lineTotal: Number(sale.total) || 0,
          },
        ];

  const payload: LocalSaleInput = {
    id: sale.id,
    billNo: sale.bill_no,
    branchId: sale.branch_id,
    terminalId: sale.terminal_id,
    shiftId: sale.shift_id,
    customerId: sale.customer_id,
    customerName: sale.customer_name,
    subtotal: Number(sale.subtotal) || 0,
    discount: Number(sale.discount) || 0,
    pointsRedeemed: Number(sale.points_redeemed) || 0,
    pointsEarned: Number(sale.points_earned) || 0,
    total: Number(sale.total) || 0,
    paid: Number(sale.paid) || 0,
    change: Number(sale.change) || 0,
    createdAt: sale.created_at,
    payments:
      pays.length > 0
        ? pays.map((p) => ({
            method: p.method,
            amount: Number(p.amount) || 0,
            tendered: p.tendered == null ? undefined : Number(p.tendered),
          }))
        : [
            {
              method: "cash",
              amount: Number(sale.total) || 0,
            },
          ],
    lines: linePayload,
  };

  const outboxId = `${sale.id}:outbox`;
  return { id: outboxId, type: "sale", payload };
}

/**
 * ใส่บิลที่ยังไม่ synced กลับเข้า outbox — รีเฟรช payload จาก DB เสมอ
 * (กันแถว outbox เก่า/พัง แล้ว skip จนบิลค้างส่งไม่ได้)
 */
export async function requeueUnsyncedSales(): Promise<number> {
  await ensureDb();
  const pending = queryAll<{ id: string }>(
    "SELECT id FROM sales WHERE synced_at IS NULL ORDER BY created_at ASC",
  );
  let n = 0;
  for (const row of pending) {
    const env = buildSaleEnvelopeFromDb(row.id);
    if (!env) continue;
    const outboxId = env.id;
    const exists = queryAll("SELECT id FROM sync_outbox WHERE id = ?", [
      outboxId,
    ]);
    const payload = JSON.stringify(env);
    if (exists.length) {
      exec(
        `UPDATE sync_outbox SET payload = ?, entity_type = 'sale', entity_id = ?, last_error = NULL WHERE id = ?`,
        [payload, row.id, outboxId],
      );
    } else {
      exec(
        `INSERT INTO sync_outbox(id, entity_type, entity_id, payload, created_at, attempts, last_error)
         VALUES (?,?,?,?,?,?,?)`,
        [outboxId, "sale", row.id, payload, nowIso(), 0, null],
      );
    }
    n += 1;
  }
  if (n) persist();
  return n;
}

/** บันทึก error บน outbox หลัง sync ล้มเหลว (ให้ UI แสดงได้) */
export async function markOutboxErrors(
  errors: Array<{ id: string; message: string }>,
): Promise<void> {
  await ensureDb();
  if (!errors.length) return;
  for (const e of errors) {
    const msg = String(e.message || "sync failed").slice(0, 500);
    exec(
      `UPDATE sync_outbox SET attempts = COALESCE(attempts, 0) + 1, last_error = ? WHERE id = ?`,
      [msg, e.id],
    );
  }
  persist();
}

export async function getSqlitePath() {
  const { dbPath: path } = await ensureDb();
  return path;
}

export async function getMeta(key: string): Promise<string | null> {
  await ensureDb();
  const rows = queryAll<{ value: string }>(
    "SELECT value FROM meta WHERE key = ?",
    [key],
  );
  return rows[0]?.value ?? null;
}

export async function setMeta(key: string, value: string) {
  await ensureDb();
  run(
    `INSERT INTO meta(key, value, updated_at) VALUES(?,?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
    [key, value, nowIso()],
  );
}

export async function listProducts(): Promise<LocalProduct[]> {
  await ensureDb();
  return queryAll<{
    id: string;
    barcode: string;
    product_code: string | null;
    name: string;
    unit: string;
    cost_price: number | null;
    price: number | null;
    is_quick: number;
    quick_sort: number;
    image_url: string | null;
    is_open_price: number;
    open_price_max: number;
    updated_at: string;
  }>("SELECT * FROM products ORDER BY quick_sort ASC").map((p) => ({
    id: p.id,
    barcode: p.barcode,
    productCode: p.product_code,
    name: p.name,
    unit: p.unit,
    costPrice: p.cost_price ?? null,
    price: p.price,
    isQuick: Boolean(p.is_quick),
    quickSort: p.quick_sort,
    imageUrl: p.image_url,
    isOpenPrice: Boolean(p.is_open_price),
    openPriceMax: p.open_price_max ?? 100,
    updatedAt: p.updated_at,
  }));
}

export async function upsertProducts(products: LocalProduct[]) {
  await ensureDb();
  for (const p of products) {
    run(
      `INSERT INTO products(
        id, barcode, product_code, name, unit, cost_price, price, is_quick, quick_sort,
        image_url, is_open_price, open_price_max, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        barcode=excluded.barcode,
        product_code=excluded.product_code,
        name=excluded.name,
        unit=excluded.unit,
        cost_price=excluded.cost_price,
        price=excluded.price,
        is_quick=excluded.is_quick,
        quick_sort=excluded.quick_sort,
        image_url=excluded.image_url,
        is_open_price=excluded.is_open_price,
        open_price_max=excluded.open_price_max,
        updated_at=excluded.updated_at`,
      [
        p.id,
        p.barcode,
        p.productCode ?? null,
        p.name,
        p.unit,
        p.costPrice ?? null,
        p.price,
        p.isQuick ? 1 : 0,
        p.quickSort,
        p.imageUrl ?? null,
        p.isOpenPrice ? 1 : 0,
        p.openPriceMax ?? 100,
        p.updatedAt,
      ],
    );
  }
}

export async function removeProducts(ids: string[]) {
  await ensureDb();
  for (const id of ids) run("DELETE FROM products WHERE id = ?", [id]);
}

export async function listMembers(): Promise<LocalMember[]> {
  await ensureDb();
  return queryAll<{
    id: string;
    code: string;
    name: string;
    phone: string | null;
    points: number;
    updated_at: string;
  }>("SELECT * FROM customers ORDER BY name ASC").map((m) => ({
    id: m.id,
    code: m.code,
    name: m.name,
    phone: m.phone,
    points: m.points,
    updatedAt: m.updated_at,
  }));
}

export async function upsertMembers(members: LocalMember[]) {
  await ensureDb();
  for (const m of members) {
    run(
      `INSERT INTO customers(id, code, name, phone, points, updated_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         code=excluded.code,
         name=excluded.name,
         phone=excluded.phone,
         points=excluded.points,
         updated_at=excluded.updated_at`,
      [m.id, m.code, m.name, m.phone ?? null, m.points, m.updatedAt],
    );
  }
}

export async function removeMembers(ids: string[]) {
  await ensureDb();
  for (const id of ids) run("DELETE FROM customers WHERE id = ?", [id]);
}

export async function adjustMemberPoints(id: string, delta: number) {
  await ensureDb();
  const rows = queryAll<{
    id: string;
    code: string;
    name: string;
    phone: string | null;
    points: number;
    updated_at: string;
  }>("SELECT * FROM customers WHERE id = ?", [id]);
  const row = rows[0];
  if (!row) return null;
  const points = Math.max(0, Math.floor(row.points + delta));
  const updatedAt = nowIso();
  run("UPDATE customers SET points = ?, updated_at = ? WHERE id = ?", [
    points,
    updatedAt,
    id,
  ]);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    phone: row.phone,
    points,
    updatedAt,
  };
}

export async function saveSale(input: LocalSaleInput) {
  await ensureDb();
  const existing = queryAll("SELECT id FROM sales WHERE id = ?", [input.id]);
  if (existing.length) return input;

  run(
    `INSERT INTO sales(
      id, bill_no, branch_id, terminal_id, shift_id, customer_id, customer_name,
      subtotal, discount, points_redeemed, points_earned, total, paid, change,
      status, created_at, synced_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      input.id,
      input.billNo,
      input.branchId,
      input.terminalId,
      input.shiftId ?? null,
      input.customerId ?? null,
      input.customerName ?? null,
      input.subtotal,
      input.discount,
      input.pointsRedeemed,
      input.pointsEarned,
      input.total,
      input.paid,
      input.change,
      "completed",
      input.createdAt,
      null,
    ],
  );

  for (const line of input.lines) {
    run(
      `INSERT INTO sale_lines(
        id, sale_id, barcode, product_code, name, qty, unit, unit_price, discount, line_total
      ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        line.id,
        input.id,
        line.barcode,
        line.productCode ?? null,
        line.name,
        line.qty,
        line.unit,
        line.unitPrice,
        line.discount,
        line.lineTotal,
      ],
    );
  }

  input.payments.forEach((p, i) => {
    run(
      `INSERT INTO sale_payments(id, sale_id, method, amount, tendered)
       VALUES (?,?,?,?,?)`,
      [`${input.id}:pay:${i}`, input.id, p.method, p.amount, p.tendered ?? null],
    );
  });

  const outboxId = `${input.id}:outbox`;
  run(
    `INSERT INTO sync_outbox(id, entity_type, entity_id, payload, created_at, attempts, last_error)
     VALUES (?,?,?,?,?,?,?)`,
    [
      outboxId,
      "sale",
      input.id,
      JSON.stringify({ id: outboxId, type: "sale", payload: input }),
      nowIso(),
      0,
      null,
    ],
  );

  return input;
}

export async function listOutbox() {
  await ensureDb();
  return queryAll<{
    id: string;
    entity_type: string;
    entity_id: string;
    payload: string;
  }>(
    `SELECT id, entity_type, entity_id, payload FROM sync_outbox ORDER BY created_at ASC`,
  ).map((row) => {
    try {
      const parsed = JSON.parse(row.payload) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object") {
        return { id: row.id, type: row.entity_type, payload: null };
      }
      // envelope มาตรฐาน
      if (parsed.type === "sale" || parsed.type === "shift" || parsed.type === "audit") {
        return parsed;
      }
      // entity_type บอก sale แต่ payload รูปผิด
      if (row.entity_type === "sale") {
        const nested = parsed.payload as Record<string, unknown> | undefined;
        if (nested && typeof nested === "object" && nested.billNo) {
          return { id: row.id, type: "sale", payload: nested };
        }
        if ((parsed as { billNo?: string }).billNo) {
          return { id: row.id, type: "sale", payload: parsed };
        }
      }
      if (row.entity_type === "shift") {
        return { id: row.id, type: "shift", payload: parsed };
      }
      if (row.entity_type === "audit") {
        return { id: row.id, type: "audit", payload: parsed };
      }
      return parsed;
    } catch {
      return { id: row.id, type: row.entity_type, payload: null };
    }
  });
}

/**
 * สร้าง envelope จากบิลค้างใน sales โดยตรง (ไม่พึ่ง payload outbox เก่า)
 * ใช้ตอนกดส่งบิลค้าง — กันรูป payload พังแล้วถูก filter ออก
 */
export async function listPendingSaleEnvelopes(): Promise<
  Array<{ id: string; type: "sale"; payload: LocalSaleInput }>
> {
  await ensureDb();
  const pending = queryAll<{ id: string }>(
    "SELECT id FROM sales WHERE synced_at IS NULL ORDER BY created_at ASC",
  );
  const out: Array<{ id: string; type: "sale"; payload: LocalSaleInput }> = [];
  for (const row of pending) {
    const env = buildSaleEnvelopeFromDb(row.id);
    if (!env) continue;
    out.push(env);
  }
  return out;
}

export type OutboxRow = {
  id: string;
  entityType: string;
  entityId: string;
  payload: string;
  createdAt: string;
  attempts: number;
  lastError: string | null;
};

export async function listOutboxRows(): Promise<OutboxRow[]> {
  await ensureDb();
  return queryAll<{
    id: string;
    entity_type: string;
    entity_id: string;
    payload: string;
    created_at: string;
    attempts: number;
    last_error: string | null;
  }>(
    `SELECT id, entity_type, entity_id, payload, created_at, attempts, last_error
     FROM sync_outbox ORDER BY created_at ASC`,
  ).map((row) => ({
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    payload: row.payload,
    createdAt: row.created_at,
    attempts: row.attempts ?? 0,
    lastError: row.last_error ?? null,
  }));
}

export async function ackOutbox(ids: string[]) {
  await ensureDb();
  if (!ids.length) return;
  const at = nowIso();
  for (const id of ids) {
    const rows = queryAll<{ entity_type: string; entity_id: string }>(
      "SELECT entity_type, entity_id FROM sync_outbox WHERE id = ?",
      [id],
    );
    const entityType = rows[0]?.entity_type ?? "sale";
    exec("DELETE FROM sync_outbox WHERE id = ?", [id]);
    if (entityType === "shift") {
      exec("UPDATE shifts SET synced_at = ? WHERE id = ?", [
        at,
        rows[0]?.entity_id ?? id.replace(/:shift:outbox$/, ""),
      ]);
      continue;
    }
    if (entityType === "audit") {
      exec("UPDATE shift_audits SET synced_at = ? WHERE id = ?", [
        at,
        rows[0]?.entity_id ?? id.replace(/:audit:outbox$/, ""),
      ]);
      continue;
    }
    const saleId = rows[0]?.entity_id ?? id.replace(/:outbox$/, "");
    // เก็บบิลใน SQLite — แค่ติดสถานะ synced_at
    exec("UPDATE sales SET synced_at = ? WHERE id = ?", [at, saleId]);
  }
  persist();
}

export async function pendingOutboxCount() {
  await ensureDb();
  const rows = queryAll<{ c: number }>("SELECT COUNT(*) AS c FROM sync_outbox");
  return rows[0]?.c ?? 0;
}

export async function enqueueShift(payload: {
  id: string;
  branchId: string;
  terminalId: string;
  staffId?: string | null;
  staffCode?: string | null;
  staffName: string;
  openedAt: string;
  closedAt?: string | null;
  openCash: number;
  closeCash?: number | null;
  expectedCash?: number | null;
  variance?: number | null;
  status: "open" | "closed";
  billCount?: number;
  grossTotal?: number;
  closeNote?: string | null;
  summary?: unknown;
  cashMoves?: unknown[];
  cashCounts?: unknown[];
  terminalName?: string;
}) {
  await ensureDb();
  const existing = queryAll<{ id: string }>(
    "SELECT id FROM shifts WHERE id = ?",
    [payload.id],
  );
  if (existing[0]) {
    exec(
      `UPDATE shifts SET
        branch_id = ?, terminal_id = ?, opened_at = ?, closed_at = ?,
        open_cash = ?, close_cash = ?, status = ?, synced_at = NULL
       WHERE id = ?`,
      [
        payload.branchId,
        payload.terminalId,
        payload.openedAt,
        payload.closedAt ?? null,
        payload.openCash,
        payload.closeCash ?? null,
        payload.status,
        payload.id,
      ],
    );
  } else {
    exec(
      `INSERT INTO shifts(
        id, branch_id, terminal_id, opened_at, closed_at,
        open_cash, close_cash, status, synced_at
      ) VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        payload.id,
        payload.branchId,
        payload.terminalId,
        payload.openedAt,
        payload.closedAt ?? null,
        payload.openCash,
        payload.closeCash ?? null,
        payload.status,
        null,
      ],
    );
  }

  const outboxId = `${payload.id}:shift:outbox`;
  exec("DELETE FROM sync_outbox WHERE id = ?", [outboxId]);
  run(
    `INSERT INTO sync_outbox(id, entity_type, entity_id, payload, created_at, attempts, last_error)
     VALUES (?,?,?,?,?,?,?)`,
    [
      outboxId,
      "shift",
      payload.id,
      JSON.stringify({ id: outboxId, type: "shift", payload }),
      nowIso(),
      0,
      null,
    ],
  );
  persist();
  return payload;
}

export type LocalShiftAudit = {
  id: string;
  shiftId: string;
  branchId: string;
  terminalId: string;
  staffId?: string | null;
  staffName: string;
  type: "line_void" | "bill_cancel" | string;
  at: string;
  barcode?: string | null;
  productName?: string | null;
  qty?: number | null;
  amount: number;
  billTotalBefore?: number | null;
  itemCountBefore?: number | null;
};

/** บันทึกยกเลิกรายการ/บิลทันทีลงดิสก์ + outbox */
export async function saveAudit(input: LocalShiftAudit) {
  await ensureDb();
  const existing = queryAll("SELECT id FROM shift_audits WHERE id = ?", [
    input.id,
  ]);
  if (!existing.length) {
    run(
      `INSERT INTO shift_audits(
        id, shift_id, branch_id, terminal_id, staff_id, staff_name,
        type, barcode, product_name, qty, amount,
        bill_total_before, item_count_before, created_at, synced_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        input.id,
        input.shiftId,
        input.branchId,
        input.terminalId,
        input.staffId ?? null,
        input.staffName,
        input.type,
        input.barcode ?? null,
        input.productName ?? null,
        input.qty ?? null,
        input.amount,
        input.billTotalBefore ?? null,
        input.itemCountBefore ?? null,
        input.at,
        null,
      ],
    );
  }

  const outboxId = `${input.id}:audit:outbox`;
  exec("DELETE FROM sync_outbox WHERE id = ?", [outboxId]);
  run(
    `INSERT INTO sync_outbox(id, entity_type, entity_id, payload, created_at, attempts, last_error)
     VALUES (?,?,?,?,?,?,?)`,
    [
      outboxId,
      "audit",
      input.id,
      JSON.stringify({ id: outboxId, type: "audit", payload: input }),
      nowIso(),
      0,
      null,
    ],
  );
  return input;
}

export async function listAuditsByShift(shiftId: string): Promise<LocalShiftAudit[]> {
  await ensureDb();
  return queryAll<{
    id: string;
    shift_id: string;
    branch_id: string;
    terminal_id: string;
    staff_id: string | null;
    staff_name: string;
    type: string;
    barcode: string | null;
    product_name: string | null;
    qty: number | null;
    amount: number;
    bill_total_before: number | null;
    item_count_before: number | null;
    created_at: string;
  }>(
    "SELECT * FROM shift_audits WHERE shift_id = ? ORDER BY created_at ASC",
    [shiftId],
  ).map((row) => ({
    id: row.id,
    shiftId: row.shift_id,
    branchId: row.branch_id,
    terminalId: row.terminal_id,
    staffId: row.staff_id,
    staffName: row.staff_name,
    type: row.type,
    barcode: row.barcode,
    productName: row.product_name,
    qty: row.qty,
    amount: row.amount,
    billTotalBefore: row.bill_total_before,
    itemCountBefore: row.item_count_before,
    at: row.created_at,
  }));
}

export async function getDeviceConfig() {
  const raw = await getMeta("device-config");
  if (raw) {
    const parsed = JSON.parse(raw) as {
      branchId: string;
      branchName: string;
      terminalId: string;
      terminalName?: string;
      setupDone?: boolean;
    };
    if (!parsed.terminalName) {
      parsed.terminalName = "เครื่อง POS";
      await setMeta("device-config", JSON.stringify(parsed));
    }
    return parsed;
  }
  const created = {
    branchId: "branch-002",
    branchName: "สาขาเจ็ดเสมียน",
    terminalId: `terminal-${Date.now().toString(36)}`,
    terminalName: "เครื่อง POS",
    setupDone: false,
  };
  await setMeta("device-config", JSON.stringify(created));
  return created;
}

export async function setDeviceConfig(patch: {
  branchId?: string;
  branchName?: string;
  terminalId?: string;
  terminalName?: string;
  setupDone?: boolean;
}) {
  const current = await getDeviceConfig();
  const next = {
    ...current,
    ...(patch.branchId != null ? { branchId: patch.branchId } : {}),
    ...(patch.branchName != null ? { branchName: patch.branchName } : {}),
    ...(patch.terminalId != null ? { terminalId: patch.terminalId } : {}),
    ...(patch.terminalName != null
      ? { terminalName: patch.terminalName.trim() || "เครื่อง POS" }
      : {}),
    ...(patch.setupDone != null ? { setupDone: patch.setupDone } : {}),
  };
  await setMeta("device-config", JSON.stringify(next));
  return next;
}

/** เขียนทับทั้งก้อน — ใช้ตอนลงทะเบียนเครื่องให้ชัวร์ */
export async function replaceDeviceConfig(config: {
  branchId: string;
  branchName: string;
  terminalId: string;
  terminalName?: string;
  setupDone?: boolean;
}) {
  const next = {
    branchId: config.branchId,
    branchName: config.branchName,
    terminalId: config.terminalId,
    terminalName: (config.terminalName ?? "").trim() || "เครื่อง POS",
    setupDone: Boolean(config.setupDone),
  };
  await setMeta("device-config", JSON.stringify(next));
  return next;
}
