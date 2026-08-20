import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from "@nestjs/common";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { pg } from "@ap-pos/db";

export type PgDb = NodePgDatabase<typeof pg>;

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool!: Pool;
  db!: PgDb;

  async onModuleInit() {
    const url =
      process.env.DATABASE_URL ??
      "postgresql://appleclub@localhost:5432/ap_pos";
    this.pool = new Pool({ connectionString: url });
    this.db = drizzle(this.pool, { schema: pg });
    await this.ensureSchema();
    this.logger.log(`Postgres connected: ${url.replace(/:[^:@/]+@/, ":***@")}`);
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  private async ensureSchema() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS branches (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
      ALTER TABLE branches ADD COLUMN IF NOT EXISTS active INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE branches ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      ALTER TABLE branches ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
      ALTER TABLE branches ADD COLUMN IF NOT EXISTS prompt_pay_id TEXT;
      ALTER TABLE branches ADD COLUMN IF NOT EXISTS prompt_pay_name TEXT;
      CREATE TABLE IF NOT EXISTS product_units (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        barcode TEXT NOT NULL,
        product_code TEXT,
        name TEXT NOT NULL,
        unit TEXT NOT NULL DEFAULT 'ชิ้น',
        cost_price NUMERIC(12,2),
        price NUMERIC(12,2),
        is_quick INTEGER NOT NULL DEFAULT 0,
        quick_sort INTEGER NOT NULL DEFAULT 0,
        image_url TEXT,
        is_open_price INTEGER NOT NULL DEFAULT 0,
        open_price_max NUMERIC(12,2) NOT NULL DEFAULT 100,
        active INTEGER NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
      ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_price NUMERIC(12,2);
      ALTER TABLE products ADD COLUMN IF NOT EXISTS active INTEGER NOT NULL DEFAULT 1;
      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        phone TEXT,
        points INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS staff (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        pin TEXT NOT NULL DEFAULT '0000',
        password_hash TEXT,
        role TEXT NOT NULL DEFAULT 'cashier',
        can_login_admin INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        commission_enabled INTEGER NOT NULL DEFAULT 0,
        commission_start_sales NUMERIC(12,2) NOT NULL DEFAULT 8000,
        commission_step_sales NUMERIC(12,2) NOT NULL DEFAULT 1000,
        commission_per_step NUMERIC(12,2) NOT NULL DEFAULT 100,
        monthly_wage NUMERIC(12,2) NOT NULL DEFAULT 0,
        daily_wage NUMERIC(12,2) NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
      ALTER TABLE staff ADD COLUMN IF NOT EXISTS commission_enabled INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE staff ADD COLUMN IF NOT EXISTS commission_start_sales NUMERIC(12,2) NOT NULL DEFAULT 8000;
      ALTER TABLE staff ADD COLUMN IF NOT EXISTS commission_step_sales NUMERIC(12,2) NOT NULL DEFAULT 1000;
      ALTER TABLE staff ADD COLUMN IF NOT EXISTS commission_per_step NUMERIC(12,2) NOT NULL DEFAULT 100;
      ALTER TABLE staff ADD COLUMN IF NOT EXISTS monthly_wage NUMERIC(12,2) NOT NULL DEFAULT 0;
      ALTER TABLE staff ADD COLUMN IF NOT EXISTS daily_wage NUMERIC(12,2) NOT NULL DEFAULT 0;
      CREATE TABLE IF NOT EXISTS staff_day_wages (
        id TEXT PRIMARY KEY,
        staff_id TEXT NOT NULL,
        work_date TEXT NOT NULL,
        wage NUMERIC(12,2) NOT NULL,
        note TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS staff_day_wages_staff_date_uq
        ON staff_day_wages (staff_id, work_date);
      CREATE TABLE IF NOT EXISTS sales (
        id TEXT PRIMARY KEY,
        bill_no TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        terminal_id TEXT NOT NULL,
        shift_id TEXT,
        customer_id TEXT,
        customer_name TEXT,
        subtotal NUMERIC(12,2) NOT NULL,
        discount NUMERIC(12,2) NOT NULL DEFAULT 0,
        points_redeemed INTEGER NOT NULL DEFAULT 0,
        points_earned INTEGER NOT NULL DEFAULT 0,
        total NUMERIC(12,2) NOT NULL,
        paid NUMERIC(12,2) NOT NULL DEFAULT 0,
        change NUMERIC(12,2) NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'completed',
        created_at TIMESTAMPTZ NOT NULL,
        synced_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS sale_lines (
        id TEXT PRIMARY KEY,
        sale_id TEXT NOT NULL,
        barcode TEXT NOT NULL,
        product_code TEXT,
        name TEXT NOT NULL,
        qty NUMERIC(12,3) NOT NULL,
        unit TEXT NOT NULL,
        unit_price NUMERIC(12,2) NOT NULL,
        discount NUMERIC(12,2) NOT NULL DEFAULT 0,
        line_total NUMERIC(12,2) NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sale_payments (
        id TEXT PRIMARY KEY,
        sale_id TEXT NOT NULL,
        method TEXT NOT NULL,
        amount NUMERIC(12,2) NOT NULL,
        tendered NUMERIC(12,2)
      );
      CREATE TABLE IF NOT EXISTS point_ledger (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        sale_id TEXT,
        delta INTEGER NOT NULL,
        reason TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS promos (
        id TEXT PRIMARY KEY,
        product_code TEXT NOT NULL,
        buy_qty INTEGER NOT NULL,
        pay_amount NUMERIC(12,2) NOT NULL,
        label TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS terminals (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        paper_width TEXT NOT NULL DEFAULT '80mm',
        auto_print INTEGER NOT NULL DEFAULT 1,
        print_silent INTEGER NOT NULL DEFAULT 1,
        printer_name TEXT,
        receipt_footer_hours TEXT,
        receipt_footer_phones TEXT,
        last_seen_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
      ALTER TABLE terminals ADD COLUMN IF NOT EXISTS paper_width TEXT NOT NULL DEFAULT '80mm';
      ALTER TABLE terminals ADD COLUMN IF NOT EXISTS auto_print INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE terminals ADD COLUMN IF NOT EXISTS print_silent INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE terminals ADD COLUMN IF NOT EXISTS printer_name TEXT;
      ALTER TABLE terminals ADD COLUMN IF NOT EXISTS receipt_footer_hours TEXT;
      ALTER TABLE terminals ADD COLUMN IF NOT EXISTS receipt_footer_phones TEXT;
      CREATE TABLE IF NOT EXISTS shifts (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL,
        terminal_id TEXT NOT NULL,
        staff_id TEXT,
        staff_code TEXT,
        staff_name TEXT NOT NULL,
        opened_at TIMESTAMPTZ NOT NULL,
        closed_at TIMESTAMPTZ,
        open_cash NUMERIC(12,2) NOT NULL DEFAULT 0,
        close_cash NUMERIC(12,2),
        expected_cash NUMERIC(12,2),
        variance NUMERIC(12,2),
        status TEXT NOT NULL DEFAULT 'open',
        bill_count INTEGER NOT NULL DEFAULT 0,
        gross_total NUMERIC(12,2) NOT NULL DEFAULT 0,
        close_note TEXT,
        summary_json TEXT,
        cash_moves_json TEXT,
        cash_counts_json TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
        qty NUMERIC(12,3),
        amount NUMERIC(12,2) NOT NULL,
        bill_total_before NUMERIC(12,2),
        item_count_before INTEGER,
        created_at TIMESTAMPTZ NOT NULL,
        synced_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS shift_audits_shift_id_idx ON shift_audits (shift_id);
      CREATE INDEX IF NOT EXISTS shift_audits_created_at_idx ON shift_audits (created_at);
      CREATE TABLE IF NOT EXISTS expense_categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        pos_reason TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS expenses (
        id TEXT PRIMARY KEY,
        branch_id TEXT,
        category_id TEXT NOT NULL,
        amount NUMERIC(12,2) NOT NULL,
        description TEXT,
        paid_from TEXT NOT NULL DEFAULT 'drawer',
        spent_at TIMESTAMPTZ NOT NULL,
        shift_id TEXT,
        terminal_id TEXT,
        staff_id TEXT,
        staff_name TEXT,
        cash_move_id TEXT,
        note TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
      CREATE UNIQUE INDEX IF NOT EXISTS expenses_cash_move_id_uidx
        ON expenses (cash_move_id) WHERE cash_move_id IS NOT NULL AND deleted_at IS NULL;
      ALTER TABLE expenses ALTER COLUMN branch_id DROP NOT NULL;
      INSERT INTO expense_categories (id, name, sort_order, pos_reason)
      VALUES
        ('expcat-buy', 'ซื้อของ', 1, NULL),
        ('expcat-makro', 'แม็คโคร', 2, NULL),
        ('expcat-ploibun', 'พลอยบุญ', 3, NULL),
        ('expcat-pork', 'ค่าหมู', 4, NULL),
        ('expcat-veg', 'ค่าผัก', 5, NULL),
        ('expcat-meatball', 'ค่าลูกชิ้น', 6, NULL),
        ('expcat-water', 'ค่าน้ำ', 10, 'ค่าน้ำ'),
        ('expcat-supplies', 'ค่าของ / สินค้าใช้ในร้าน', 20, 'ค่าของ / สินค้าใช้ในร้าน'),
        ('expcat-utility', 'ค่าไฟ / ค่าบริการ', 30, 'ค่าไฟ / ค่าบริการ'),
        ('expcat-other', 'อื่นๆ', 90, 'อื่นๆ')
      ON CONFLICT (id) DO NOTHING;
      CREATE TABLE IF NOT EXISTS purchase_catalog (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        aliases TEXT NOT NULL DEFAULT '',
        group_key TEXT NOT NULL DEFAULT 'market',
        unit TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS purchase_days (
        id TEXT PRIMARY KEY,
        day TEXT NOT NULL,
        note TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS purchase_days_day_uidx ON purchase_days (day);
      CREATE TABLE IF NOT EXISTS purchase_raw (
        id TEXT PRIMARY KEY,
        day_id TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        branch_label TEXT,
        raw_text TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS purchase_raw_day_branch_uidx
        ON purchase_raw (day_id, branch_id);
      CREATE TABLE IF NOT EXISTS purchase_lines (
        id TEXT PRIMARY KEY,
        day_id TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        catalog_id TEXT,
        name TEXT NOT NULL,
        qty_text TEXT,
        note TEXT,
        group_key TEXT NOT NULL DEFAULT 'market',
        matched INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
      INSERT INTO app_settings (key, value)
      VALUES ('points', '{"bahtPerPoint":100,"bahtPerRedeemPoint":1}')
      ON CONFLICT (key) DO NOTHING;
      INSERT INTO app_settings (key, value)
      VALUES ('display', '{"customerScreenEnabled":true}')
      ON CONFLICT (key) DO NOTHING;
    `);
  }
}
