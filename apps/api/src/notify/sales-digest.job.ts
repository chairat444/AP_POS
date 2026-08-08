import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { SyncService } from "../sync/sync.service";
import { NotifyService } from "./notify.service";

@Injectable()
export class SalesDigestJob {
  private readonly logger = new Logger(SalesDigestJob.name);
  private lastCount = 0;

  constructor(
    private readonly sync: SyncService,
    private readonly notify: NotifyService,
  ) {}

  /** Every 5 minutes — summarize if new sales arrived. */
  @Cron("*/5 * * * *")
  async handle() {
    const count = await this.sync.recentSalesCount();
    if (count === this.lastCount) {
      this.logger.debug("No new sales since last digest");
      return;
    }
    const delta = count - this.lastCount;
    this.lastCount = count;
    const msg = `AP POS: มีบิลใหม่ ${delta} ใบ (รวมที่ sync แล้ว ${count} ใบ)`;
    await this.notify.sendDiscord(msg);
  }
}
