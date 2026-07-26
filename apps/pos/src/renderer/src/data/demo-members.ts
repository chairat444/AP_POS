export type Member = {
  id: string;
  code: string;
  name: string;
  phone: string;
  points: number;
};

export const DEMO_MEMBERS: Member[] = [
  { id: "m1", code: "C00001", name: "คุณสมชาย ใจดี", phone: "0812345678", points: 500 },
  { id: "m2", code: "C00002", name: "คุณสมหญิง รักหมู", phone: "0898765432", points: 120 },
  { id: "m3", code: "C00003", name: "คุณวิชัย ตลาดสด", phone: "0811112222", points: 0 },
  { id: "m4", code: "C00004", name: "คุณมาลี สาขาหลุมดิน", phone: "0823456789", points: 85 },
  { id: "m5", code: "C00005", name: "คุณประยุทธ์ กินเก่ง", phone: "0834567890", points: 1500 },
  { id: "m6", code: "C00006", name: "คุณนภา เบอร์เก่า", phone: "0912345678", points: 40 },
];

export function searchMembers(query: string, members: Member[]): Member[] {
  const q = query.trim().toLowerCase();
  if (!q) return members.slice(0, 8);

  const digits = q.replace(/\D/g, "");
  return members
    .filter((m) => {
      const phone = m.phone.replace(/\D/g, "");
      const nameHit = m.name.toLowerCase().includes(q);
      const codeHit = m.code.toLowerCase().includes(q);
      const phoneHit = digits.length > 0 && phone.includes(digits);
      return phoneHit || nameHit || codeHit;
    })
    .sort((a, b) => {
      // เน้นเบอร์โทร: ขึ้นต้นด้วยที่พิมพ์มาก่อน
      if (digits) {
        const ap = a.phone.replace(/\D/g, "");
        const bp = b.phone.replace(/\D/g, "");
        const aStarts = ap.startsWith(digits) ? 0 : 1;
        const bStarts = bp.startsWith(digits) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
      }
      return a.name.localeCompare(b.name, "th");
    })
    .slice(0, 8);
}
