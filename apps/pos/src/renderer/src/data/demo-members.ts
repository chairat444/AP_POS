export type Member = {
  id: string;
  code: string;
  name: string;
  phone: string;
  points: number;
};

/** Offline fallback only — empty so demo members never reappear after migrate. */
export const DEMO_MEMBERS: Member[] = [];


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
