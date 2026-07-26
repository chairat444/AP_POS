import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  DEFAULT_KEYBINDINGS,
  eventMatchesAny,
  formatChords,
  mergeKeybindings,
  type KeybindingMap,
  type KeyChord,
  type PosActionId,
} from "@ap-pos/shared";

/**
 * การตั้งค่าเทอร์มินัล (รวมคีย์ลัด)
 * ตอนนี้ใช้ค่า default ในเครื่อง — หลังบ้านส่งทับผ่าน applyFromBackend ได้
 */
export const useSettingsStore = defineStore("settings", () => {
  const keybindings = ref(
    mergeKeybindings(DEFAULT_KEYBINDINGS, null),
  );

  const labels = computed(() => {
    const map = {} as Record<PosActionId, string>;
    for (const id of Object.keys(keybindings.value) as PosActionId[]) {
      map[id] = formatChords(keybindings.value[id]);
    }
    return map;
  });

  function chords(action: PosActionId): KeyChord[] {
    return keybindings.value[action] ?? [];
  }

  function label(action: PosActionId): string {
    return formatChords(chords(action));
  }

  function matches(action: PosActionId, e: KeyboardEvent): boolean {
    return eventMatchesAny(e, chords(action));
  }

  /** เรียกเมื่อโหลด config จาก API / sync จากหลังบ้าน */
  function applyFromBackend(payload: { keybindings?: KeybindingMap } | null) {
    keybindings.value = mergeKeybindings(
      DEFAULT_KEYBINDINGS,
      payload?.keybindings,
    );
  }

  function resetKeybindings() {
    keybindings.value = mergeKeybindings(DEFAULT_KEYBINDINGS, null);
  }

  return {
    keybindings,
    labels,
    chords,
    label,
    matches,
    applyFromBackend,
    resetKeybindings,
  };
});
