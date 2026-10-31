import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { ALLOW_PURCHASE_ORDER_KEY } from "./purchase-order.decorator";
import { canAccessAdminApi } from "@ap-pos/shared";
import { verifyToken, type AuthTokenPayload } from "./auth.crypto";

export type AuthedRequest = {
  headers: { authorization?: string };
  method?: string;
  url?: string;
  originalUrl?: string;
  user?: AuthTokenPayload;
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const payload = token ? verifyToken(token) : null;
    if (!payload) throw new UnauthorizedException("กรุณาเข้าสู่ระบบ");
    req.user = payload;

    const allowPurchaseOrder = this.reflector.getAllAndOverride<boolean>(
      ALLOW_PURCHASE_ORDER_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (payload.scope === "purchase-order" && !allowPurchaseOrder) {
      throw new ForbiddenException("ไม่มีสิทธิ์เข้าส่วนนี้");
    }
    if (payload.scope !== "purchase-order") {
      const url = req.originalUrl || req.url || "";
      const method = req.method || "GET";
      if (!canAccessAdminApi(payload.role, payload.menus, method, url)) {
        throw new ForbiddenException("ไม่มีสิทธิ์เข้าเมนูนี้");
      }
    }
    return true;
  }
}
