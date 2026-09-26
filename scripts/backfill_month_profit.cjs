#!/usr/bin/env node
/**
 * เติมกำไรบิลเก่าจากทุน/ราคาขายล่าสุดใน products
 * Usage: node backfill_month_profit.mjs 2026-08
 * Needs DATABASE_URL and node_modules/pg (run from apps/api).
 */
const { Client } = require("pg");

const OPEN_PRICE_MARGIN = 0.15;
const ESTIMATED_MARGIN_BY_FRESH_CODE = { "900011": 0.2 };
const FRESH_SKIP = new Set(["900011", "900017"]);

function round2(n) {
  return Math.round(n * 100) / 100;
}

function freshProductCode(barcode, productCode) {
  const b = String(barcode || "").trim();
  if (/^9\d{12}$/.test(b)) return b.slice(1, 7);
  const code = String(productCode || "").trim();
  if (/^9\d{5}$/.test(code)) return code;
  if (/^9\d{5}$/.test(b)) return b;
  return null;
}

function prefer(a, b) {
  if (a.deleted !== b.deleted) return a.deleted ? b : a;
  if (a.active !== b.active) return a.active ? a : b;
  return a.updatedAt >= b.updatedAt ? a : b;
}

function isOpenPrice(line, hit) {
  if (hit?.isOpenPrice) return true;
  const code = String(line.productCode || "").trim().toUpperCase();
  if (code === "OPENPRICE" || code === "SKU-00000128") return true;
  if (/เบ็ดเตล็ด/.test(String(line.name || ""))) return true;
  if (String(line.barcode || "").trim().toUpperCase().startsWith("OPENPRICE"))
    return true;
  return false;
}

function estimatedMargin(line, hit) {
  if (isOpenPrice(line, hit)) return OPEN_PRICE_MARGIN;
  const fresh = freshProductCode(line.barcode, line.productCode);
  if (fresh && ESTIMATED_MARGIN_BY_FRESH_CODE[fresh] != null) {
    return ESTIMATED_MARGIN_BY_FRESH_CODE[fresh];
  }
  const b = String(hit?.barcode || line.barcode || "").trim();
  if (/^9\d{5}$/.test(b) && ESTIMATED_MARGIN_BY_FRESH_CODE[b] != null) {
    return ESTIMATED_MARGIN_BY_FRESH_CODE[b];
  }
  return null;
}

function allocateNet(totals, billDiscount) {
  const gross = totals.reduce((s, n) => s + n, 0);
  const discount = Math.min(Math.max(0, billDiscount), Math.max(0, gross));
  const target = round2(gross - discount);
  if (!totals.length) return [];
  let assigned = 0;
  return totals.map((total, i) => {
    if (i === totals.length - 1) return round2(target - assigned);
    const net = gross > 0 ? round2((total * (gross - discount)) / gross) : 0;
    assigned = round2(assigned + net);
    return net;
  });
}

function pricePerKg(line, byBarcode, byCode) {
  const code = freshProductCode(line.barcode, line.productCode);
  if (!code || FRESH_SKIP.has(code)) return null;
  let hit = byBarcode.get(code);
  const pc = String(line.productCode || "").trim();
  if (!hit && pc) hit = byCode.get(pc);
  const price = hit?.sellPrice;
  if (price == null || !(price > 0)) return null;
  return round2(price);
}

function findHit(line, byBarcode, byCode) {
  const b = String(line.barcode || "").trim();
  const pc = String(line.productCode || "").trim();
  const fresh = freshProductCode(b, pc);
  // ยึดบาร์/PLU ก่อน SKU (บิลเก่าหมูแดดติด SKU ผิด)
  if (b && byBarcode.has(b)) return byBarcode.get(b);
  if (fresh && byBarcode.has(fresh)) return byBarcode.get(fresh);
  if (pc && byCode.has(pc)) return byCode.get(pc);
  return null;
}

function costBasis(line, net, ppk) {
  if (ppk != null && ppk > 0 && net > 0) return net / ppk;
  return Number(line.qty) || 0;
}

function priceBill(lines, discount, byBarcode, byCode) {
  const nets = allocateNet(
    lines.map((l) => Number(l.lineTotal) || 0),
    discount,
  );
  const out = lines.map((line, i) => {
    const netRevenue = nets[i] ?? 0;
    const hit = findHit(line, byBarcode, byCode);
    const qty = Number(line.qty) || 0;
    const ppk = pricePerKg(line, byBarcode, byCode);
    const margin = estimatedMargin(line, hit);
    if (margin != null) {
      const lineProfit = round2(netRevenue * margin);
      const lineCost = round2(netRevenue - lineProfit);
      return {
        id: line.id,
        costStatus: "estimated",
        unitCost: qty > 0 ? round2(lineCost / qty) : null,
        lineCost,
        lineProfit,
        netRevenue,
        pricePerKg: ppk,
      };
    }
    if (hit?.costPrice != null && Number.isFinite(hit.costPrice)) {
      const unitCost = round2(hit.costPrice);
      const basis = costBasis(line, netRevenue, ppk);
      const lineCost = round2(unitCost * basis);
      return {
        id: line.id,
        costStatus: "known",
        unitCost,
        lineCost,
        lineProfit: round2(netRevenue - lineCost),
        netRevenue,
        pricePerKg: ppk,
      };
    }
    return {
      id: line.id,
      costStatus: "missing",
      unitCost: null,
      lineCost: null,
      lineProfit: null,
      netRevenue,
      pricePerKg: ppk,
    };
  });

  let profit = 0;
  let costAmount = 0;
  let knownRevenue = 0;
  let missingRevenue = 0;
  let missingLineCount = 0;
  let estimatedProfit = 0;
  let estimatedRevenue = 0;
  for (const line of out) {
    if (line.costStatus === "missing") {
      missingRevenue += line.netRevenue;
      missingLineCount += 1;
      continue;
    }
    profit += line.lineProfit ?? 0;
    costAmount += line.lineCost ?? 0;
    if (line.costStatus === "estimated") {
      estimatedProfit += line.lineProfit ?? 0;
      estimatedRevenue += line.netRevenue;
    } else {
      knownRevenue += line.netRevenue;
    }
  }
  return {
    lines: out,
    profit: round2(profit),
    costAmount: round2(costAmount),
    knownRevenue: round2(knownRevenue),
    missingRevenue: round2(missingRevenue),
    missingLineCount,
    estimatedProfit: round2(estimatedProfit),
    estimatedRevenue: round2(estimatedRevenue),
  };
}

function monthBounds(ym) {
  const [y, m] = ym.split("-").map(Number);
  const start = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01T00:00:00+07:00`;
  const end =
    m === 12
      ? `${y + 1}-01-01T00:00:00+07:00`
      : `${y}-${String(m + 1).padStart(2, "0")}-01T00:00:00+07:00`;
  return { start, end };
}

async function main() {
  const ym = String(process.argv[2] || "").trim();
  if (!/^\d{4}-\d{2}$/.test(ym)) {
    console.error("usage: node backfill_month_profit.mjs YYYY-MM");
    process.exit(2);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL required");
    process.exit(2);
  }

  const { start, end } = monthBounds(ym);
  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    const products = await client.query(`
      SELECT barcode, product_code, cost_price, price, is_open_price,
             deleted_at is not null as deleted,
             coalesce(active, 1) <> 0 as active,
             extract(epoch from coalesce(updated_at, now()))::bigint as updated_at
      FROM products
    `);
    const byCode = new Map();
    const byBarcode = new Map();
    for (const r of products.rows) {
      const item = {
        barcode: String(r.barcode || "").trim(),
        productCode: r.product_code ? String(r.product_code).trim() : null,
        costPrice: r.cost_price == null ? null : Number(r.cost_price),
        sellPrice: r.price == null ? null : Number(r.price),
        isOpenPrice: Boolean(r.is_open_price),
        deleted: Boolean(r.deleted),
        active: Boolean(r.active),
        updatedAt: Number(r.updated_at || 0),
      };
      if (item.productCode) {
        const prev = byCode.get(item.productCode);
        byCode.set(item.productCode, prev ? prefer(prev, item) : item);
      }
      if (item.barcode) {
        const prev = byBarcode.get(item.barcode);
        byBarcode.set(item.barcode, prev ? prefer(prev, item) : item);
      }
    }

    const salesRes = await client.query(
      `
      SELECT id, coalesce(discount, 0) as discount
      FROM sales
      WHERE created_at >= $1::timestamptz
        AND created_at < $2::timestamptz
        AND profit is null
      ORDER BY created_at
      `,
      [start, end],
    );
    const sales = salesRes.rows;
    console.log(`month=${ym} pending_bills=${sales.length}`);

    let filled = 0;
    const batch = 80;
    for (let i = 0; i < sales.length; i += batch) {
      const chunk = sales.slice(i, i + batch);
      const ids = chunk.map((s) => s.id);
      const disc = new Map(chunk.map((s) => [s.id, Number(s.discount) || 0]));
      const linesRes = await client.query(
        `
        SELECT id, sale_id, barcode, product_code, name, qty, line_total, cost_status
        FROM sale_lines
        WHERE sale_id = ANY($1::text[])
        ORDER BY sale_id, id
        `,
        [ids],
      );
      const bySale = new Map();
      for (const r of linesRes.rows) {
        const list = bySale.get(r.sale_id) || [];
        list.push({
          id: r.id,
          saleId: r.sale_id,
          barcode: r.barcode || "",
          productCode: r.product_code,
          name: r.name,
          qty: Number(r.qty) || 0,
          lineTotal: Number(r.line_total) || 0,
          costStatus: r.cost_status,
        });
        bySale.set(r.sale_id, list);
      }

      await client.query("BEGIN");
      try {
        for (const saleId of ids) {
          const lines = bySale.get(saleId) || [];
          if (!lines.length) continue;
          const priced = priceBill(
            lines,
            disc.get(saleId) || 0,
            byBarcode,
            byCode,
          );
          const byId = new Map(priced.lines.map((l) => [l.id, l]));
          for (const line of lines) {
            const p = byId.get(line.id);
            if (!p) continue;
            const canWrite =
              line.costStatus == null || p.costStatus === "estimated";
            if (!canWrite) continue;
            await client.query(
              `
              UPDATE sale_lines SET
                net_revenue = $1,
                cost_status = $2,
                unit_cost = $3,
                line_cost = $4,
                line_profit = $5,
                price_per_kg = $6,
                kg_priced = 1
              WHERE id = $7
              `,
              [
                p.netRevenue,
                p.costStatus,
                p.unitCost,
                p.lineCost,
                p.lineProfit,
                p.pricePerKg,
                line.id,
              ],
            );
          }

          const refreshed = await client.query(
            `
            SELECT cost_status, net_revenue, line_total, line_profit, line_cost
            FROM sale_lines WHERE sale_id = $1
            `,
            [saleId],
          );
          let profit = 0;
          let costAmount = 0;
          let knownRevenue = 0;
          let missingRevenue = 0;
          let missingLineCount = 0;
          let estimatedProfit = 0;
          let estimatedRevenue = 0;
          for (const l of refreshed.rows) {
            const net =
              l.net_revenue == null
                ? Number(l.line_total)
                : Number(l.net_revenue);
            if (l.cost_status === "missing" || l.cost_status == null) {
              missingRevenue += net;
              missingLineCount += 1;
              continue;
            }
            profit += Number(l.line_profit || 0);
            costAmount += Number(l.line_cost || 0);
            if (l.cost_status === "estimated") {
              estimatedProfit += Number(l.line_profit || 0);
              estimatedRevenue += net;
            } else {
              knownRevenue += net;
            }
          }
          await client.query(
            `
            UPDATE sales SET
              profit = $1,
              cost_amount = $2,
              known_revenue = $3,
              missing_revenue = $4,
              missing_line_count = $5,
              estimated_profit = $6,
              estimated_revenue = $7
            WHERE id = $8
            `,
            [
              round2(profit),
              round2(costAmount),
              round2(knownRevenue),
              round2(missingRevenue),
              missingLineCount,
              round2(estimatedProfit),
              round2(estimatedRevenue),
              saleId,
            ],
          );
          filled += 1;
        }
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
      console.log(`  … ${Math.min(i + batch, sales.length)}/${sales.length} bills`);
    }

    const sum = await client.query(
      `
      SELECT
        count(*)::int as bills,
        round(sum(total::numeric), 2) as sales,
        round(sum(profit::numeric), 2) as profit,
        round(sum(cost_amount::numeric), 2) as cost,
        round(sum(missing_revenue::numeric), 2) as missing,
        round(sum(estimated_profit::numeric), 2) as est_profit,
        count(*) filter (where missing_line_count > 0)::int as bills_missing
      FROM sales
      WHERE created_at >= $1::timestamptz
        AND created_at < $2::timestamptz
        AND profit is not null
      `,
      [start, end],
    );
    const r = sum.rows[0];
    console.log(
      `done filled=${filled} bills=${r.bills} sales=${r.sales} profit=${r.profit} cost=${r.cost} missing_rev=${r.missing} est_profit=${r.est_profit} bills_with_missing=${r.bills_missing}`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
