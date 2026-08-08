export type PaginationMeta = {
  total: number;
  page: number;
  per_page: number;
  last_page: number;
  from: number;
  to: number;
};

export function emptyMeta(perPage = 20): PaginationMeta {
  return {
    total: 0,
    page: 1,
    per_page: perPage,
    last_page: 1,
    from: 0,
    to: 0,
  };
}

export function buildMeta(
  total: number,
  page: number,
  perPage: number,
): PaginationMeta {
  const per_page = Math.max(1, perPage);
  const last_page = Math.max(1, Math.ceil(Math.max(0, total) / per_page));
  const safePage = Math.min(Math.max(1, page), last_page);
  const from = total === 0 ? 0 : (safePage - 1) * per_page + 1;
  const to = total === 0 ? 0 : Math.min(total, safePage * per_page);
  return {
    total,
    page: safePage,
    per_page,
    last_page,
    from,
    to,
  };
}

export function paginateItems<T>(
  items: T[],
  page: number,
  perPage: number,
): { rows: T[]; meta: PaginationMeta } {
  const list = Array.isArray(items) ? items : [];
  const meta = buildMeta(list.length, page, perPage);
  const start = (meta.page - 1) * meta.per_page;
  return {
    rows: list.slice(start, start + meta.per_page),
    meta,
  };
}
