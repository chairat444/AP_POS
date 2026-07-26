import { Body, Controller, Get, Post } from "@nestjs/common";
import { SyncService } from "./sync.service";

@Controller("sync")
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Get("products")
  products() {
    return this.sync.listProducts();
  }

  @Post("sales")
  pushSales(@Body() body: { sales: unknown[] }) {
    return this.sync.acceptSales(body.sales ?? []);
  }
}
