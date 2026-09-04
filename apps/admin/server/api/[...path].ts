/**
 * Same-origin proxy: browser → https://host/api/... → NestJS (HTTP localhost)
 * กัน mixed content เมื่อ Admin อยู่บน HTTPS แต่ API ยังเป็น HTTP ในเครื่อง
 */
export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event);
  const targetBase = String(
    config.apiProxyTarget || "http://127.0.0.1:3000",
  ).replace(/\/$/, "");

  const url = getRequestURL(event);
  const upstreamPath = url.pathname.replace(/^\/api/, "") || "/";
  const target = `${targetBase}${upstreamPath}${url.search}`;

  return proxyRequest(event, target);
});
