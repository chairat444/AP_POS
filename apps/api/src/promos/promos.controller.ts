import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import type { UpsertPromoDto } from "./promo.types";
import { PromosService } from "./promos.service";

@Controller("promos")
export class PromosController {
  constructor(private readonly promos: PromosService) {}

  @Get()
  list() {
    return this.promos.list();
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
