import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import type { UpsertTerminalDto } from "./terminal.types";
import { TerminalsService } from "./terminals.service";

@Controller("terminals")
export class TerminalsController {
  constructor(private readonly terminals: TerminalsService) {}

  @Get()
  list(@Query("branchId") branchId?: string) {
    return this.terminals.list({ branchId: branchId || undefined });
  }

  @Get("next-code")
  nextCode() {
    return this.terminals.nextCode();
  }

  /** nginx HTTPS มักบล็อก PATCH/DELETE → ใช้ POST แทน */
  @Post("update")
  updatePost(@Body() body: Partial<UpsertTerminalDto> & { id?: string }) {
    const id = String(body?.id ?? "").trim();
    if (!id) throw new BadRequestException("ไม่พบรหัสเครื่อง");
    const { id: _id, ...rest } = body;
    return this.terminals.update(id, rest);
  }

  @Post("delete")
  removePost(@Body() body: { id?: string }) {
    const id = String(body?.id ?? "").trim();
    if (!id) throw new BadRequestException("ไม่พบรหัสเครื่อง");
    return this.terminals.remove(id);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.terminals.get(id);
  }

  @Post()
  create(@Body() body: UpsertTerminalDto) {
    return this.terminals.create(body);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: Partial<UpsertTerminalDto>) {
    return this.terminals.update(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.terminals.remove(id);
  }
}
