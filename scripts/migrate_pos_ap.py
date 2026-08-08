#!/usr/bin/env python3
"""
Migrate POS_AP (SQL Server) → AP POS (Postgres)

Safety:
  - READ-ONLY on SQL Server (SELECT only)
  - Writes ONLY to Postgres AP POS
  - Default is DRY-RUN (no writes). Pass --apply to commit.

Customer identity across branches:
  - Migrate เจ็ดเสมียน (002) first, then หลุมดิน (001)
  - Primary match key = phone (normalized) against existing Postgres customers
  - Do NOT merge by XVCstCode alone (codes collide across DBs)
  - Same phone → one customer; points = snapshot from branch with latest purchase (do not sum)

Example (เจ็ดเสมียน → branch 002):
  MSSQL_PASSWORD='***' \\
  .venv-migrate/bin/python scripts/migrate_pos_ap.py \\
    --branch-code 002 --branch-name 'สาขาเจ็ดเสมียน' --dry-run

  ... --apply
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Iterable
from zoneinfo import ZoneInfo

BKK = ZoneInfo("Asia/Bangkok")

import psycopg
import pymssql

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------


@dataclass
class SourceConfig:
    host: str
    port: int
    user: str
    password: str
    database: str


@dataclass
class TargetConfig:
    database_url: str
    branch_code: str
    branch_name: str
    branch_id: str
    terminal_id: str
    terminal_code: str
    terminal_name: str
    open_price_id: str
    open_price_barcode: str
    open_price_name: str
    open_price_max: Decimal
    apply: bool
    sales_only: bool
    sales_from: date | None
    sales_limit: int | None


def env(name: str, default: str | None = None) -> str:
    v = os.environ.get(name, default)
    if v is None or v == "":
        raise SystemExit(f"Missing env {name}")
    return v


def parse_args() -> tuple[SourceConfig, TargetConfig]:
    p = argparse.ArgumentParser(description="Migrate POS_AP (SQL Server) → AP POS")
    p.add_argument("--branch-code", default="002")
    p.add_argument("--branch-name", default="สาขาเจ็ดเสมียน")
    p.add_argument(
        "--apply",
        action="store_true",
        help="Write to Postgres (default is dry-run)",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Force dry-run even if --apply is set",
    )
    p.add_argument(
        "--sales-only",
        action="store_true",
        help="Only clear+reimport sales for the branch (skip products/customers/staff)",
    )
    p.add_argument(
        "--sales-from",
        default=None,
        help="Only sales on/after YYYY-MM-DD (optional)",
    )
    p.add_argument(
        "--sales-limit",
        type=int,
        default=None,
        help="Limit number of sale headers (debug)",
    )
    args = p.parse_args()
    apply = bool(args.apply) and not bool(args.dry_run)

    src = SourceConfig(
        host=os.environ.get("MSSQL_HOST", "192.168.1.104"),
        port=int(os.environ.get("MSSQL_PORT", "1433")),
        user=os.environ.get("MSSQL_USER", "sa"),
        password=env("MSSQL_PASSWORD"),
        database=os.environ.get("MSSQL_DB", "POS_AP"),
    )
    code = args.branch_code.strip()
    tgt = TargetConfig(
        database_url=os.environ.get(
            "DATABASE_URL", "postgresql://appleclub@localhost:5432/ap_pos"
        ),
        branch_code=code,
        branch_name=args.branch_name.strip(),
        branch_id=f"branch-{code}",
        terminal_id=f"terminal-{code}-001",
        terminal_code="001",
        terminal_name=f"เครื่อง POS {args.branch_name.strip()}",
        open_price_id=f"prod-open-price-{code}",
        open_price_barcode=f"OPENPRICE-{code}",
        open_price_name="สินค้าเบ็ดเตล็ด",
        open_price_max=Decimal("100"),
        apply=apply,
        sales_only=bool(args.sales_only),
        sales_from=date.fromisoformat(args.sales_from) if args.sales_from else None,
        sales_limit=args.sales_limit,
    )
    return src, tgt


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def s(v: Any, default: str = "") -> str:
    if v is None:
        return default
    return str(v).strip()


def n(v: Any, default: float = 0.0) -> float:
    if v is None or v == "":
        return default
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def i(v: Any, default: int = 0) -> int:
    try:
        return int(n(v, float(default)))
    except (TypeError, ValueError):
        return default


def money(v: Any) -> Decimal:
    return Decimal(str(round(n(v), 2)))


def is_price_barcode(bar: str) -> bool:
    """ระบบเก่า misc: barcode '1'..'100' means price baht."""
    if not bar or not re.fullmatch(r"\d{1,3}", bar):
        return False
    x = int(bar)
    return 1 <= x <= 100


def pay_method(code: str) -> str:
    c = s(code)
    if c == "1":
        return "cash"
    if c == "6":
        return "transfer"
    if c == "4":
        return "points"
    return "cash"


def as_dt(v: Any) -> datetime | None:
    """ระบบเก่าเก็บเวลาท้องถิ่น (ไทย) แบบไม่มี timezone — ต้องตีเป็น Asia/Bangkok ไม่ใช่ UTC"""
    if v is None:
        return None
    if isinstance(v, datetime):
        if v.tzinfo is None:
            return v.replace(tzinfo=BKK)
        return v.astimezone(BKK)
    if isinstance(v, date):
        return datetime(v.year, v.month, v.day, tzinfo=BKK)
    return None


def shift_pg_id(branch_code: str, log_code: str) -> str:
    return f"shift-{branch_code}-{log_code}"


def chunks(items: list[Any], size: int) -> Iterable[list[Any]]:
    for i0 in range(0, len(items), size):
        yield items[i0 : i0 + size]


# ---------------------------------------------------------------------------
# SQL Server fetch (SELECT only)
# ---------------------------------------------------------------------------


class MsReader:
    def __init__(self, cfg: SourceConfig):
        self.cfg = cfg
        self.conn = pymssql.connect(
            server=cfg.host,
            port=cfg.port,
            user=cfg.user,
            password=cfg.password,
            database=cfg.database,
            login_timeout=10,
            timeout=120,
            as_dict=True,
        )

    def close(self) -> None:
        self.conn.close()

    def q(self, sql: str, params: tuple[Any, ...] | None = None) -> list[dict[str, Any]]:
        with self.conn.cursor(as_dict=True) as cur:
            cur.execute(sql, params or ())
            rows = cur.fetchall()
            return list(rows or [])


def fetch_sales_only(ms: MsReader, tgt: TargetConfig) -> dict[str, Any]:
    """ดึงเฉพาะหัวบิล / รายการ / การชำระ — ไม่แตะสินค้า ลูกค้า พนักงาน"""
    print("→ reading SQL Server sales only (SELECT only)…")

    sales_filter = ""
    sales_params: list[Any] = []
    if tgt.sales_from:
        sales_filter = " AND XDSahDocDate >= %s"
        sales_params.append(tgt.sales_from)

    limit_sql = ""
    if tgt.sales_limit:
        limit_sql = f" TOP {int(tgt.sales_limit)}"

    headers = ms.q(
        f"""
        SELECT{limit_sql}
          XVSahDocNo, XVPosCode, XTSahSalDate, XDSahDocDate, XVSahDocStatus,
          XVCstCode, XVSahCstName, XFSahTotal, XFSahDis, XFSahGrand, XFSahChange,
          XISahCstPointGet, XISahCstPointUse, XVUsrCode, XVLghLogCode
        FROM (
          SELECT
            h.XVSahDocNo, h.XVPosCode, h.XTSahSalDate, h.XDSahDocDate, h.XVSahDocStatus,
            h.XVCstCode, h.XVSahCstName, h.XFSahTotal, h.XFSahDis, h.XFSahGrand, h.XFSahChange,
            h.XISahCstPointGet, h.XISahCstPointUse, h.XVUsrCode, h.XVLghLogCode
          FROM TPosTSalHD h
          UNION ALL
          SELECT
            t.XVSahDocNo, t.XVPosCode, t.XTSahSalDate, t.XDSahDocDate, t.XVSahDocStatus,
            t.XVCstCode, t.XVSahCstName, t.XFSahTotal, t.XFSahDis, t.XFSahGrand, t.XFSahChange,
            t.XISahCstPointGet, t.XISahCstPointUse, t.XVUsrCode, t.XVLghLogCode
          FROM TTmpTSalHD001 t
          WHERE NOT EXISTS (
            SELECT 1 FROM TPosTSalHD m WHERE m.XVSahDocNo = t.XVSahDocNo
          )
        ) x
        WHERE 1=1
        {sales_filter}
        ORDER BY XTSahSalDate
        """,
        tuple(sales_params) if sales_params else None,
    )

    doc_nos = [s(h["XVSahDocNo"]) for h in headers if s(h["XVSahDocNo"])]
    print(f"  sale headers: {len(doc_nos)}")

    shift_logs = ms.q(
        """
        SELECT
          XVLghLogCode, XVUsrCode, XDLghBusDate,
          XTLghLoginDate, XTLghLogOutDate,
          XILghSalCnt, XFLghSalNetAmt,
          XFLghMonOnHand, XFLghRcvCash
        FROM TPosTLogHD
        ORDER BY XTLghLoginDate
        """
    )
    print(f"  shift logs: {len(shift_logs)}")

    lines: list[dict[str, Any]] = []
    pays: list[dict[str, Any]] = []
    for batch in chunks(doc_nos, 400):
        ph = ",".join(["%s"] * len(batch))
        lines.extend(
            ms.q(
                f"""
                SELECT XVSahDocNo, XISadSeq, XVBarCode, XVSkuCode, XVSadDesc,
                       XVSadSunName, XFSadQty, XFSadSalPrice, XFSadDis, XFSadNet
                FROM TPosTSalDT
                WHERE XVSahDocNo IN ({ph})
                UNION ALL
                SELECT d.XVSahDocNo, d.XISadSeq, d.XVBarCode, d.XVSkuCode, d.XVSadDesc,
                       d.XVSadSunName, d.XFSadQty, d.XFSadSalPrice, d.XFSadDis, d.XFSadNet
                FROM TTmpTSalDT001 d
                WHERE d.XVSahDocNo IN ({ph})
                  AND NOT EXISTS (
                    SELECT 1 FROM TPosTSalHD m WHERE m.XVSahDocNo = d.XVSahDocNo
                  )
                """,
                tuple(batch) + tuple(batch),
            )
        )
        pays.extend(
            ms.q(
                f"""
                SELECT XVSahDocNo, XISarSeq, XVSarStaRcvType,
                       XFSarRcvAmt, XFSarChgAmt, XFSarNetAmt
                FROM TPosTSalRC
                WHERE XVSahDocNo IN ({ph})
                UNION ALL
                SELECT r.XVSahDocNo, r.XISarSeq, r.XVSarStaRcvType,
                       r.XFSarRcvAmt, r.XFSarChgAmt, r.XFSarNetAmt
                FROM TTmpTSalRC001 r
                WHERE r.XVSahDocNo IN ({ph})
                  AND NOT EXISTS (
                    SELECT 1 FROM TPosTSalHD m WHERE m.XVSahDocNo = r.XVSahDocNo
                  )
                """,
                tuple(batch) + tuple(batch),
            )
        )

    return {
        "sold_real": set(),
        "sold_price": set(),
        "units": [],
        "products": [],
        "customers": [],
        "staff": [],
        "headers": headers,
        "lines": lines,
        "pays": pays,
        "shift_logs": shift_logs,
        "quick_count": 0,
    }


def fetch_all(ms: MsReader, tgt: TargetConfig) -> dict[str, Any]:
    if tgt.sales_only:
        return fetch_sales_only(ms, tgt)

    print("→ reading SQL Server (SELECT only)…")

    sold_bars = ms.q(
        """
        SELECT DISTINCT LTRIM(RTRIM(XVBarCode)) AS bar
        FROM TPosTSalDT
        WHERE NULLIF(LTRIM(RTRIM(XVBarCode)), '') IS NOT NULL
        UNION
        SELECT DISTINCT LTRIM(RTRIM(d.XVBarCode))
        FROM TTmpTSalDT001 d
        WHERE NULLIF(LTRIM(RTRIM(d.XVBarCode)), '') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM TPosTSalHD m WHERE m.XVSahDocNo = d.XVSahDocNo
          )
        """
    )
    sold_set = {s(r["bar"]) for r in sold_bars if s(r["bar"])}
    sold_real = {b for b in sold_set if not is_price_barcode(b)}
    sold_price = {b for b in sold_set if is_price_barcode(b)}

    bars = ms.q(
        """
        SELECT
          b.XVBarCode, b.XVSkuCode, b.XVSunCode,
          b.XVBarName, b.XFBarRetPri1,
          b.XBBarIsAlwSale,
          s.XVSkuName, s.XBSkuIsActive, s.XBSkuIsAlwEditPrice,
          u.XVSunName
        FROM TPdtMBar b
        LEFT JOIN TPdtMSku s ON s.XVSkuCode = b.XVSkuCode
        LEFT JOIN TPdtMUnit u ON u.XVSunCode = b.XVSunCode
        """
    )

    quick = ms.q(
        """
        SELECT XVBarCode, XVSkuCode, XITgpSeq, XVTgpShortName, XVTgrCode
        FROM TPdtMTchGroupPdt
        """
    )
    quick_by_bar = {
        s(r["XVBarCode"]): i(r["XITgpSeq"], 999)
        for r in quick
        if s(r["XVBarCode"])
    }

    # Products to import: sold real barcodes present in master
    products: list[dict[str, Any]] = []
    unit_names: set[str] = set()
    for r in bars:
        bar = s(r["XVBarCode"])
        if bar not in sold_real:
            continue
        unit = s(r["XVSunName"]) or "ชิ้น"
        unit_names.add(unit)
        name = s(r["XVBarName"]) or s(r["XVSkuName"]) or bar
        products.append(
            {
                "barcode": bar,
                "product_code": s(r["XVSkuCode"]) or None,
                "name": name,
                "unit": unit,
                "price": money(r["XFBarRetPri1"]),
                "is_quick": 1 if bar in quick_by_bar else 0,
                "quick_sort": quick_by_bar.get(bar, 0),
                "is_open_price": 0,
                "open_price_max": Decimal("100"),
            }
        )

    # Sold barcodes missing from master (create from sale lines)
    missing = sorted(sold_real - {p["barcode"] for p in products})
    if missing:
        placeholders = ",".join(["%s"] * len(missing))
        # pymssql uses %s
        meta = ms.q(
            f"""
            SELECT
              LTRIM(RTRIM(XVBarCode)) AS bar,
              MAX(XVSadDesc) AS name,
              MAX(XVSadSunName) AS unit,
              MAX(XFSadSalPrice) AS price
            FROM TPosTSalDT
            WHERE LTRIM(RTRIM(XVBarCode)) IN ({placeholders})
            GROUP BY LTRIM(RTRIM(XVBarCode))
            """,
            tuple(missing),
        )
        have = {s(r["bar"]) for r in meta}
        for r in meta:
            bar = s(r["bar"])
            unit = s(r["unit"]) or "ชิ้น"
            unit_names.add(unit)
            products.append(
                {
                    "barcode": bar,
                    "product_code": None,
                    "name": s(r["name"]) or bar,
                    "unit": unit,
                    "price": money(r["price"]),
                    "is_quick": 1 if bar in quick_by_bar else 0,
                    "quick_sort": quick_by_bar.get(bar, 0),
                    "is_open_price": 0,
                    "open_price_max": Decimal("100"),
                }
            )
        for bar in missing:
            if bar in have:
                continue
            products.append(
                {
                    "barcode": bar,
                    "product_code": None,
                    "name": bar,
                    "unit": "ชิ้น",
                    "price": Decimal("0"),
                    "is_quick": 0,
                    "quick_sort": 0,
                    "is_open_price": 0,
                    "open_price_max": Decimal("100"),
                }
            )
            unit_names.add("ชิ้น")

    # Open-price product (replaces barcodes 1..100)
    unit_names.add("ชิ้น")
    products.append(
        {
            "barcode": tgt.open_price_barcode,
            "product_code": "OPENPRICE",
            "name": tgt.open_price_name,
            "unit": "ชิ้น",
            "price": None,
            "is_quick": 1,
            "quick_sort": 0,
            "is_open_price": 1,
            "open_price_max": tgt.open_price_max,
            "id": tgt.open_price_id,
        }
    )

    units = sorted(unit_names)

    customers_raw = ms.q(
        """
        SELECT
          c.XVCstCode, c.XVCstName, c.XVCstPhone, c.XBCstIsActive,
          ISNULL(p.pts, 0) AS pts
        FROM TCstMCustomer c
        LEFT JOIN (
          SELECT XVCstCode, SUM(CAST(ISNULL(XICstPoint,0) AS INT)) AS pts
          FROM TCstTCstPoint
          GROUP BY XVCstCode
        ) p ON p.XVCstCode = c.XVCstCode
        WHERE ISNULL(c.XBCstIsActive, 1) = 1
        """
    )
    customers = []
    for r in customers_raw:
        code = s(r["XVCstCode"])
        if not code:
            continue
        customers.append(
            {
                "code": code,
                "name": s(r["XVCstName"]) or code,
                "phone": s(r["XVCstPhone"]) or None,
                "points": max(0, i(r["pts"])),
            }
        )

    staff_raw = ms.q(
        """
        SELECT XVUsrCode, XVUsrName, XVUsrLName, XBUsrIsActive
        FROM TUsrMUser
        WHERE ISNULL(XBUsrIsActive, 1) = 1
          AND LOWER(XVUsrCode) <> 'admin'
          AND LOWER(XVUsrCode) <> 'support'
        """
    )
    staff = []
    for idx, r in enumerate(staff_raw, start=1):
        code = s(r["XVUsrCode"])
        name = (s(r["XVUsrName"]) + " " + s(r["XVUsrLName"])).strip() or code
        pin = f"{idx:04d}"  # 0001, 0002… — ต้องเปลี่ยนตอนเปิดใช้จริง
        staff.append(
            {
                "legacy_code": code,  # XVUsrCode ดิบ เช่น ap
                "code": f"{tgt.branch_code}-{code}",  # 002-ap
                "name": name,
                "pin": pin,
                "role": "cashier",
            }
        )

    # Sales headers = main ∪ temp-not-in-main
    sales_filter = ""
    sales_params: list[Any] = []
    if tgt.sales_from:
        sales_filter = " AND XDSahDocDate >= %s"
        sales_params.append(tgt.sales_from)

    limit_sql = ""
    if tgt.sales_limit:
        limit_sql = f" TOP {int(tgt.sales_limit)}"

    headers = ms.q(
        f"""
        SELECT{limit_sql}
          XVSahDocNo, XVPosCode, XTSahSalDate, XDSahDocDate, XVSahDocStatus,
          XVCstCode, XVSahCstName, XFSahTotal, XFSahDis, XFSahGrand, XFSahChange,
          XISahCstPointGet, XISahCstPointUse, XVUsrCode, XVLghLogCode
        FROM (
          SELECT
            h.XVSahDocNo, h.XVPosCode, h.XTSahSalDate, h.XDSahDocDate, h.XVSahDocStatus,
            h.XVCstCode, h.XVSahCstName, h.XFSahTotal, h.XFSahDis, h.XFSahGrand, h.XFSahChange,
            h.XISahCstPointGet, h.XISahCstPointUse, h.XVUsrCode, h.XVLghLogCode
          FROM TPosTSalHD h
          UNION ALL
          SELECT
            t.XVSahDocNo, t.XVPosCode, t.XTSahSalDate, t.XDSahDocDate, t.XVSahDocStatus,
            t.XVCstCode, t.XVSahCstName, t.XFSahTotal, t.XFSahDis, t.XFSahGrand, t.XFSahChange,
            t.XISahCstPointGet, t.XISahCstPointUse, t.XVUsrCode, t.XVLghLogCode
          FROM TTmpTSalHD001 t
          WHERE NOT EXISTS (
            SELECT 1 FROM TPosTSalHD m WHERE m.XVSahDocNo = t.XVSahDocNo
          )
        ) x
        WHERE 1=1
        {sales_filter}
        ORDER BY XTSahSalDate
        """,
        tuple(sales_params) if sales_params else None,
    )

    doc_nos = [s(h["XVSahDocNo"]) for h in headers if s(h["XVSahDocNo"])]
    print(f"  sale headers: {len(doc_nos)}")

    shift_logs = ms.q(
        """
        SELECT
          XVLghLogCode, XVUsrCode, XDLghBusDate,
          XTLghLoginDate, XTLghLogOutDate,
          XILghSalCnt, XFLghSalNetAmt,
          XFLghMonOnHand, XFLghRcvCash
        FROM TPosTLogHD
        ORDER BY XTLghLoginDate
        """
    )
    print(f"  shift logs: {len(shift_logs)}")

    lines: list[dict[str, Any]] = []
    pays: list[dict[str, Any]] = []
    for batch in chunks(doc_nos, 400):
        ph = ",".join(["%s"] * len(batch))
        lines.extend(
            ms.q(
                f"""
                SELECT XVSahDocNo, XISadSeq, XVBarCode, XVSkuCode, XVSadDesc,
                       XVSadSunName, XFSadQty, XFSadSalPrice, XFSadDis, XFSadNet
                FROM TPosTSalDT
                WHERE XVSahDocNo IN ({ph})
                UNION ALL
                SELECT d.XVSahDocNo, d.XISadSeq, d.XVBarCode, d.XVSkuCode, d.XVSadDesc,
                       d.XVSadSunName, d.XFSadQty, d.XFSadSalPrice, d.XFSadDis, d.XFSadNet
                FROM TTmpTSalDT001 d
                WHERE d.XVSahDocNo IN ({ph})
                  AND NOT EXISTS (
                    SELECT 1 FROM TPosTSalHD m WHERE m.XVSahDocNo = d.XVSahDocNo
                  )
                """,
                tuple(batch) + tuple(batch),
            )
        )
        pays.extend(
            ms.q(
                f"""
                SELECT XVSahDocNo, XISarSeq, XVSarStaRcvType,
                       XFSarRcvAmt, XFSarChgAmt, XFSarNetAmt
                FROM TPosTSalRC
                WHERE XVSahDocNo IN ({ph})
                UNION ALL
                SELECT r.XVSahDocNo, r.XISarSeq, r.XVSarStaRcvType,
                       r.XFSarRcvAmt, r.XFSarChgAmt, r.XFSarNetAmt
                FROM TTmpTSalRC001 r
                WHERE r.XVSahDocNo IN ({ph})
                  AND NOT EXISTS (
                    SELECT 1 FROM TPosTSalHD m WHERE m.XVSahDocNo = r.XVSahDocNo
                  )
                """,
                tuple(batch) + tuple(batch),
            )
        )

    return {
        "sold_real": sold_real,
        "sold_price": sold_price,
        "units": units,
        "products": products,
        "customers": customers,
        "staff": staff,
        "headers": headers,
        "lines": lines,
        "pays": pays,
        "shift_logs": shift_logs,
        "quick_count": len(quick_by_bar),
    }


# ---------------------------------------------------------------------------
# Postgres write
# ---------------------------------------------------------------------------


def clear_branch_sales(cur, branch_id: str, branch_code: str) -> None:
    print("  clearing existing sales for branch…")
    cur.execute(
        """
        DELETE FROM sale_payments
        WHERE sale_id IN (SELECT id FROM sales WHERE branch_id = %s)
        """,
        (branch_id,),
    )
    cur.execute(
        """
        DELETE FROM sale_lines
        WHERE sale_id IN (SELECT id FROM sales WHERE branch_id = %s)
        """,
        (branch_id,),
    )
    cur.execute(
        """
        DELETE FROM point_ledger
        WHERE sale_id IN (SELECT id FROM sales WHERE branch_id = %s)
        """,
        (branch_id,),
    )
    cur.execute("DELETE FROM sales WHERE branch_id = %s", (branch_id,))
    # รอบจากระบบเก่า (id = shift-{branch}-{logCode})
    cur.execute(
        "DELETE FROM shifts WHERE branch_id = %s AND id LIKE %s",
        (branch_id, f"shift-{branch_code}-%"),
    )
    print(f"    deleted sales+shifts for branch {branch_code}")


def build_staff_by_legacy(
    staff: list[dict[str, Any]],
    branch_code: str,
) -> dict[str, dict[str, str]]:
    """Map XVUsrCode (เช่น ap) → staff id/code/name ของสาขา (เช่น 002-ap)."""
    out: dict[str, dict[str, str]] = {}
    prefix = f"{branch_code}-"
    for st in staff:
        code = s(st.get("code"))
        if not code:
            continue
        legacy = s(st.get("legacy_code"))
        if not legacy and code.startswith(prefix):
            legacy = code[len(prefix) :]
        if not legacy:
            legacy = code
        out[legacy.lower()] = {
            "id": s(st.get("id")) or f"staff-{code}",
            "code": code,
            "name": s(st.get("name")) or code,
        }
    return out


def load_staff_by_legacy_from_pg(cur, branch_code: str) -> dict[str, dict[str, str]]:
    """โหลดพนักงานจาก Postgres เมื่อ migrate sales-only (ไม่ได้ดึง staff จากระบบเก่า)."""
    prefix = f"{branch_code}-"
    cur.execute(
        """
        SELECT id, code, name FROM staff
        WHERE deleted_at IS NULL
          AND (code LIKE %s OR id LIKE %s)
        """,
        (f"{prefix}%", f"staff-{prefix}%"),
    )
    rows = [
        {"id": r[0], "code": r[1], "name": r[2], "legacy_code": None}
        for r in cur.fetchall()
    ]
    return build_staff_by_legacy(rows, branch_code)


def insert_shift_logs(
    cur,
    tgt: TargetConfig,
    shift_logs: list[dict[str, Any]],
    branch_id: str,
    terminal_id: str,
    ts: datetime,
    staff_by_legacy: dict[str, dict[str, str]] | None = None,
) -> dict[str, str]:
    """Import TPosTLogHD → shifts; return map logCode → shift id"""
    mapping: dict[str, str] = {}
    staff_by_legacy = staff_by_legacy or {}
    if not shift_logs:
        return mapping
    print(f"  inserting shifts… ({len(shift_logs)})")
    for log in shift_logs:
        code = s(log.get("XVLghLogCode"))
        if not code:
            continue
        sid = shift_pg_id(tgt.branch_code, code)
        mapping[code] = sid
        opened = as_dt(log.get("XTLghLoginDate")) or as_dt(log.get("XDLghBusDate")) or ts
        closed = as_dt(log.get("XTLghLogOutDate"))
        status = "closed" if closed else "open"
        legacy_usr = s(log.get("XVUsrCode"))
        st = staff_by_legacy.get(legacy_usr.lower()) if legacy_usr else None
        if st:
            staff_id = st["id"]
            staff_code = st["code"]
            staff_name = st["name"]
        elif legacy_usr:
            staff_id = f"staff-{tgt.branch_code}-{legacy_usr}"
            staff_code = f"{tgt.branch_code}-{legacy_usr}"
            staff_name = legacy_usr
        else:
            staff_id = None
            staff_code = None
            staff_name = "ระบบเก่า"
        bill_count = max(0, i(log.get("XILghSalCnt")))
        gross = money(log.get("XFLghSalNetAmt"))
        open_cash = money(log.get("XFLghMonOnHand"))  # snapshot; best available
        cur.execute(
            """
            INSERT INTO shifts (
              id, branch_id, terminal_id, staff_id, staff_code, staff_name,
              opened_at, closed_at, open_cash, close_cash, expected_cash, variance,
              status, bill_count, gross_total, close_note,
              summary_json, cash_moves_json, cash_counts_json, updated_at
            ) VALUES (
              %s,%s,%s,%s,%s,%s,
              %s,%s,%s,NULL,NULL,NULL,
              %s,%s,%s,%s,
              NULL,NULL,NULL,%s
            )
            ON CONFLICT (id) DO UPDATE SET
              opened_at = EXCLUDED.opened_at,
              closed_at = EXCLUDED.closed_at,
              status = EXCLUDED.status,
              bill_count = EXCLUDED.bill_count,
              gross_total = EXCLUDED.gross_total,
              staff_id = EXCLUDED.staff_id,
              staff_code = EXCLUDED.staff_code,
              staff_name = EXCLUDED.staff_name,
              updated_at = EXCLUDED.updated_at
            """,
            (
                sid,
                branch_id,
                terminal_id,
                staff_id,
                staff_code,
                staff_name,
                opened,
                closed,
                open_cash,
                status,
                bill_count,
                gross,
                f"รอบขาย {code}",
                ts,
            ),
        )
    return mapping


def insert_sales_block(
    cur,
    tgt: TargetConfig,
    headers: list[dict[str, Any]],
    lines: list[dict[str, Any]],
    pays: list[dict[str, Any]],
    branch_id: str,
    terminal_id: str,
    ts: datetime,
    shift_by_log: dict[str, str] | None = None,
) -> None:
    cust_by_code: dict[str, str] = {}
    cur.execute("SELECT id, code FROM customers WHERE deleted_at IS NULL")
    for cid, code in cur.fetchall():
        if code:
            cust_by_code[str(code)] = cid
    shift_by_log = shift_by_log or {}

    print("  inserting sales…")
    for h in headers:
        doc = s(h["XVSahDocNo"])
        if not doc:
            continue
        sale_id = f"sale-{tgt.branch_code}-{doc}"
        status = "completed" if s(h["XVSahDocStatus"]) == "1" else "voided"
        cst_code = s(h["XVCstCode"])
        if cst_code in ("", "0"):
            cst_code = ""
        customer_id = cust_by_code.get(cst_code) if cst_code else None
        if not customer_id and cst_code:
            customer_id = cust_by_code.get(f"{tgt.branch_code}-{cst_code}")
        created = as_dt(h["XTSahSalDate"]) or as_dt(h["XDSahDocDate"]) or ts
        log_code = s(h.get("XVLghLogCode"))
        shift_id = shift_by_log.get(log_code) if log_code else None
        if log_code and not shift_id:
            # สร้าง shift stub ถ้าไม่มีใน LogHD
            shift_id = shift_pg_id(tgt.branch_code, log_code)
            shift_by_log[log_code] = shift_id
            cur.execute(
                """
                INSERT INTO shifts (
                  id, branch_id, terminal_id, staff_id, staff_code, staff_name,
                  opened_at, closed_at, open_cash, close_cash, expected_cash, variance,
                  status, bill_count, gross_total, close_note,
                  summary_json, cash_moves_json, cash_counts_json, updated_at
                ) VALUES (
                  %s,%s,%s,NULL,NULL,'ระบบเก่า',
                  %s,NULL,0,NULL,NULL,NULL,
                  'closed',0,0,%s,
                  NULL,NULL,NULL,%s
                )
                ON CONFLICT (id) DO NOTHING
                """,
                (shift_id, branch_id, terminal_id, created, f"รอบขาย {log_code}", ts),
            )
        subtotal = money(h["XFSahTotal"])
        discount = money(h["XFSahDis"])
        total = money(h["XFSahGrand"])
        change = money(h["XFSahChange"])
        pts_in = max(0, i(h["XISahCstPointGet"]))
        pts_out = max(0, i(h["XISahCstPointUse"]))

        cur.execute(
            """
            INSERT INTO sales (
              id, bill_no, branch_id, terminal_id, shift_id,
              customer_id, customer_name,
              subtotal, discount, points_redeemed, points_earned,
              total, paid, change, status, created_at, synced_at
            ) VALUES (
              %s,%s,%s,%s,%s,
              %s,%s,
              %s,%s,%s,%s,
              %s,%s,%s,%s,%s,%s
            )
            ON CONFLICT (id) DO UPDATE SET
              shift_id = EXCLUDED.shift_id,
              customer_id = EXCLUDED.customer_id,
              customer_name = EXCLUDED.customer_name,
              subtotal = EXCLUDED.subtotal,
              discount = EXCLUDED.discount,
              points_redeemed = EXCLUDED.points_redeemed,
              points_earned = EXCLUDED.points_earned,
              total = EXCLUDED.total,
              paid = EXCLUDED.paid,
              change = EXCLUDED.change,
              status = EXCLUDED.status,
              created_at = EXCLUDED.created_at,
              synced_at = EXCLUDED.synced_at
            """,
            (
                sale_id,
                doc,
                branch_id,
                terminal_id,
                shift_id,
                customer_id,
                s(h["XVSahCstName"]) or None,
                subtotal,
                discount,
                pts_out,
                pts_in,
                total,
                total + change,
                change,
                status,
                created,
                ts,
            ),
        )

        if pts_in and customer_id:
            cur.execute(
                """
                INSERT INTO point_ledger (
                  id, customer_id, sale_id, delta, reason, branch_id, created_at
                ) VALUES (%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
                """,
                (
                    f"pt-earn-{tgt.branch_code}-{doc}",
                    customer_id,
                    sale_id,
                    pts_in,
                    "migrate sale earn",
                    branch_id,
                    created,
                ),
            )
        if pts_out and customer_id:
            cur.execute(
                """
                INSERT INTO point_ledger (
                  id, customer_id, sale_id, delta, reason, branch_id, created_at
                ) VALUES (%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
                """,
                (
                    f"pt-use-{tgt.branch_code}-{doc}",
                    customer_id,
                    sale_id,
                    -pts_out,
                    "migrate sale redeem",
                    branch_id,
                    created,
                ),
            )

    print("  inserting sale lines…")
    for ln in lines:
        doc = s(ln["XVSahDocNo"])
        seq = i(ln["XISadSeq"])
        line_id = f"sl-{tgt.branch_code}-{doc}-{seq}"
        sale_id = f"sale-{tgt.branch_code}-{doc}"
        bar = s(ln["XVBarCode"]) or "UNKNOWN"
        cur.execute(
            """
            INSERT INTO sale_lines (
              id, sale_id, barcode, product_code, name, qty, unit,
              unit_price, discount, line_total
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name,
              qty = EXCLUDED.qty,
              unit_price = EXCLUDED.unit_price,
              discount = EXCLUDED.discount,
              line_total = EXCLUDED.line_total
            """,
            (
                line_id,
                sale_id,
                bar,
                s(ln["XVSkuCode"]) or None,
                s(ln["XVSadDesc"]) or bar,
                money(ln["XFSadQty"]),
                s(ln["XVSadSunName"]) or "ชิ้น",
                money(ln["XFSadSalPrice"]),
                money(ln["XFSadDis"]),
                money(ln["XFSadNet"]),
            ),
        )

    print("  inserting sale payments…")
    for pay in pays:
        doc = s(pay["XVSahDocNo"])
        seq = i(pay["XISarSeq"])
        pay_id = f"sp-{tgt.branch_code}-{doc}-{seq}"
        sale_id = f"sale-{tgt.branch_code}-{doc}"
        method = pay_method(s(pay["XVSarStaRcvType"]))
        amount = money(
            pay["XFSarNetAmt"]
            if pay.get("XFSarNetAmt") is not None
            else pay["XFSarRcvAmt"]
        )
        tendered = money(pay["XFSarRcvAmt"])
        # ระบบเรา: แต้ม = ส่วนลดท้ายบิล ไม่ใช่วิธีชำระ
        if method == "points":
            cur.execute(
                """
                UPDATE sales SET
                  discount = discount + %s,
                  total = GREATEST(0, total - %s),
                  paid = GREATEST(0, paid - %s)
                WHERE id = %s
                """,
                (amount, amount, amount, sale_id),
            )
            continue
        cur.execute(
            """
            INSERT INTO sale_payments (
              id, sale_id, method, amount, tendered
            ) VALUES (%s,%s,%s,%s,%s)
            ON CONFLICT (id) DO UPDATE SET
              method = EXCLUDED.method,
              amount = EXCLUDED.amount,
              tendered = EXCLUDED.tendered
            """,
            (pay_id, sale_id, method, amount, tendered),
        )


def upsert_postgres(data: dict[str, Any], tgt: TargetConfig) -> None:
    mode = "APPLY" if tgt.apply else "DRY-RUN"
    scope = "sales-only" if tgt.sales_only else "full"
    print(f"→ Postgres {mode} ({scope}): {tgt.database_url.split('@')[-1]}")

    units: list[str] = data["units"]
    products: list[dict[str, Any]] = data["products"]
    customers: list[dict[str, Any]] = data["customers"]
    staff: list[dict[str, Any]] = data["staff"]
    headers: list[dict[str, Any]] = data["headers"]
    lines: list[dict[str, Any]] = data["lines"]
    pays: list[dict[str, Any]] = data["pays"]
    shift_logs: list[dict[str, Any]] = data.get("shift_logs") or []

    summary = {
        "branch": f"{tgt.branch_code} {tgt.branch_name}",
        "mode": scope,
        "sales": len(headers),
        "sale_lines": len(lines),
        "sale_payments": len(pays),
        "shifts": len(shift_logs),
    }
    if not tgt.sales_only:
        summary.update(
            {
                "units": len(units),
                "products": len(products),
                "customers": len(customers),
                "staff": len(staff),
                "sold_price_barcodes_skipped": len(data["sold_price"]),
                "quick_bars_in_source": data["quick_count"],
                "points_total": sum(c["points"] for c in customers),
            }
        )
    print("  plan:")
    for k, v in summary.items():
        print(f"    {k}: {v}")

    if not tgt.apply:
        print("  dry-run only — no writes. Re-run with --apply to commit.")
        return

    ts = now_utc()
    term_code = f"{tgt.branch_code}-{tgt.terminal_code}"
    with psycopg.connect(tgt.database_url) as pg:
        with pg.cursor() as cur:
            if tgt.sales_only:
                cur.execute(
                    "SELECT id FROM branches WHERE code = %s", (tgt.branch_code,)
                )
                brow = cur.fetchone()
                if not brow:
                    raise SystemExit(
                        f"ไม่พบสาขา code={tgt.branch_code} ใน Postgres — สร้างสาขาก่อน"
                    )
                branch_id = brow[0]

                cur.execute("SELECT id FROM terminals WHERE code = %s", (term_code,))
                trow = cur.fetchone()
                if trow:
                    terminal_id = trow[0]
                else:
                    cur.execute(
                        """
                        SELECT id FROM terminals
                        WHERE branch_id = %s AND deleted_at IS NULL
                        ORDER BY code LIMIT 1
                        """,
                        (branch_id,),
                    )
                    any_term = cur.fetchone()
                    if any_term:
                        terminal_id = any_term[0]
                    else:
                        cur.execute(
                            """
                            INSERT INTO terminals (
                              id, code, name, branch_id, active, last_seen_at, updated_at, deleted_at
                            ) VALUES (%s, %s, %s, %s, 1, NULL, %s, NULL)
                            ON CONFLICT (code) DO UPDATE SET updated_at = EXCLUDED.updated_at
                            RETURNING id
                            """,
                            (
                                tgt.terminal_id,
                                term_code,
                                tgt.terminal_name,
                                branch_id,
                                ts,
                            ),
                        )
                        terminal_id = cur.fetchone()[0]

                clear_branch_sales(cur, branch_id, tgt.branch_code)
                staff_by_legacy = build_staff_by_legacy(staff, tgt.branch_code)
                if not staff_by_legacy:
                    staff_by_legacy = load_staff_by_legacy_from_pg(
                        cur, tgt.branch_code
                    )
                shift_by_log = insert_shift_logs(
                    cur,
                    tgt,
                    shift_logs,
                    branch_id,
                    terminal_id,
                    ts,
                    staff_by_legacy,
                )
                insert_sales_block(
                    cur,
                    tgt,
                    headers,
                    lines,
                    pays,
                    branch_id,
                    terminal_id,
                    ts,
                    shift_by_log,
                )
            else:
                cur.execute(
                    """
                    INSERT INTO branches (id, code, name, active, created_at, updated_at, deleted_at)
                    VALUES (%s, %s, %s, 1, %s, %s, NULL)
                    ON CONFLICT (code) DO UPDATE SET
                      name = EXCLUDED.name,
                      active = 1,
                      updated_at = EXCLUDED.updated_at,
                      deleted_at = NULL
                    """,
                    (tgt.branch_id, tgt.branch_code, tgt.branch_name, ts, ts),
                )
                cur.execute(
                    "SELECT id FROM branches WHERE code = %s", (tgt.branch_code,)
                )
                branch_id = cur.fetchone()[0]

                cur.execute(
                    """
                    INSERT INTO terminals (
                      id, code, name, branch_id, active, last_seen_at, updated_at, deleted_at
                    ) VALUES (%s, %s, %s, %s, 1, NULL, %s, NULL)
                    ON CONFLICT (code) DO UPDATE SET
                      name = EXCLUDED.name,
                      branch_id = EXCLUDED.branch_id,
                      active = 1,
                      updated_at = EXCLUDED.updated_at,
                      deleted_at = NULL
                    """,
                    (
                        tgt.terminal_id,
                        term_code,
                        tgt.terminal_name,
                        branch_id,
                        ts,
                    ),
                )
                cur.execute("SELECT id FROM terminals WHERE code = %s", (term_code,))
                terminal_id = cur.fetchone()[0]

                for name in units:
                    uid = f"unit-{name}"
                    cur.execute(
                        """
                        INSERT INTO product_units (id, name, updated_at, deleted_at)
                        VALUES (%s, %s, %s, NULL)
                        ON CONFLICT (name) DO UPDATE SET
                          updated_at = EXCLUDED.updated_at,
                          deleted_at = NULL
                        """,
                        (uid, name, ts),
                    )

                for p in products:
                    pid = p.get("id") or f"prod-{tgt.branch_code}-{p['barcode']}"
                    cur.execute(
                        """
                        INSERT INTO products (
                          id, barcode, product_code, name, unit, price,
                          is_quick, quick_sort, image_url, is_open_price, open_price_max,
                          updated_at, deleted_at
                        ) VALUES (
                          %s,%s,%s,%s,%s,%s,%s,%s,NULL,%s,%s,%s,NULL
                        )
                        ON CONFLICT (id) DO UPDATE SET
                          barcode = EXCLUDED.barcode,
                          product_code = EXCLUDED.product_code,
                          name = EXCLUDED.name,
                          unit = EXCLUDED.unit,
                          price = EXCLUDED.price,
                          is_quick = EXCLUDED.is_quick,
                          quick_sort = EXCLUDED.quick_sort,
                          is_open_price = EXCLUDED.is_open_price,
                          open_price_max = EXCLUDED.open_price_max,
                          updated_at = EXCLUDED.updated_at,
                          deleted_at = NULL
                        """,
                        (
                            pid,
                            p["barcode"],
                            p.get("product_code"),
                            p["name"],
                            p["unit"],
                            p.get("price"),
                            p.get("is_quick", 0),
                            p.get("quick_sort", 0),
                            p.get("is_open_price", 0),
                            p.get("open_price_max", Decimal("100")),
                            ts,
                        ),
                    )

                for c in customers:
                    cid = f"cust-{tgt.branch_code}-{c['code']}"
                    cur.execute(
                        """
                        INSERT INTO customers (
                          id, code, name, phone, points, updated_at, deleted_at
                        ) VALUES (%s,%s,%s,%s,%s,%s,NULL)
                        ON CONFLICT (id) DO UPDATE SET
                          name = EXCLUDED.name,
                          phone = EXCLUDED.phone,
                          points = EXCLUDED.points,
                          updated_at = EXCLUDED.updated_at,
                          deleted_at = NULL
                        """,
                        (cid, c["code"], c["name"], c["phone"], c["points"], ts),
                    )
                    if c["points"]:
                        cur.execute(
                            """
                            INSERT INTO point_ledger (
                              id, customer_id, sale_id, delta, reason, branch_id, created_at
                            ) VALUES (%s,%s,NULL,%s,%s,%s,%s)
                            ON CONFLICT (id) DO NOTHING
                            """,
                            (
                                f"pt-open-{tgt.branch_code}-{c['code']}",
                                cid,
                                c["points"],
                                "migrate opening points",
                                branch_id,
                                ts,
                            ),
                        )

                for st in staff:
                    sid = f"staff-{st['code']}"
                    cur.execute(
                        """
                        INSERT INTO staff (
                          id, code, name, pin, phone, role, active,
                          commission_enabled, commission_start_sales,
                          commission_step_sales, commission_per_step,
                          monthly_wage,
                          updated_at, deleted_at
                        ) VALUES (
                          %s,%s,%s,%s,NULL,%s,1,0,8000,1000,100,0,%s,NULL
                        )
                        ON CONFLICT (code) DO UPDATE SET
                          name = EXCLUDED.name,
                          active = 1,
                          updated_at = EXCLUDED.updated_at,
                          deleted_at = NULL
                        """,
                        (sid, st["code"], st["name"], st["pin"], st["role"], ts),
                    )

                staff_by_legacy = build_staff_by_legacy(
                    [
                        {
                            **st,
                            "id": f"staff-{st['code']}",
                        }
                        for st in staff
                    ],
                    tgt.branch_code,
                )
                shift_by_log = insert_shift_logs(
                    cur,
                    tgt,
                    shift_logs,
                    branch_id,
                    terminal_id,
                    ts,
                    staff_by_legacy,
                )
                insert_sales_block(
                    cur,
                    tgt,
                    headers,
                    lines,
                    pays,
                    branch_id,
                    terminal_id,
                    ts,
                    shift_by_log,
                )

        pg.commit()
        print("✓ committed to Postgres")
        if staff and not tgt.sales_only:
            print("  staff PIN ที่สร้างใหม่:")
            for st in staff:
                print(f"    {st['code']} / {st['name']} → PIN {st['pin']}")


def main() -> None:
    src, tgt = parse_args()
    print(
        f"Source: {src.user}@{src.host}:{src.port}/{src.database} (READ-ONLY)"
    )
    print(
        f"Target branch: {tgt.branch_code} {tgt.branch_name} · "
        f"apply={tgt.apply} · sales_only={tgt.sales_only}"
    )
    ms = MsReader(src)
    try:
        data = fetch_all(ms, tgt)
    finally:
        ms.close()
    upsert_postgres(data, tgt)


if __name__ == "__main__":
    main()
