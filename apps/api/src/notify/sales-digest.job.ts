import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { NotifyService } from "./notify.service";

@Injectable()
export class SalesDigestJob {
  private readonly logger = new Logger(SalesDigestJob.name);

  constructor(private readonly notify: NotifyService) {}

  /** ปล่อยคิวข้อความสั้นที่ค้างจาก throttle */
  @Cron("* * * * *")
  async flushBrief() {
    try {
      await this.notify.flushPendingBriefs();
    } catch (err) {
      this.logger.warn(
        `flush brief failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /** cron สำรอง — ถ้ายอดเปลี่ยนและยังไม่ได้ brief */
  @Cron("*/5 * * * *")
  async digestBackup() {
    try {
      await this.notify.notifyAllBranchesDigest();
    } catch (err) {
      this.logger.warn(
        `digest failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
