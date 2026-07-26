import type { CartLine } from "./cart";

export type BundlePromo = {
  id: string;
  productCode: string;
  /** Buy this many units */
  buyQty: number;
  /** Pay this amount for each full bundle */
  payAmount: number;
  label: string;
};

export type AppliedPromo = {
  promoId: string;
  label: string;
  productCode: string;
  bundles: number;
  discount: number;
};

export type PromoResult = {
  /** Discount to apply at bill level from promos */
  promoDiscount: number;
  applied: AppliedPromo[];
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Example: unit 35, buy 3 pay 100 → each bundle saves (3*35 - 100) = 5
 */
export function applyBundlePromos(
  lines: CartLine[],
  promos: BundlePromo[],
): PromoResult {
  const applied: AppliedPromo[] = [];
  let promoDiscount = 0;

  for (const promo of promos) {
    const matched = lines.filter((l) => l.productCode === promo.productCode);
    if (!matched.length) continue;

    const qty = matched.reduce((s, l) => s + l.qty, 0);
    const unitPrice =
      matched.reduce((s, l) => s + l.unitPrice * l.qty, 0) / qty;
    const bundles = Math.floor(qty / promo.buyQty);
    if (bundles <= 0) continue;

    const normalForBundles = bundles * promo.buyQty * unitPrice;
    const payForBundles = bundles * promo.payAmount;
    const discount = round2(Math.max(0, normalForBundles - payForBundles));
    if (discount <= 0) continue;

    promoDiscount = round2(promoDiscount + discount);
    applied.push({
      promoId: promo.id,
      label: promo.label,
      productCode: promo.productCode,
      bundles,
      discount,
    });
  }

  return { promoDiscount, applied };
}
