import { maybeWrapWafRequestBody } from "@ap-pos/shared";

export function useAdminApi() {
  const config = useRuntimeConfig();
  const { token, logout } = useAuth();
  const base = String(config.public.apiBase || "/api").replace(/\/$/, "");

  function headers(): Record<string, string> {
    const h: Record<string, string> = {};
    if (token.value) h.Authorization = `Bearer ${token.value}`;
    return h;
  }

  async function request<T>(
    path: string,
    opts: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    try {
      return await $fetch<T>(`${base}${path}`, {
        method: (opts.method as "GET") ?? "GET",
        body: maybeWrapWafRequestBody(opts.body) as
          | BodyInit
          | Record<string, unknown>
          | null
          | undefined,
        headers: headers(),
      });
    } catch (e: unknown) {
      const status = (e as { statusCode?: number; status?: number })?.statusCode
        ?? (e as { status?: number })?.status;
      if (status === 401 && import.meta.client) {
        logout();
        await navigateTo("/login");
      }
      throw e;
    }
  }

  return {
    base,
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body: unknown) =>
      request<T>(path, { method: "POST", body }),
    postForm: <T>(path: string, body: Record<string, string | number | undefined | null>) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(body)) {
        if (value == null) continue;
        params.set(key, String(value));
      }
      return request<T>(path, { method: "POST", body: params });
    },
    patch: <T>(path: string, body: unknown) =>
      request<T>(path, { method: "PATCH", body }),
    put: <T>(path: string, body: unknown) =>
      request<T>(path, { method: "PUT", body }),
    del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
    async upload<T>(path: string, formData: FormData): Promise<T> {
      try {
        return await $fetch<T>(`${base}${path}`, {
          method: "POST",
          body: formData,
          headers: headers(),
        });
      } catch (e: unknown) {
        const status =
          (e as { statusCode?: number; status?: number })?.statusCode ??
          (e as { status?: number })?.status;
        if (status === 401 && import.meta.client) {
          logout();
          await navigateTo("/login");
        }
        throw e;
      }
    },
    assetUrl(path: string | null | undefined) {
      if (!path) return "";
      if (
        path.startsWith("http://") ||
        path.startsWith("https://") ||
        path.startsWith("data:")
      ) {
        return path;
      }
      return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
    },
  };
}
