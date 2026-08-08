import { Body, Controller, Get, Post, Req, UnauthorizedException } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { Public } from "./public.decorator";
import type { AuthedRequest } from "./auth.guard";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("login")
  login(@Body() body: { code?: string; password?: string }) {
    return this.auth.login(body.code ?? "", body.password ?? "");
  }

  @Get("me")
  me(@Req() req: AuthedRequest) {
    if (!req.user?.sub) throw new UnauthorizedException();
    return this.auth.me(req.user.sub);
  }
}
