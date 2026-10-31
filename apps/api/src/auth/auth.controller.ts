import { Body, Controller, Get, Post, Req, UnauthorizedException } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { Public } from "./public.decorator";
import type { AuthedRequest } from "./auth.guard";

function clientIp(req: {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
}): string {
  const fwd = req.headers?.["x-forwarded-for"];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  return raw?.split(",")[0]?.trim() || req.ip || "anon";
}

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("login")
  login(
    @Body() body: { code?: string; password?: string },
    @Req()
    req: {
      ip?: string;
      headers?: Record<string, string | string[] | undefined>;
    },
  ) {
    return this.auth.login(body.code ?? "", body.password ?? "", clientIp(req));
  }

  @Get("me")
  me(@Req() req: AuthedRequest) {
    if (!req.user?.sub) throw new UnauthorizedException();
    return this.auth.me(req.user.sub);
  }
}
