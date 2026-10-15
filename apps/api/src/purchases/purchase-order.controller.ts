import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import type { AuthedRequest } from "../auth/auth.guard";
import { Public } from "../auth/public.decorator";
import { AllowPurchaseOrder } from "../auth/purchase-order.decorator";
import { PurchasesService } from "./purchases.service";

@Controller("purchases/order")
export class PurchaseOrderController {
  constructor(
    private readonly purchases: PurchasesService,
    private readonly auth: AuthService,
  ) {}

  @Public()
  @Post("login")
  login(
    @Body() body: { pin?: string },
    @Req() req: { ip?: string; headers?: { "x-forwarded-for"?: string } },
  ) {
    const fwd = req.headers?.["x-forwarded-for"]?.split(",")[0]?.trim();
    const clientKey = fwd || req.ip || "anon";
    return this.auth.loginWithPin(body.pin ?? "", clientKey);
  }

  @AllowPurchaseOrder()
  @Get("meta")
  meta() {
    return this.purchases.orderBranches();
  }

  @AllowPurchaseOrder()
  @Get("items")
  items(@Query("branchId") branchId?: string) {
    return this.purchases.orderItemSuggestions(branchId ?? "");
  }

  @AllowPurchaseOrder()
  @Get("draft")
  draft(
    @Query("branchId") branchId?: string,
    @Query("day") day?: string,
  ) {
    return this.purchases.orderDraft(branchId ?? "", day);
  }

  @AllowPurchaseOrder()
  @Post("submit")
  submit(
    @Req() req: AuthedRequest,
    @Body()
    body: {
      branchId?: string;
      day?: string;
      items?: Array<{
        name: string;
        catalogId?: string | null;
        remaining?: number | string | null;
        spare?: boolean;
        empty?: boolean;
        order?: boolean;
        touched?: boolean;
      }>;
    },
  ) {
    return this.purchases.submitBranchOrder({
      branchId: body.branchId ?? "",
      day: body.day,
      staffName: req.user?.name,
      items: body.items ?? [],
    });
  }
}
