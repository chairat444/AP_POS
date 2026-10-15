import { defineStore } from "pinia";
import { ref } from "vue";
import { searchMembers, type Member } from "../data/demo-members";
import {
  createMember as createMemberRemote,
  loadCachedMembers,
  lookupMemberByPhone,
  saveCachedMembers,
} from "../services/sync";

export const useMembersStore = defineStore("members", () => {
  const members = ref<Member[]>([]);

  async function loadLocal() {
    members.value = await loadCachedMembers();
  }

  async function replaceAll(next: Member[]) {
    members.value = next.map((m) => ({ ...m }));
    await saveCachedMembers(members.value);
  }

  function search(query: string) {
    return searchMembers(query, members.value);
  }

  /** ค้นในเครื่องก่อน · ถ้าพิมพ์เบอร์ครบและออนไลน์ ให้ถามเซิร์ฟด้วย */
  async function searchWithServer(query: string): Promise<Member[]> {
    const local = searchMembers(query, members.value);
    const digits = query.replace(/\D/g, "");
    if (digits.length < 9) return local;

    const remote = await lookupMemberByPhone(digits);
    if (!remote) return local;

    const without = members.value.filter((m) => m.id !== remote.id);
    members.value = [...without, remote].sort((a, b) =>
      a.name.localeCompare(b.name, "th"),
    );
    return searchMembers(query, members.value);
  }

  function findById(id: string) {
    return members.value.find((m) => m.id === id) ?? null;
  }

  async function adjustPoints(id: string, delta: number) {
    const m = members.value.find((x) => x.id === id);
    if (!m) return;
    m.points = Math.max(0, Math.floor(m.points + delta));
    if (window.apPos?.db) {
      await window.apPos.db.adjustMemberPoints(id, delta);
    } else {
      await saveCachedMembers(members.value);
    }
  }

  async function setPoints(id: string, points: number) {
    const m = members.value.find((x) => x.id === id);
    if (!m) return;
    m.points = Math.max(0, Math.floor(points));
    await saveCachedMembers(members.value);
  }

  async function create(input: {
    name: string;
    phone?: string;
    points?: number;
  }): Promise<Member> {
    const created = await createMemberRemote(input);
    const without = members.value.filter((m) => m.id !== created.id);
    members.value = [...without, created].sort((a, b) =>
      a.name.localeCompare(b.name, "th"),
    );
    return created;
  }

  return {
    members,
    loadLocal,
    replaceAll,
    search,
    searchWithServer,
    findById,
    adjustPoints,
    setPoints,
    create,
  };
});
