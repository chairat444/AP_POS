import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import type { UpsertMemberDto } from "./member.types";
import { MembersService } from "./members.service";

@Controller("members")
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  list() {
    return this.members.list();
  }

  @Get("next-code")
  nextCode() {
    return this.members.nextMemberCode();
  }

  /** ค้นหาสมาชิกสำหรับหน้าประวัติแต้ม — ต้องอยู่ก่อน :id */
  @Get("points-history/search")
  searchPointsHistory(@Query("q") q = "") {
    return this.members.findForPointsHistory(q);
  }

  @Get(":id/points-history")
  pointsHistory(@Param("id") id: string) {
    return this.members.pointsHistory(id);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.members.get(id);
  }

  @Post()
  create(@Body() body: UpsertMemberDto) {
    return this.members.create(body);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: Partial<UpsertMemberDto>) {
    return this.members.update(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.members.remove(id);
  }
}
