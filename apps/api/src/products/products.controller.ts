import {
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
import { ProductsService } from "./products.service";
import type { SetQuickBoardDto, UpsertProductDto } from "./product.types";

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

  @Put("quick-board")
  setQuickBoard(@Body() body: SetQuickBoardDto) {
    return this.products.setQuickBoard(body.productIds ?? []);
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
        destination: join(process.cwd(), "uploads", "products"),
        filename: (_req, file, cb) => {
          const safe = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extname(file.originalname) || ".jpg"}`;
          cb(null, safe);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  uploadImage(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.products.setImage(id, file.filename);
  }
}
