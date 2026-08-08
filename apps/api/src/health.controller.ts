import { Controller, Get } from "@nestjs/common";
import { Public } from "./auth/public.decorator";

@Public()
@Controller("health")
export class HealthController {
  @Get()
  ok() {
    return {
      ok: true,
      service: "ap-pos-api",
      time: new Date().toISOString(),
    };
  }
}
