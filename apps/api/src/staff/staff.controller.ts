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

  /** nginx HTTPS มักบล็อก PATCH/DELETE → ใช้ POST แทน */
  @Post("update")
  updatePost(@Body() body: Partial<UpsertStaffDto> & { id?: string }) {
    const id = String(body?.id ?? "").trim();
    if (!id) throw new BadRequestException("ไม่พบรหัสพนักงาน");
    const { id: _id, ...rest } = body;
    return this.staff.update(id, rest);
  }

  @Post("delete")
  removePost(@Body() body: { id?: string }) {
    const id = String(body?.id ?? "").trim();
    if (!id) throw new BadRequestException("ไม่พบรหัสพนักงาน");
    return this.staff.remove(id);
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
