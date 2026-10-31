import { hasAdminMenu, menuKeyForAdminPath } from "@ap-pos/shared";

export default defineNuxtRouteMiddleware(async (to) => {
  // Auth state lives in localStorage — only enforce on the client.
  if (import.meta.server) return;

  const { loadFromStorage, ready, token, fetchMe, isLoggedIn, user } = useAuth();

  if (!ready.value) loadFromStorage();

  const isLogin = to.path === "/login";
  // หน้าสั่งของมือถือ — ใช้ PIN พนักงาน แยกจาก admin
  const isPurchaseOrder = to.path === "/purchases/order";
  // หน้าลูกค้าสมัคร/เช็คแต้มเอง (แท็บเล็ต)
  const isMemberKiosk = to.path === "/member" || to.path.startsWith("/member/");

  if (isPurchaseOrder || isMemberKiosk) return;

  if (token.value && !isLoggedIn.value) {
    await fetchMe();
  }

  if (!isLogin && !token.value) {
    return navigateTo("/login");
  }

  if (isLogin && token.value) {
    return navigateTo("/");
  }

  if (!isLogin && user.value) {
    const key = menuKeyForAdminPath(to.path);
    if (key === "staff" && user.value.role !== "admin") {
      return navigateTo("/");
    }
    if (key && key !== "staff" && !hasAdminMenu(user.value.menus, key)) {
      return navigateTo("/");
    }
  }
});
