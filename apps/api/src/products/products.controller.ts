import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import { extname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { ProductsService } from "./products.service";
import type {
  BulkPriceRow,
  SetQuickBoardDto,
  UpsertProductDto,
} from "./product.types";

@Controller("products")
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list() {
    return this.products.list();
  }

  @Get("quick")
  listQuick() {
    return this.products.listQuick();
  }

  @Get("next-code")
  nextCode() {
    return this.products.nextProductCode();
  }

  @Put("quick-board")
  setQuickBoardPut(@Body() body: SetQuickBoardDto) {
    return this.products.setQuickBoard(body.productIds ?? []);
  }

  /** nginx HTTPS บางชุดบล็อก PUT → ใช้ POST แทน */
  @Post("quick-board")
  setQuickBoard(@Body() body: SetQuickBoardDto) {
    return this.products.setQuickBoard(body.productIds ?? []);
  }

  @Post("bulk-prices")
  bulkPrices(@Body() body: { rows?: BulkPriceRow[] }) {
    return this.products.bulkUpdatePrices(body.rows ?? []);
  }

  /**
   * nginx บน prod มักบล็อก PATCH/DELETE → ใช้ POST แทน
   * ต้องอยู่ก่อน :id
   */
  @Post("update")
  updatePost(@Body() body: Partial<UpsertProductDto> & { id?: string }) {
    const id = String(body?.id ?? "").trim();
    if (!id) throw new BadRequestException("ไม่พบรหัสสินค้า");
    const { id: _id, ...rest } = body;
    return this.products.update(id, rest);
  }

  @Post("delete")
  removePost(@Body() body: { id?: string }) {
    const id = String(body?.id ?? "").trim();
    if (!id) throw new BadRequestException("ไม่พบรหัสสินค้า");
    return this.products.remove(id);
  }

  @Post("clear-image")
  clearImagePost(@Body() body: { id?: string }) {
    const id = String(body?.id ?? "").trim();
    if (!id) throw new BadRequestException("ไม่พบรหัสสินค้า");
    return this.products.clearImage(id);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.products.get(id);
  }

  @Post()
  create(@Body() body: UpsertProductDto) {
    return this.products.create(body);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: Partial<UpsertProductDto>) {
    return this.products.update(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.products.remove(id);
  }

  @Post(":id/image")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dir = join(process.cwd(), "uploads", "products");
          mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => {
          const safe = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extname(file.originalname) || ".jpg"}`;
          cb(null, safe);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith("image/")) {
          cb(new Error("รองรับเฉพาะไฟล์รูป"), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  uploadImage(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      return this.products.get(id);
    }
    return this.products.setImage(id, file.filename);
  }

  @Delete(":id/image")
  clearImage(@Param("id") id: string) {
    return this.products.clearImage(id);
  }
}
