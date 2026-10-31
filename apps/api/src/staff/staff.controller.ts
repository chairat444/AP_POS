import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import type { AuthedRequest } from "../auth/auth.guard";
import type { UpsertStaffDto } from "./staff.types";
import { StaffService } from "./staff.service";

function assertAdmin(req: AuthedRequest) {
  if (req.user?.role !== "admin") {
    throw new ForbiddenException("เฉพาะผู้ดูแลที่จัดการพนักงานได้");
  }
}

@Controller("staff")
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  list(@Req() req: AuthedRequest) {
    assertAdmin(req);
    return this.staff.list();
  }

  @Get("next-code")
  nextCode(@Req() req: AuthedRequest) {
    assertAdmin(req);
    return this.staff.nextCode();
  }

  /** nginx HTTPS มักบล็อก PATCH/DELETE → ใช้ POST แทน */
  @Post("update")
  updatePost(
    @Req() req: AuthedRequest,
    @Body() body: Partial<UpsertStaffDto> & { id?: string },
  ) {
    assertAdmin(req);
    const id = String(body?.id ?? "").trim();
    if (!id) throw new BadRequestException("ไม่พบรหัสพนักงาน");
    const { id: _id, ...rest } = body;
    return this.staff.update(id, rest);
  }

  @Post("delete")
  removePost(@Req() req: AuthedRequest, @Body() body: { id?: string }) {
    assertAdmin(req);
    const id = String(body?.id ?? "").trim();
    if (!id) throw new BadRequestException("ไม่พบรหัสพนักงาน");
    return this.staff.remove(id);
  }

  @Get(":id")
  get(@Req() req: AuthedRequest, @Param("id") id: string) {
    assertAdmin(req);
    return this.staff.get(id);
  }

  @Post()
  create(@Req() req: AuthedRequest, @Body() body: UpsertStaffDto) {
    assertAdmin(req);
    return this.staff.create(body);
  }

  @Patch(":id")
  update(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Body() body: Partial<UpsertStaffDto>,
  ) {
    assertAdmin(req);
    return this.staff.update(id, body);
  }

  @Delete(":id")
  remove(@Req() req: AuthedRequest, @Param("id") id: string) {
    assertAdmin(req);
    return this.staff.remove(id);
  }
}
