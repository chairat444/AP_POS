/**
 * Re-export จาก @ap-pos/shared — ให้ API กับ Admin ใช้ parser ชุดเดียวกัน
 */
export {
  PURCHASE_GROUPS,
  PURCHASE_DEFAULT_GROUP,
  PURCHASE_DAY_STATUSES,
  purchaseDayStatusLabel,
  isPurchaseDayStatus,
  parsePurchaseText,
  formatPurchaseLine,
  normalizePurchaseKey,
  purchaseKeysCompatible,
  type PurchaseGroupKey,
  type PurchaseDayStatus,
  type ParsedPurchaseLine,
} from "@ap-pos/shared";
