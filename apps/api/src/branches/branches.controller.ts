import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import type { UpsertBranchDto } from "./branch.types";
import { BranchesService } from "./branches.service";

@Controller("branches")
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  list() {
    return this.branches.list();
  }

  @Get("next-code")
  nextCode() {
    return this.branches.nextCode();
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.branches.get(id);
  }

  @Post()
  create(@Body() body: UpsertBranchDto) {
    return this.branches.create(body);
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
