export type BranchRecord = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  /** PromptPay รับเงินของสาขา — null = ไม่โชว์ QR */
  promptPayId: string | null;
  /** ชื่อเจ้าของบัญชี PromptPay (บุคคล) */
  promptPayName: string | null;
  /** Discord webhook แจ้งยอดขายสาขานี้ — null = ใช้ DISCORD_WEBHOOK_URL */
  discordWebhookUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UpsertBranchDto = {
  code?: string;
  name: string;
  active?: boolean;
  promptPayId?: string | null;
  promptPayName?: string | null;
  discordWebhookUrl?: string | null;
};

export function normalizeBranchPromptPayId(
  raw: string | null | undefined,
): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  return d || null;
}

export function normalizeBranchPromptPayName(
  raw: string | null | undefined,
): string | null {
  const s = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return s || null;
}

export function normalizeDiscordWebhookUrl(
  raw: string | null | undefined,
): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (!/^https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/.+/i.test(s)) {
    return null;
  }
  return s.slice(0, 300);
}
