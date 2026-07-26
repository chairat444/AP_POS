import { Injectable } from "@nestjs/common";
import { ProductsService } from "../products/products.service";

@Injectable()
export class SyncService {
  private readonly receivedSales: unknown[] = [];

  constructor(private readonly products: ProductsService) {}

  listProducts() {
    return this.products.list();
  }

  acceptSales(sales: unknown[]) {
    this.receivedSales.push(...sales);
    return { accepted: sales.length, totalStored: this.receivedSales.length };
  }

  recentSalesCount() {
    return this.receivedSales.length;
  }
}
