import { maybeWrapWafRequestBody } from "@ap-pos/shared";

type AuthUser = {
  id: string;
  code: string;
  name: string;
  role: string;
  menus?: string[];
};

const TOKEN_KEY = "ap-pos-admin-token";
const USER_KEY = "ap-pos-admin-user";

export function useAuth() {
  const config = useRuntimeConfig();
  const base = String(config.public.apiBase || "/api").replace(/\/$/, "");

  const token = useState<string | null>("auth-token", () => null);
  const user = useState<AuthUser | null>("auth-user", () => null);
  const ready = useState("auth-ready", () => false);

  function loadFromStorage() {
    if (!import.meta.client) return;
    token.value = localStorage.getItem(TOKEN_KEY);
    const raw = localStorage.getItem(USER_KEY);
    user.value = raw ? (JSON.parse(raw) as AuthUser) : null;
    ready.value = true;
  }

  function persist(nextToken: string, nextUser: AuthUser) {
    token.value = nextToken;
    user.value = nextUser;
    if (import.meta.client) {
      localStorage.setItem(TOKEN_KEY, nextToken);
      localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    }
  }

  function clear() {
    token.value = null;
    user.value = null;
    if (import.meta.client) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    }
  }

  async function login(code: string, password: string) {
    const data = await $fetch<{ token: string; user: AuthUser }>(
      `${base}/auth/login`,
      {
        method: "POST",
        body: maybeWrapWafRequestBody({ code, password }) as Record<
          string,
          unknown
        >,
      },
    );
    persist(data.token, data.user);
    return data.user;
  }

  async function fetchMe() {
    if (!token.value) {
      clear();
      return null;
    }
    try {
      const me = await $fetch<AuthUser & { token?: string }>(
        `${base}/auth/me`,
        {
          headers: { Authorization: `Bearer ${token.value}` },
        },
      );
      const nextUser: AuthUser = {
        id: me.id,
        code: me.code,
        name: me.name,
        role: me.role,
        menus: me.menus,
      };
      if (me.token) {
        token.value = me.token;
        if (import.meta.client) localStorage.setItem(TOKEN_KEY, me.token);
      }
      user.value = nextUser;
      if (import.meta.client) {
        localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
      }
      return nextUser;
    } catch {
      clear();
      return null;
    }
  }

  function logout() {
    clear();
  }

  return {
    token,
    user,
    ready,
    loadFromStorage,
    login,
    fetchMe,
    logout,
    isLoggedIn: computed(() => Boolean(token.value && user.value)),
  };
}
