import {
  Body,
  Controller,
  Delete,
  Get,
  BadRequestException,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { PurchasesService } from "./purchases.service";

@Controller("purchases")
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get("groups")
  groups() {
    return this.purchases.groups();
  }

  @Get("catalog")
  catalog() {
    return this.purchases.listCatalog();
  }

  @Post("catalog")
  createCatalog(
    @Body()
    body: {
      name: string;
      aliases?: string;
      groupKey: string;
      unit?: string | null;
      sortOrder?: number;
    },
  ) {
    return this.purchases.upsertCatalog(body);
  }

  @Patch("catalog/:id")
  async updateCatalog(
    @Param("id") id: string,
    @Body()
    body: {
      name?: string;
      aliases?: string;
      groupKey?: string;
      unit?: string | null;
      sortOrder?: number;
      active?: boolean;
    },
  ) {
    const { items } = await this.purchases.listCatalog();
    const cur = items.find((x) => x.id === id);
    if (!cur) throw new NotFoundException("ไม่พบรายการ");
    return this.purchases.upsertCatalog({
      id,
      name: body.name ?? cur.name,
      aliases: body.aliases ?? cur.aliases,
      groupKey: body.groupKey ?? cur.groupKey,
      unit: body.unit === undefined ? cur.unit : body.unit,
      sortOrder: body.sortOrder ?? cur.sortOrder,
      active: body.active ?? cur.active,
    });
  }

  @Get("days")
  days() {
    return this.purchases.listDays();
  }

  @Patch("days/:id")
  updateDay(
    @Param("id") id: string,
    @Body() body: { status?: string; note?: string | null },
  ) {
    if (body.status) {
      return this.purchases.updateDayStatus(id, body.status);
    }
    throw new BadRequestException("ระบุ status");
  }

  @Get("board")
  board(@Query("day") day?: string) {
    return this.purchases.boardByDay(day);
  }

  @Post("ingest")
  ingest(
    @Body()
    body: {
      day?: string;
      branchId: string;
      branchLabel?: string;
      rawText: string;
    },
  ) {
    return this.purchases.ingest(body);
  }

  @Patch("lines/:id")
  updateLine(
    @Param("id") id: string,
    @Body()
    body: {
      name?: string;
      qtyText?: string | null;
      note?: string | null;
      groupKey?: string;
      catalogId?: string | null;
    },
  ) {
    return this.purchases.updateLine(id, body);
  }

  /** กรอก/แก้จำนวนบนแผงสรุป — สร้างบรรทัดสาขาใหม่ได้ ถ้าว่างจะลบ */
  @Post("board-qty")
  setBoardQty(
    @Body()
    body: {
      day?: string;
      dayId?: string;
      branchId: string;
      name: string;
      groupKey: string;
      catalogId?: string | null;
      lineId?: string | null;
      qtyText?: string | null;
      forceCreate?: boolean;
    },
  ) {
    if (!body.branchId || !body.name?.trim() || !body.groupKey) {
      throw new BadRequestException("ข้อมูลไม่ครบ");
    }
    return this.purchases.setBoardQty(body);
  }

  /** ลบสินค้าทั้งแถวออกจากแผง (ทุกสาขา) — ไม่ซื้อ */
  @Post("board-remove")
  removeBoardItem(
    @Body()
    body: {
      dayId?: string;
      day?: string;
      name: string;
      groupKey: string;
      lineIds?: string[];
    },
  ) {
    if (!body.name?.trim() || !body.groupKey) {
      throw new BadRequestException("ข้อมูลไม่ครบ");
    }
    return this.purchases.removeBoardItem(body);
  }

  /** แก้ชื่อสินค้าบนแผง */
  @Post("board-rename")
  renameBoardItem(
    @Body()
    body: {
      dayId?: string;
      day?: string;
      name: string;
      newName: string;
      groupKey: string;
      lineIds?: string[];
    },
  ) {
    if (!body.name?.trim() || !body.newName?.trim() || !body.groupKey) {
      throw new BadRequestException("ข้อมูลไม่ครบ");
    }
    return this.purchases.renameBoardItem(body);
  }

  @Delete("lines/:id")
  removeLine(@Param("id") id: string) {
    return this.purchases.removeLine(id);
  }
}
