import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
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
