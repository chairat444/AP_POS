import {
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** Cloud PostgreSQL — source of truth for members/points across branches. */
export const branches = pgTable("branches", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  active: integer("active").notNull().default(1),
  /** PromptPay รับเงินของสาขา (เบอร์ / เลขบัตร) */
  promptPayId: text("prompt_pay_id"),
  /** ชื่อเจ้าของบัญชี PromptPay (บุคคล) — โชว์บนจอลูกค้า */
  promptPayName: text("prompt_pay_name"),
  /** Discord webhook แจ้งยอดขายของสาขานี้ (ว่าง = ใช้ DISCORD_WEBHOOK_URL) */
  discordWebhookUrl: text("discord_webhook_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/** Master หน่วยสินค้า เช่น กก. / ชิ้น / แพ็ค */
export const productUnits = pgTable("product_units", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const products = pgTable("products", {
  id: text("id").primaryKey(),
  barcode: text("barcode").notNull(),
  productCode: text("product_code"),
  name: text("name").notNull(),
  unit: text("unit").notNull().default("ชิ้น"),
  /** ราคาทุน */
  costPrice: numeric("cost_price", { precision: 12, scale: 2 }),
  /** ราคาขาย */
  price: numeric("price", { precision: 12, scale: 2 }),
  isQuick: integer("is_quick").notNull().default(0),
  quickSort: integer("quick_sort").notNull().default(0),
  imageUrl: text("image_url"),
  isOpenPrice: integer("is_open_price").notNull().default(0),
  openPriceMax: numeric("open_price_max", { precision: 12, scale: 2 })
    .notNull()
    .default("100"),
  /** 1 = ใช้งาน, 0 = ไม่ใช้งาน (ยังไม่ลบ) */
  active: integer("active").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const customers = pgTable("customers", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  phone: text("phone"),
  points: integer("points").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/** พนักงาน — PIN สำหรับ POS, password สำหรับ Admin */
export const staff = pgTable("staff", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  pin: text("pin").notNull().default("0000"),
  passwordHash: text("password_hash"),
  role: text("role").notNull().default("cashier"),
  canLoginAdmin: integer("can_login_admin").notNull().default(0),
  active: integer("active").notNull().default(1),
  /** ค่าคอมรายวันตามยอดขาย */
  commissionEnabled: integer("commission_enabled").notNull().default(0),
  commissionStartSales: numeric("commission_start_sales", {
    precision: 12,
    scale: 2,
  })
    .notNull()
    .default("8000"),
  commissionStepSales: numeric("commission_step_sales", {
    precision: 12,
    scale: 2,
  })
    .notNull()
    .default("1000"),
  commissionPerStep: numeric("commission_per_step", {
    precision: 12,
    scale: 2,
  })
    .notNull()
    .default("100"),
  /** @deprecated ใช้ dailyWage — คงคอลัมน์ไว้เพื่อข้อมูลเก่า */
  monthlyWage: numeric("monthly_wage", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  /** ค่าแรงรายวัน (บาท) — ได้ทุกวันที่มาเปิดรอบขาย */
  dailyWage: numeric("daily_wage", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/**
 * ปรับค่าแรงรายวันต่อคน (เช่น ครึ่งวัน)
 * workDate = YYYY-MM-DD (Asia/Bangkok)
 */
export const staffDayWages = pgTable(
  "staff_day_wages",
  {
    id: text("id").primaryKey(),
    staffId: text("staff_id").notNull(),
    workDate: text("work_date").notNull(),
    wage: numeric("wage", { precision: 12, scale: 2 }).notNull(),
    note: text("note"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("staff_day_wages_staff_date_uq").on(t.staffId, t.workDate),
  ],
);

export const sales = pgTable("sales", {
  id: text("id").primaryKey(),
  billNo: text("bill_no").notNull(),
  branchId: text("branch_id").notNull(),
  terminalId: text("terminal_id").notNull(),
  shiftId: text("shift_id"),
  customerId: text("customer_id"),
  customerName: text("customer_name"),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
  discount: numeric("discount", { precision: 12, scale: 2 }).notNull().default("0"),
  pointsRedeemed: integer("points_redeemed").notNull().default(0),
  pointsEarned: integer("points_earned").notNull().default(0),
  total: numeric("total", { precision: 12, scale: 2 }).notNull(),
  paid: numeric("paid", { precision: 12, scale: 2 }).notNull().default("0"),
  change: numeric("change", { precision: 12, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("completed"),
  /** กำไรที่ snapshot ตอน sync — ทุนจริง + ประมาณการสินค้าเปิดราคา */
  profit: numeric("profit", { precision: 12, scale: 2 }),
  costAmount: numeric("cost_amount", { precision: 12, scale: 2 }),
  knownRevenue: numeric("known_revenue", { precision: 12, scale: 2 }),
  missingRevenue: numeric("missing_revenue", { precision: 12, scale: 2 }),
  missingLineCount: integer("missing_line_count").notNull().default(0),
  estimatedProfit: numeric("estimated_profit", { precision: 12, scale: 2 }),
  estimatedRevenue: numeric("estimated_revenue", { precision: 12, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
});

export const saleLines = pgTable("sale_lines", {
  id: text("id").primaryKey(),
  saleId: text("sale_id").notNull(),
  barcode: text("barcode").notNull(),
  productCode: text("product_code"),
  name: text("name").notNull(),
  qty: numeric("qty", { precision: 12, scale: 3 }).notNull(),
  unit: text("unit").notNull(),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
  discount: numeric("discount", { precision: 12, scale: 2 }).notNull().default("0"),
  lineTotal: numeric("line_total", { precision: 12, scale: 2 }).notNull(),
  /** ยอดบรรทัดหลังแบ่งส่วนลดท้ายบิล */
  netRevenue: numeric("net_revenue", { precision: 12, scale: 2 }),
  /** known = มีทุน · missing = ไม่ได้ใส่ทุน · estimated = สินค้าเปิดราคา 15% */
  costStatus: text("cost_status"),
  unitCost: numeric("unit_cost", { precision: 12, scale: 2 }),
  lineCost: numeric("line_cost", { precision: 12, scale: 2 }),
  lineProfit: numeric("line_profit", { precision: 12, scale: 2 }),
  /** ราคาขายต่อกิโลที่ snapshot จากแอดมินตอน sync */
  pricePerKg: numeric("price_per_kg", { precision: 12, scale: 2 }),
  /** 1 = ตัดสินใจเรื่องราคา/กก. แล้ว (มีหรือไม่มีก็ตาม) */
  kgPriced: integer("kg_priced").notNull().default(0),
});

export const salePayments = pgTable("sale_payments", {
  id: text("id").primaryKey(),
  saleId: text("sale_id").notNull(),
  method: text("method").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  tendered: numeric("tendered", { precision: 12, scale: 2 }),
  /** PromptPay ปลายทางตอน sync — เฉพาะเงินโอน (รัฐไม่เก็บ) */
  promptPayId: text("prompt_pay_id"),
  promptPayName: text("prompt_pay_name"),
});

export const pointLedger = pgTable("point_ledger", {
  id: text("id").primaryKey(),
  customerId: text("customer_id").notNull(),
  saleId: text("sale_id"),
  delta: integer("delta").notNull(),
  reason: text("reason").notNull(),
  branchId: text("branch_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** โปรโมชันแบบซื้อ X จ่าย Y (bundle) */
export const promos = pgTable("promos", {
  id: text("id").primaryKey(),
  productCode: text("product_code").notNull(),
  buyQty: integer("buy_qty").notNull(),
  payAmount: numeric("pay_amount", { precision: 12, scale: 2 }).notNull(),
  label: text("label").notNull(),
  active: integer("active").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/** คีย์-ค่าตั้งค่าระบบ เช่น points */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** เครื่อง POS / เทอร์มินัล */
export const terminals = pgTable("terminals", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  branchId: text("branch_id").notNull(),
  active: integer("active").notNull().default(1),
  /** ขนาดกระดาษใบเสร็จของเครื่องนี้ */
  paperWidth: text("paper_width").notNull().default("80mm"),
  autoPrint: integer("auto_print").notNull().default(1),
  printSilent: integer("print_silent").notNull().default(1),
  /** ชื่อเครื่องพิมพ์ใน OS (Windows Printers) — ว่าง = ใช้ default */
  printerName: text("printer_name"),
  receiptFooterHours: text("receipt_footer_hours"),
  receiptFooterPhones: text("receipt_footer_phones"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/** รอบขาย / เงินทอน */
export const shifts = pgTable("shifts", {
  id: text("id").primaryKey(),
  branchId: text("branch_id").notNull(),
  terminalId: text("terminal_id").notNull(),
  staffId: text("staff_id"),
  staffCode: text("staff_code"),
  staffName: text("staff_name").notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  openCash: numeric("open_cash", { precision: 12, scale: 2 }).notNull().default("0"),
  closeCash: numeric("close_cash", { precision: 12, scale: 2 }),
  expectedCash: numeric("expected_cash", { precision: 12, scale: 2 }),
  variance: numeric("variance", { precision: 12, scale: 2 }),
  status: text("status").notNull().default("open"),
  billCount: integer("bill_count").notNull().default(0),
  grossTotal: numeric("gross_total", { precision: 12, scale: 2 }).notNull().default("0"),
  closeNote: text("close_note"),
  summaryJson: text("summary_json"),
  cashMovesJson: text("cash_moves_json"),
  cashCountsJson: text("cash_counts_json"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * ประวัติยกเลิกรายการ / ยกเลิกบิลก่อนชำระ
 * เก็บแยกจาก sale_lines — เขียนทันทีตอนเกิดเหตุ ไม่รอปิดรอบ
 */
export const shiftAudits = pgTable("shift_audits", {
  id: text("id").primaryKey(),
  shiftId: text("shift_id").notNull(),
  branchId: text("branch_id").notNull(),
  terminalId: text("terminal_id").notNull(),
  staffId: text("staff_id"),
  staffName: text("staff_name").notNull(),
  type: text("type").notNull(),
  barcode: text("barcode"),
  productName: text("product_name"),
  qty: numeric("qty", { precision: 12, scale: 3 }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  billTotalBefore: numeric("bill_total_before", { precision: 12, scale: 2 }),
  itemCountBefore: integer("item_count_before"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
});

/** หมวดค่าใช้จ่าย */
export const expenseCategories = pgTable("expense_categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  /** ลำดับแสดง */
  sortOrder: integer("sort_order").notNull().default(0),
  /** ผูกกับเหตุผล cash-out บน POS (ถ้ามี) */
  posReason: text("pos_reason"),
  active: integer("active").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/**
 * ค่าใช้จ่ายร้าน
 * paid_from: drawer = จ่ายจากลิ้นชัก POS · external = จ่ายนอกลิ้นชัก (บัญชี/เจ้าของ)
 */
export const expenses = pgTable("expenses", {
  id: text("id").primaryKey(),
  /** null = กลาง / ไม่ระบุสาขา */
  branchId: text("branch_id"),
  categoryId: text("category_id").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  description: text("description"),
  paidFrom: text("paid_from").notNull().default("drawer"),
  /** วันเวลาเกิดรายการ */
  spentAt: timestamp("spent_at", { withTimezone: true }).notNull(),
  shiftId: text("shift_id"),
  terminalId: text("terminal_id"),
  staffId: text("staff_id"),
  staffName: text("staff_name"),
  /** id ของ cash move จาก POS (กันซ้ำตอน sync) */
  cashMoveId: text("cash_move_id"),
  note: text("note"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/**
 * แคตตาล็อกของซื้อ — map ชื่อ → คอลัมน์ร้าน
 * group_key: meatball | market | veg | transfer | makro
 */
export const purchaseCatalog = pgTable("purchase_catalog", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  aliases: text("aliases").notNull().default(""),
  groupKey: text("group_key").notNull().default("market"),
  unit: text("unit"),
  sortOrder: integer("sort_order").notNull().default(0),
  active: integer("active").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const purchaseDays = pgTable("purchase_days", {
  id: text("id").primaryKey(),
  day: text("day").notNull(),
  note: text("note"),
  status: text("status").notNull().default("open"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const purchaseRaw = pgTable("purchase_raw", {
  id: text("id").primaryKey(),
  dayId: text("day_id").notNull(),
  branchId: text("branch_id").notNull(),
  branchLabel: text("branch_label"),
  rawText: text("raw_text").notNull(),
  /** draft จากมือถือ (ยังไม่กดส่ง) — ไม่แจ้งเตือน / ไม่ขึ้นแผง */
  draftJson: text("draft_json"),
  draftUpdatedAt: timestamp("draft_updated_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const purchaseLines = pgTable("purchase_lines", {
  id: text("id").primaryKey(),
  dayId: text("day_id").notNull(),
  branchId: text("branch_id").notNull(),
  catalogId: text("catalog_id"),
  name: text("name").notNull(),
  qtyText: text("qty_text"),
  note: text("note"),
  groupKey: text("group_key").notNull().default("market"),
  matched: integer("matched").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/**
 * สมุดรายวัน (เงินเข้า–เงินออก)
 * direction: in | out
 * kind: sale | loan | expense | other
 */
export const cashBookEntries = pgTable("cash_book_entries", {
  id: text("id").primaryKey(),
  /** วันที่รายการ (Asia/Bangkok) YYYY-MM-DD */
  entryDate: text("entry_date").notNull(),
  direction: text("direction").notNull(),
  kind: text("kind").notNull(),
  branchId: text("branch_id"),
  categoryId: text("category_id"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  description: text("description"),
  note: text("note"),
  /**
   * คีย์รายการอัตโนมัติ (เช่น auto:sale:2026-09-12:branch-001)
   * null = บันทึกมือ
   */
  sourceKey: text("source_key").unique(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
