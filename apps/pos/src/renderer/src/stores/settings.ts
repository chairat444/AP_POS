import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  DEFAULT_KEYBINDINGS,
  DEFAULT_POINTS_CONFIG,
  eventMatchesAny,
  formatChords,
  mergeKeybindings,
  type KeybindingMap,
  type KeyChord,
  type PointsConfig,
  type PosActionId,
} from "@ap-pos/shared";

export type CustomerAdItem = {
  id: string;
  type: "image" | "video";
  url: string;
  name: string;
  sort: number;
  active: boolean;
  durationSec: number;
};

export type CustomerAdsConfig = {
  enabled: boolean;
  imageDurationSec: number;
  items: CustomerAdItem[];
};

const DEFAULT_CUSTOMER_ADS: CustomerAdsConfig = {
  enabled: true,
  imageDurationSec: 8,
  items: [],
};

function normalizeAds(
  payload: Partial<CustomerAdsConfig> | null | undefined,
): CustomerAdsConfig {
  const imageDurationSec = (() => {
    const n = Number(payload?.imageDurationSec);
    if (!Number.isFinite(n) || n < 3) return DEFAULT_CUSTOMER_ADS.imageDurationSec;
    return Math.min(120, Math.round(n));
  })();
  const items = Array.isArray(payload?.items)
    ? payload!.items
        .filter(
          (it) =>
            it &&
            typeof it.id === "string" &&
            typeof it.url === "string" &&
            (it.type === "image" || it.type === "video"),
        )
        .map((it, idx) => ({
          id: it.id,
          type: it.type === "video" ? ("video" as const) : ("image" as const),
          url: it.url,
          name: String(it.name || "").trim() || `สื่อ ${idx + 1}`,
          sort: Number.isFinite(Number(it.sort)) ? Number(it.sort) : idx,
          active: it.active !== false,
          durationSec: (() => {
            const n = Number(it.durationSec);
            if (!Number.isFinite(n) || n < 3) return imageDurationSec;
            return Math.min(120, Math.round(n));
          })(),
        }))
        .sort((a, b) => a.sort - b.sort)
    : [];
  return {
    enabled: payload?.enabled !== false,
    imageDurationSec,
    items,
  };
}

/**
 * การตั้งค่าเทอร์มินัล (รวมคีย์ลัด + แต้ม)
 * หลังบ้านส่งทับผ่าน applyFromBackend ได้
 */
export const useSettingsStore = defineStore("settings", () => {
  const keybindings = ref(mergeKeybindings(DEFAULT_KEYBINDINGS, null));
  const pointsConfig = ref<PointsConfig>({ ...DEFAULT_POINTS_CONFIG });
  const customerScreenEnabled = ref(true);
  const storeName = ref("AP หมูสด");
  const storeTagline = ref("Fresh Pork POS");
  const logoUrl = ref<string | null>(null);
  const customerBannerUrl = ref<string | null>(null);
  const customerPanelUrl = ref<string | null>(null);
  const customerAds = ref<CustomerAdsConfig>({
    ...DEFAULT_CUSTOMER_ADS,
    items: [],
  });

  const labels = computed(() => {
    const map = {} as Record<PosActionId, string>;
    for (const id of Object.keys(keybindings.value) as PosActionId[]) {
      map[id] = formatChords(keybindings.value[id]);
    }
    return map;
  });

  const activeCustomerAds = computed(() => {
    if (!customerAds.value.enabled) return [];
    return customerAds.value.items
      .filter((it) => it.active && it.url)
      .sort((a, b) => a.sort - b.sort);
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

  function syncCustomerScreenToMain() {
    window.apPos?.setCustomerScreenEnabled?.(customerScreenEnabled.value);
  }

  function publishSettingsToCustomer() {
    window.apPos?.publishSettings?.({
      display: {
        customerScreenEnabled: customerScreenEnabled.value,
        bannerUrl: customerBannerUrl.value,
        panelUrl: customerPanelUrl.value,
      },
      branding: {
        storeName: storeName.value,
        storeTagline: storeTagline.value,
        logoUrl: logoUrl.value,
      },
      customerAds: customerAds.value,
      points: pointsConfig.value,
    });
  }

  /** เรียกเมื่อโหลด config จาก API / sync จากหลังบ้าน */
  function applyFromBackend(
    payload: {
      keybindings?: KeybindingMap;
      points?: Partial<PointsConfig> | null;
      display?: {
        customerScreenEnabled?: boolean;
        bannerUrl?: string | null;
        panelUrl?: string | null;
      } | null;
      branding?: {
        storeName?: string;
        storeTagline?: string;
        logoUrl?: string | null;
      } | null;
      customerAds?: Partial<CustomerAdsConfig> | null;
    } | null,
  ) {
    if (payload?.keybindings) {
      keybindings.value = mergeKeybindings(
        DEFAULT_KEYBINDINGS,
        payload.keybindings,
      );
    }
    if (payload?.points) {
      const next = {
        bahtPerPoint:
          Number(payload.points.bahtPerPoint) > 0
            ? Number(payload.points.bahtPerPoint)
            : DEFAULT_POINTS_CONFIG.bahtPerPoint,
        bahtPerRedeemPoint:
          Number(payload.points.bahtPerRedeemPoint) > 0
            ? Number(payload.points.bahtPerRedeemPoint)
            : DEFAULT_POINTS_CONFIG.bahtPerRedeemPoint,
      };
      pointsConfig.value = next;
    }
    if (payload?.display) {
      if (payload.display.customerScreenEnabled != null) {
        customerScreenEnabled.value = Boolean(
          payload.display.customerScreenEnabled,
        );
        syncCustomerScreenToMain();
      }
      if (payload.display.bannerUrl !== undefined) {
        customerBannerUrl.value = payload.display.bannerUrl || null;
      }
      if (payload.display.panelUrl !== undefined) {
        customerPanelUrl.value = payload.display.panelUrl || null;
      }
    }
    if (payload?.branding) {
      if (payload.branding.storeName?.trim()) {
        storeName.value = payload.branding.storeName.trim();
      }
      if (payload.branding.storeTagline?.trim()) {
        storeTagline.value = payload.branding.storeTagline.trim();
      }
      if (payload.branding.logoUrl !== undefined) {
        logoUrl.value = payload.branding.logoUrl || null;
      }
    }
    if (payload?.customerAds) {
      customerAds.value = normalizeAds(payload.customerAds);
    }
  }

  function resetKeybindings() {
    keybindings.value = mergeKeybindings(DEFAULT_KEYBINDINGS, null);
  }

  return {
    keybindings,
    pointsConfig,
    customerScreenEnabled,
    storeName,
    storeTagline,
    logoUrl,
    customerBannerUrl,
    customerPanelUrl,
    customerAds,
    activeCustomerAds,
    labels,
    chords,
    label,
    matches,
    applyFromBackend,
    syncCustomerScreenToMain,
    publishSettingsToCustomer,
    resetKeybindings,
  };
});
