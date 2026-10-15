import { SetMetadata } from "@nestjs/common";

/** อนุญาตโทเคน scope=purchase-order (PIN น้อง) */
export const ALLOW_PURCHASE_ORDER_KEY = "allowPurchaseOrder";
export const AllowPurchaseOrder = () =>
  SetMetadata(ALLOW_PURCHASE_ORDER_KEY, true);
