import { defineStore } from "pinia";
import { ref } from "vue";
import { DEMO_MEMBERS, searchMembers, type Member } from "../data/demo-members";

export const useMembersStore = defineStore("members", () => {
  const members = ref<Member[]>(DEMO_MEMBERS.map((m) => ({ ...m })));

  function search(query: string) {
    return searchMembers(query, members.value);
  }

  function findById(id: string) {
    return members.value.find((m) => m.id === id) ?? null;
  }

  function adjustPoints(id: string, delta: number) {
    const m = members.value.find((x) => x.id === id);
    if (!m) return;
    m.points = Math.max(0, Math.floor(m.points + delta));
  }

  function setPoints(id: string, points: number) {
    const m = members.value.find((x) => x.id === id);
    if (!m) return;
    m.points = Math.max(0, Math.floor(points));
  }

  return { members, search, findById, adjustPoints, setPoints };
});
