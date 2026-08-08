/** ตัวกรองวันที่รายงาน: รายวัน หรือช่วงตั้งแต่–ถึง */
export function useReportDateFilter(
  opts: { defaultMode?: "day" | "range" } = {},
) {
  function todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function monthStartIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  }

  const dateMode = ref<"day" | "range">(opts.defaultMode ?? "day");
  const day = ref(todayIso());
  const from = ref(monthStartIso());
  const to = ref(todayIso());

  const rangeFrom = computed(() =>
    dateMode.value === "day" ? day.value : from.value,
  );
  const rangeTo = computed(() =>
    dateMode.value === "day" ? day.value : to.value,
  );

  function setDateMode(mode: "day" | "range") {
    if (mode === "day") {
      day.value = to.value || todayIso();
    } else {
      if (!from.value) from.value = monthStartIso();
      if (!to.value) to.value = todayIso();
      if (from.value > to.value) from.value = to.value;
    }
    dateMode.value = mode;
  }

  function shiftDay(delta: number) {
    dateMode.value = "day";
    const d = new Date(`${day.value}T12:00:00`);
    d.setDate(d.getDate() + delta);
    day.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function setPreset(kind: "today" | "month" | "year") {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const today = `${y}-${m}-${d}`;
    day.value = today;
    to.value = today;
    if (kind === "today") {
      dateMode.value = "day";
    } else if (kind === "month") {
      dateMode.value = "range";
      from.value = `${y}-${m}-01`;
    } else {
      dateMode.value = "range";
      from.value = `${y}-01-01`;
    }
  }

  return {
    todayIso,
    dateMode,
    day,
    from,
    to,
    rangeFrom,
    rangeTo,
    setDateMode,
    shiftDay,
    setPreset,
  };
}
