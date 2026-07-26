import { Injectable, Logger } from "@nestjs/common";

@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);

  async sendDiscord(message: string) {
    const webhook = process.env.DISCORD_WEBHOOK_URL;
    if (!webhook) {
      this.logger.debug(`[discord:skip] ${message}`);
      return;
    }
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message }),
    });
  }

  async sendLine(message: string) {
    const token = process.env.LINE_NOTIFY_TOKEN;
    if (!token) {
      this.logger.debug(`[line:skip] ${message}`);
      return;
    }
    // Placeholder — wire to LINE Messaging API / Notify later
    this.logger.log(`[line] ${message}`);
  }
}
