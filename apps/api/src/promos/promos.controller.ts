import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import type { UpsertPromoDto } from "./promo.types";
import { PromosService } from "./promos.service";

@Controller("promos")
export class PromosController {
  constructor(private readonly promos: PromosService) {}

  @Get()
  list() {
    return this.promos.list();
  }

  /** nginx HTTPS มักบล็อก PATCH/DELETE → ใช้ POST แทน */
  @Post("update")
  updatePost(@Body() body: Partial<UpsertPromoDto> & { id?: string }) {
    const id = String(body?.id ?? "").trim();
    if (!id) throw new BadRequestException("ไม่พบรหัสโปรโมชัน");
    const { id: _id, ...rest } = body;
    return this.promos.update(id, rest);
  }

  @Post("delete")
  removePost(@Body() body: { id?: string }) {
    const id = String(body?.id ?? "").trim();
    if (!id) throw new BadRequestException("ไม่พบรหัสโปรโมชัน");
    return this.promos.remove(id);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.promos.get(id);
  }

  @Post()
  create(@Body() body: UpsertPromoDto) {
    return this.promos.create(body);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: Partial<UpsertPromoDto>) {
    return this.promos.update(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.promos.remove(id);
  }
}
