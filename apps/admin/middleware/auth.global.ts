export default defineNuxtRouteMiddleware(async (to) => {
  // Auth state lives in localStorage — only enforce on the client.
  if (import.meta.server) return;

  const { loadFromStorage, ready, token, fetchMe, isLoggedIn } = useAuth();

  if (!ready.value) loadFromStorage();

  const isLogin = to.path === "/login";

  if (token.value && !isLoggedIn.value) {
    await fetchMe();
  }

  if (!isLogin && !token.value) {
    return navigateTo("/login");
  }

  if (isLogin && token.value) {
    return navigateTo("/");
  }
});
