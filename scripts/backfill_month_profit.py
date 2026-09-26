#!/usr/bin/env python3
"""เติมกำไรบิลเก่าจากทุน/ราคาขายล่าสุดใน products (ประมาณการคร่าวๆ).

Usage:
  DATABASE_URL=... python3 scripts/backfill_month_profit.py 2026-08
"""

from __future__ import annotations

import math
import os
import sys
from collections import defaultdict

import psycopg

OPEN_PRICE_MARGIN = 0.15
ESTIMATED_MARGIN_BY_FRESH_CODE = {"900011": 0.2}
FRESH_SKIP = {"900011", "900017"}
FRESH_BY_PIECE = {"900059"}


def round2(n: float) -> float:
    return round(n * 100) / 100


def fresh_product_code(barcode: str, product_code: str | None) -> str | None:
    b = (barcode or "").strip()
    if len(b) == 13 and b.startswith("9") and b.isdigit():
        return b[1:7]
    code = (product_code or "").strip()
    if len(code) == 6 and code.startswith("9") and code.isdigit():
        return code
    if len(b) == 6 and b.startswith("9") and b.isdigit():
        return b
    return None


def prefer(a: dict, b: dict) -> dict:
    if a["deleted"] != b["deleted"]:
        return b if a["deleted"] else a
    if a["active"] != b["active"]:
        return a if a["active"] else b
    return a if a["updated_at"] >= b["updated_at"] else b


def is_open_price(line: dict, hit: dict | None) -> bool:
    if hit and hit.get("is_open_price"):
        return True
    code = (line.get("product_code") or "").strip().upper()
    if code in ("OPENPRICE", "SKU-00000128"):
        return True
    if "เบ็ดเตล็ด" in (line.get("name") or ""):
        return True
    if (line.get("barcode") or "").strip().upper().startswith("OPENPRICE"):
        return True
    return False


def estimated_margin(line: dict, hit: dict | None) -> float | None:
    if is_open_price(line, hit):
        return OPEN_PRICE_MARGIN
    fresh = fresh_product_code(line.get("barcode") or "", line.get("product_code"))
    if fresh and fresh in ESTIMATED_MARGIN_BY_FRESH_CODE:
        return ESTIMATED_MARGIN_BY_FRESH_CODE[fresh]
    b = ((hit or {}).get("barcode") or line.get("barcode") or "").strip()
    if len(b) == 6 and b.startswith("9") and b in ESTIMATED_MARGIN_BY_FRESH_CODE:
        return ESTIMATED_MARGIN_BY_FRESH_CODE[b]
    return None


def allocate_net(totals: list[float], bill_discount: float) -> list[float]:
    gross = sum(totals)
    discount = min(max(0.0, bill_discount), max(0.0, gross))
    target = round2(gross - discount)
    if not totals:
        return []
    assigned = 0.0
    out: list[float] = []
    for i, total in enumerate(totals):
        if i == len(totals) - 1:
            out.append(round2(target - assigned))
        else:
            net = round2((total * (gross - discount)) / gross) if gross > 0 else 0.0
            assigned = round2(assigned + net)
            out.append(net)
    return out


def price_per_kg(line: dict, by_barcode: dict, by_code: dict) -> float | None:
    code = fresh_product_code(line.get("barcode") or "", line.get("product_code"))
    if not code or code in FRESH_SKIP:
        return None
    hit = by_barcode.get(code)
    pc = (line.get("product_code") or "").strip()
    if hit is None and pc:
        hit = by_code.get(pc)
    price = None if hit is None else hit.get("sell_price")
    if price is None or not (price > 0):
        return None
    return round2(float(price))


def find_hit(line: dict, by_barcode: dict, by_code: dict) -> dict | None:
    pc = (line.get("product_code") or "").strip()
    if pc and pc in by_code:
        return by_code[pc]
    b = (line.get("barcode") or "").strip()
    if b and b in by_barcode:
        return by_barcode[b]
    fresh = fresh_product_code(b, pc)
    if fresh and fresh in by_barcode:
        return by_barcode[fresh]
    return None


def cost_basis(line: dict, net: float, ppk: float | None) -> float:
    if ppk is not None and ppk > 0 and net > 0:
        return net / ppk
    return float(line.get("qty") or 0)


def price_bill(lines: list[dict], discount: float, by_barcode: dict, by_code: dict):
    nets = allocate_net([float(l["line_total"] or 0) for l in lines], discount)
    out = []
    for line, net in zip(lines, nets):
        hit = find_hit(line, by_barcode, by_code)
        qty = float(line.get("qty") or 0)
        ppk = price_per_kg(line, by_barcode, by_code)
        margin = estimated_margin(line, hit)
        if margin is not None:
            profit = round2(net * margin)
            cost = round2(net - profit)
            out.append(
                {
                    "id": line["id"],
                    "cost_status": "estimated",
                    "unit_cost": round2(cost / qty) if qty > 0 else None,
                    "line_cost": cost,
                    "line_profit": profit,
                    "net_revenue": net,
                    "price_per_kg": ppk,
                }
            )
            continue
        if hit is not None and hit.get("cost_price") is not None:
            unit = round2(float(hit["cost_price"]))
            basis = cost_basis(line, net, ppk)
            cost = round2(unit * basis)
            out.append(
                {
                    "id": line["id"],
                    "cost_status": "known",
                    "unit_cost": unit,
                    "line_cost": cost,
                    "line_profit": round2(net - cost),
                    "net_revenue": net,
                    "price_per_kg": ppk,
                }
            )
            continue
        out.append(
            {
                "id": line["id"],
                "cost_status": "missing",
                "unit_cost": None,
                "line_cost": None,
                "line_profit": None,
                "net_revenue": net,
                "price_per_kg": ppk,
            }
        )

    profit = cost_amount = known_rev = missing_rev = est_profit = est_rev = 0.0
    missing_n = 0
    for row in out:
        if row["cost_status"] == "missing":
            missing_rev += row["net_revenue"]
            missing_n += 1
            continue
        profit += row["line_profit"] or 0
        cost_amount += row["line_cost"] or 0
        if row["cost_status"] == "estimated":
            est_profit += row["line_profit"] or 0
            est_rev += row["net_revenue"]
        else:
            known_rev += row["net_revenue"]
    return {
        "lines": out,
        "profit": round2(profit),
        "cost_amount": round2(cost_amount),
        "known_revenue": round2(known_rev),
        "missing_revenue": round2(missing_rev),
        "missing_line_count": missing_n,
        "estimated_profit": round2(est_profit),
        "estimated_revenue": round2(est_rev),
    }


def month_bounds(ym: str) -> tuple[str, str]:
    y, m = map(int, ym.split("-"))
    start = f"{y:04d}-{m:02d}-01T00:00:00+07:00"
    if m == 12:
        end = f"{y + 1:04d}-01-01T00:00:00+07:00"
    else:
        end = f"{y:04d}-{m + 1:02d}-01T00:00:00+07:00"
    return start, end


def main() -> int:
    ym = (sys.argv[1] if len(sys.argv) > 1 else "").strip()
    if not (len(ym) == 7 and ym[4] == "-"):
        print("usage: backfill_month_profit.py YYYY-MM", file=sys.stderr)
        return 2
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL required", file=sys.stderr)
        return 2

    start, end = month_bounds(ym)
    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT barcode, product_code, cost_price, price, is_open_price,
                       deleted_at is not null as deleted, coalesce(active, true) as active,
                       extract(epoch from coalesce(updated_at, created_at))::bigint as updated_at
                FROM products
                """
            )
            by_code: dict[str, dict] = {}
            by_barcode: dict[str, dict] = {}
            for row in cur.fetchall():
                item = {
                    "barcode": (row[0] or "").strip(),
                    "product_code": (row[1] or "").strip() or None,
                    "cost_price": float(row[2]) if row[2] is not None else None,
                    "sell_price": float(row[3]) if row[3] is not None else None,
                    "is_open_price": bool(row[4]),
                    "deleted": bool(row[5]),
                    "active": bool(row[6]),
                    "updated_at": int(row[7] or 0),
                }
                if item["product_code"]:
                    prev = by_code.get(item["product_code"])
                    by_code[item["product_code"]] = (
                        prefer(prev, item) if prev else item
                    )
                if item["barcode"]:
                    prev = by_barcode.get(item["barcode"])
                    by_barcode[item["barcode"]] = (
                        prefer(prev, item) if prev else item
                    )

            cur.execute(
                """
                SELECT id, coalesce(discount, 0)
                FROM sales
                WHERE created_at >= %s::timestamptz
                  AND created_at < %s::timestamptz
                  AND profit is null
                ORDER BY created_at
                """,
                (start, end),
            )
            sales = cur.fetchall()
            print(f"month={ym} pending_bills={len(sales)}")

            filled = 0
            batch = 80
            for i in range(0, len(sales), batch):
                chunk = sales[i : i + batch]
                ids = [s[0] for s in chunk]
                disc = {s[0]: float(s[1] or 0) for s in chunk}
                cur.execute(
                    """
                    SELECT id, sale_id, barcode, product_code, name, qty, line_total, cost_status
                    FROM sale_lines
                    WHERE sale_id = ANY(%s)
                    ORDER BY sale_id, id
                    """,
                    (ids,),
                )
                by_sale: dict[str, list] = defaultdict(list)
                for r in cur.fetchall():
                    by_sale[r[1]].append(
                        {
                            "id": r[0],
                            "sale_id": r[1],
                            "barcode": r[2] or "",
                            "product_code": r[3],
                            "name": r[4],
                            "qty": float(r[5] or 0),
                            "line_total": float(r[6] or 0),
                            "cost_status": r[7],
                        }
                    )

                for sale_id in ids:
                    lines = by_sale.get(sale_id, [])
                    if not lines:
                        continue
                    # ทับเฉพาะที่ยังไม่คิด
                    if any(l["cost_status"] is not None for l in lines):
                        # ถ้าบางบรรทัดคิดแล้ว ให้คิดเฉพาะที่ null
                        pass
                    priced = price_bill(lines, disc[sale_id], by_barcode, by_code)
                    by_id = {p["id"]: p for p in priced["lines"]}
                    for line in lines:
                        p = by_id[line["id"]]
                        can_write = (
                            line["cost_status"] is None
                            or p["cost_status"] == "estimated"
                        )
                        if not can_write:
                            continue
                        cur.execute(
                            """
                            UPDATE sale_lines SET
                              net_revenue = %s,
                              cost_status = %s,
                              unit_cost = %s,
                              line_cost = %s,
                              line_profit = %s,
                              price_per_kg = %s,
                              kg_priced = 1
                            WHERE id = %s
                            """,
                            (
                                p["net_revenue"],
                                p["cost_status"],
                                p["unit_cost"],
                                p["line_cost"],
                                p["line_profit"],
                                p["price_per_kg"],
                                line["id"],
                            ),
                        )

                    # รวมยอดจากบรรทัดล่าสุด
                    cur.execute(
                        """
                        SELECT cost_status, net_revenue, line_total, line_profit, line_cost
                        FROM sale_lines WHERE sale_id = %s
                        """,
                        (sale_id,),
                    )
                    profit = cost_amount = known_rev = missing_rev = est_profit = est_rev = 0.0
                    missing_n = 0
                    for st, net_r, lt, lp, lc in cur.fetchall():
                        net = float(net_r if net_r is not None else lt or 0)
                        if st in (None, "missing"):
                            missing_rev += net
                            missing_n += 1
                            continue
                        profit += float(lp or 0)
                        cost_amount += float(lc or 0)
                        if st == "estimated":
                            est_profit += float(lp or 0)
                            est_rev += net
                        else:
                            known_rev += net
                    cur.execute(
                        """
                        UPDATE sales SET
                          profit = %s,
                          cost_amount = %s,
                          known_revenue = %s,
                          missing_revenue = %s,
                          missing_line_count = %s,
                          estimated_profit = %s,
                          estimated_revenue = %s
                        WHERE id = %s
                        """,
                        (
                            round2(profit),
                            round2(cost_amount),
                            round2(known_rev),
                            round2(missing_rev),
                            missing_n,
                            round2(est_profit),
                            round2(est_rev),
                            sale_id,
                        ),
                    )
                    filled += 1

                conn.commit()
                print(f"  … {min(i + batch, len(sales))}/{len(sales)} bills")

            cur.execute(
                """
                SELECT
                  count(*) as bills,
                  round(sum(total::numeric), 2) as sales,
                  round(sum(profit::numeric), 2) as profit,
                  round(sum(cost_amount::numeric), 2) as cost,
                  round(sum(missing_revenue::numeric), 2) as missing,
                  round(sum(estimated_profit::numeric), 2) as est_profit,
                  count(*) filter (where missing_line_count > 0) as bills_missing
                FROM sales
                WHERE created_at >= %s::timestamptz
                  AND created_at < %s::timestamptz
                  AND profit is not null
                """,
                (start, end),
            )
            row = cur.fetchone()
            print(
                f"done filled={filled} "
                f"bills={row[0]} sales={row[1]} profit={row[2]} "
                f"cost={row[3]} missing_rev={row[4]} est_profit={row[5]} "
                f"bills_with_missing={row[6]}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
