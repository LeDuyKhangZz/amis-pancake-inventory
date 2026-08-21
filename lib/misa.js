import { PublicError, requestJson } from "./http.js";

const BASE_URL = "https://crmconnect.misa.vn";

export function extractItems(payload) {
  const candidates = [payload?.data?.data, payload?.data?.items, payload?.data, payload?.items];
  return candidates.find(Array.isArray) || [];
}

function totalPages(payload) {
  const candidates = [payload?.total_pages, payload?.totalPages, payload?.data?.total_pages, payload?.data?.totalPages];
  const found = candidates.find((item) => Number.isFinite(Number(item)));
  return found === undefined ? null : Number(found);
}

function normalize(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-US");
}

export function selectMisaStock(stocks, configuredCode = "") {
  const active = stocks.filter((stock) => stock?.inactive !== true);
  if (configuredCode) {
    const selected = active.find((stock) => normalize(stock.stock_code) === normalize(configuredCode));
    if (!selected) throw new PublicError("Không tìm thấy kho AMIS theo MISA_STOCK_CODE.", { code: "MISA_STOCK_NOT_FOUND", status: 409 });
    return selected;
  }
  if (active.length === 1) return active[0];
  if (active.length === 0) throw new PublicError("AMIS không có kho đang hoạt động.", { code: "MISA_STOCK_NOT_FOUND", status: 409 });
  const choices = active.slice(0, 20).map((stock) => {
    const code = String(stock?.stock_code ?? "").trim() || "[không có mã]";
    const name = String(stock?.stock_name ?? "").trim() || "[không có tên]";
    return `${code} - ${name}`;
  }).join("; ");
  throw new PublicError(`AMIS có nhiều kho đang hoạt động: ${choices}. Hãy cấu hình MISA_STOCK_CODE.`, {
    code: "MISA_STOCK_AMBIGUOUS",
    status: 409
  });
}

export class MisaClient {
  constructor(config, fetchImpl = globalThis.fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.token = "";
  }

  async authenticate() {
    const payload = await requestJson(`${BASE_URL}/api/v2/Account`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: { client_id: this.config.misaClientId, client_secret: this.config.misaClientSecret },
      fetchImpl: this.fetchImpl,
      endpoint: "AMIS đăng nhập"
    });
    const token = typeof payload?.data === "string" ? payload.data : payload?.data?.access_token;
    if (!token) throw new PublicError("AMIS không trả về access token hợp lệ.", { code: "MISA_TOKEN_INVALID", status: 502 });
    this.token = token;
    return token;
  }

  headers() {
    if (!this.token) throw new PublicError("Chưa đăng nhập AMIS.", { code: "MISA_NOT_AUTHENTICATED", status: 500 });
    return { Authorization: `Bearer ${this.token}`, Clientid: this.config.misaClientId, Accept: "application/json" };
  }

  async paged(path, pageSize, endpoint) {
    const all = [];
    for (let page = 0; ; page += 1) {
      const separator = path.includes("?") ? "&" : "?";
      const payload = await requestJson(`${BASE_URL}${path}${separator}page=${page}&pageSize=${pageSize}`, {
        headers: this.headers(), fetchImpl: this.fetchImpl, endpoint
      });
      const items = extractItems(payload);
      all.push(...items);
      const pages = totalPages(payload);
      if ((pages !== null && page + 1 >= pages) || (pages === null && items.length < pageSize)) break;
    }
    return all;
  }

  listProducts() {
    return this.paged("/api/v2/Products", 100, "AMIS danh mục hàng hóa");
  }

  async listStocks() {
    const payload = await requestJson(`${BASE_URL}/api/v2/Stocks`, {
      headers: this.headers(), fetchImpl: this.fetchImpl, endpoint: "AMIS danh sách kho"
    });
    return extractItems(payload);
  }

  listInventory(stockId) {
    return this.paged(`/api/v2/Stocks/product_ledger?stockID=${encodeURIComponent(stockId)}`, 50, "AMIS sổ tồn kho");
  }
}
