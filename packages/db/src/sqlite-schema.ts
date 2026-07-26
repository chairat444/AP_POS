import {
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/** Local SQLite schema for each POS terminal (offline-first). */
export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  barcode: text("barcode").notNull(),
  productCode: text("product_code"),
  name: text("name").notNull(),
  unit: text("unit").notNull().default("ชิ้น"),
  price: real("price"),
  isQuick: integer("is_quick", { mode: "boolean" }).notNull().default(false),
  quickSort: integer("quick_sort").notNull().default(0),
  imageUrl: text("image_url"),
  isOpenPrice: integer("is_open_price", { mode: "boolean" }).notNull().default(false),
  openPriceMax: real("open_price_max").notNull().default(100),
  updatedAt: text("updated_at").notNull(),
});

export const customers = sqliteTable("customers", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  points: integer("points").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

export const sales = sqliteTable("sales", {
  id: text("id").primaryKey(),
  billNo: text("bill_no").notNull(),
  branchId: text("branch_id").notNull(),
  terminalId: text("terminal_id").notNull(),
  customerId: text("customer_id"),
  subtotal: real("subtotal").notNull(),
  discount: real("discount").notNull().default(0),
  pointsRedeemed: integer("points_redeemed").notNull().default(0),
  pointsEarned: integer("points_earned").notNull().default(0),
  total: real("total").notNull(),
  paid: real("paid").notNull().default(0),
  change: real("change").notNull().default(0),
  status: text("status").notNull().default("completed"),
  createdAt: text("created_at").notNull(),
  syncedAt: text("synced_at"),
});

export const saleLines = sqliteTable("sale_lines", {
  id: text("id").primaryKey(),
  saleId: text("sale_id").notNull(),
  barcode: text("barcode").notNull(),
  name: text("name").notNull(),
  qty: real("qty").notNull(),
  unit: text("unit").notNull(),
  unitPrice: real("unit_price").notNull(),
  discount: real("discount").notNull().default(0),
  lineTotal: real("line_total").notNull(),
});

export const syncOutbox = sqliteTable("sync_outbox", {
  id: text("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  payload: text("payload").notNull(),
  createdAt: text("created_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
});

export const shifts = sqliteTable("shifts", {
  id: text("id").primaryKey(),
  branchId: text("branch_id").notNull(),
  terminalId: text("terminal_id").notNull(),
  openedAt: text("opened_at").notNull(),
  closedAt: text("closed_at"),
  openCash: real("open_cash").notNull().default(0),
  closeCash: real("close_cash"),
  status: text("status").notNull().default("open"),
  syncedAt: text("synced_at"),
});
