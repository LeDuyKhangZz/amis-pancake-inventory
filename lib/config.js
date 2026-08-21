export const SERVICE_NAME = "amis-pancake-inventory-sync";

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
    this.status = 500;
    this.code = "CONFIGURATION_ERROR";
  }
}

function value(env, name, fallback = "") {
  const raw = env[name];
  return raw == null || String(raw).trim() === "" ? fallback : String(raw).trim();
}

function positiveInteger(env, name, fallback) {
  const raw = value(env, name, String(fallback));
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ConfigError(`${name} phải là số nguyên dương.`);
  }
  return parsed;
}

export function configurationStatus(env = process.env) {
  return {
    misa: Boolean(value(env, "MISA_CLIENT_ID", "AbrahamInventory2026") && value(env, "MISA_CLIENT_SECRET")),
    pancake: Boolean(value(env, "PANCAKE_SHOP_ID", "1022081353") && value(env, "PANCAKE_API_KEY")),
    manual_sync: Boolean(value(env, "SYNC_SECRET")),
    cron: Boolean(value(env, "CRON_SECRET")),
    misa_webhook: Boolean(value(env, "MISA_WEBHOOK_SECRET"))
  };
}

export function getMisaWebhookConfig(env = process.env) {
  const misaWebhookSecret = value(env, "MISA_WEBHOOK_SECRET");
  if (!misaWebhookSecret) {
    throw new ConfigError("Thiếu biến môi trường bắt buộc: MISA_WEBHOOK_SECRET.");
  }
  return { misaWebhookSecret };
}

export function getConfig(env = process.env) {
  const config = {
    misaClientId: value(env, "MISA_CLIENT_ID", "AbrahamInventory2026"),
    misaClientSecret: value(env, "MISA_CLIENT_SECRET"),
    misaStockCode: value(env, "MISA_STOCK_CODE"),
    pancakeShopId: value(env, "PANCAKE_SHOP_ID", "1022081353"),
    pancakeApiKey: value(env, "PANCAKE_API_KEY"),
    pancakeWarehouseId: value(env, "PANCAKE_WAREHOUSE_ID"),
    syncSecret: value(env, "SYNC_SECRET"),
    cronSecret: value(env, "CRON_SECRET"),
    createBatchSize: positiveInteger(env, "CREATE_BATCH_SIZE", 25)
  };

  const missing = [];
  if (!config.misaClientId) missing.push("MISA_CLIENT_ID");
  if (!config.misaClientSecret) missing.push("MISA_CLIENT_SECRET");
  if (!config.pancakeShopId) missing.push("PANCAKE_SHOP_ID");
  if (!config.pancakeApiKey) missing.push("PANCAKE_API_KEY");
  if (missing.length) {
    throw new ConfigError(`Thiếu biến môi trường bắt buộc: ${missing.join(", ")}.`);
  }
  return config;
}
