import { defineStore } from "pinia";
import { ref } from "vue";
import { searchMembers, type Member } from "../data/demo-members";
import { loadCachedMembers, saveCachedMembers } from "../services/sync";

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

  return {
    members,
    loadLocal,
    replaceAll,
    search,
    findById,
    adjustPoints,
    setPoints,
  };
});
