import {
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** Cloud PostgreSQL — source of truth for members/points across branches. */
export const branches = pgTable("branches", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const products = pgTable("products", {
  id: text("id").primaryKey(),
  barcode: text("barcode").notNull(),
  productCode: text("product_code"),
  name: text("name").notNull(),
  unit: text("unit").notNull().default("ชิ้น"),
  price: numeric("price", { precision: 12, scale: 2 }),
  isQuick: integer("is_quick").notNull().default(0),
  quickSort: integer("quick_sort").notNull().default(0),
  imageUrl: text("image_url"),
  isOpenPrice: integer("is_open_price").notNull().default(0),
  openPriceMax: numeric("open_price_max", { precision: 12, scale: 2 }).notNull().default("100"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const customers = pgTable("customers", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  phone: text("phone"),
  points: integer("points").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sales = pgTable("sales", {
  id: text("id").primaryKey(),
  billNo: text("bill_no").notNull(),
  branchId: text("branch_id").notNull(),
  terminalId: text("terminal_id").notNull(),
  customerId: text("customer_id"),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
  discount: numeric("discount", { precision: 12, scale: 2 }).notNull().default("0"),
  pointsRedeemed: integer("points_redeemed").notNull().default(0),
  pointsEarned: integer("points_earned").notNull().default(0),
  total: numeric("total", { precision: 12, scale: 2 }).notNull(),
  paid: numeric("paid", { precision: 12, scale: 2 }).notNull().default("0"),
  change: numeric("change", { precision: 12, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("completed"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
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
