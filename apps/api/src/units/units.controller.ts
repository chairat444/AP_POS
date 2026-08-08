import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import type { UpsertProductUnitDto } from "./unit.types";
import { UnitsService } from "./units.service";

@Controller("units")
export class UnitsController {
  constructor(private readonly units: UnitsService) {}

  @Get()
  list() {
    return this.units.list();
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.units.get(id);
  }

  @Post()
  create(@Body() body: UpsertProductUnitDto) {
    return this.units.create(body);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: Partial<UpsertProductUnitDto>) {
    return this.units.update(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.units.remove(id);
  }
}
