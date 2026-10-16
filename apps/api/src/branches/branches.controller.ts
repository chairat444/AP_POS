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
import type { UpsertBranchDto } from "./branch.types";
import { BranchesService } from "./branches.service";
import { NotifyService } from "../notify/notify.service";

@Controller("branches")
export class BranchesController {
  constructor(
    private readonly branches: BranchesService,
    private readonly notify: NotifyService,
  ) {}

  @Get()
  list() {
    return this.branches.list();
  }

  @Get("next-code")
  nextCode() {
    return this.branches.nextCode();
  }

  /** nginx HTTPS มักบล็อก PATCH/DELETE → ใช้ POST แทน */
  @Post("update")
  updatePost(@Body() body: Partial<UpsertBranchDto> & { id?: string }) {
    const id = String(body?.id ?? "").trim();
    if (!id) throw new BadRequestException("ไม่พบรหัสสาขา");
    const { id: _id, ...rest } = body;
    return this.branches.update(id, rest);
  }

  @Post("delete")
  removePost(@Body() body: { id?: string }) {
    const id = String(body?.id ?? "").trim();
    if (!id) throw new BadRequestException("ไม่พบรหัสสาขา");
    return this.branches.remove(id);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.branches.get(id);
  }

  @Post()
  create(@Body() body: UpsertBranchDto) {
    return this.branches.create(body);
  }

  @Post(":id/discord-test")
  async testDiscord(@Param("id") id: string) {
    await this.branches.get(id);
    return this.notify.testBranchWebhook(id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: Partial<UpsertBranchDto>) {
    return this.branches.update(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.branches.remove(id);
  }
}
