import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import type { UpsertStaffDto } from "./staff.types";
import { StaffService } from "./staff.service";

@Controller("staff")
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  list() {
    return this.staff.list();
  }

  @Get("next-code")
  nextCode() {
    return this.staff.nextCode();
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.staff.get(id);
  }

  @Post()
  create(@Body() body: UpsertStaffDto) {
    return this.staff.create(body);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: Partial<UpsertStaffDto>) {
    return this.staff.update(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.staff.remove(id);
  }
}
