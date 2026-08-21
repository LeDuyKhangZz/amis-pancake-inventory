import { MisaClient, selectMisaStock } from "./misa.js";
import { PancakeClient, selectPancakeWarehouse, variationId, variationSku } from "./pancake.js";
import { PublicError } from "./http.js";

const SAMPLE_LIMIT = 20;
const INVENTORY_BATCH_SIZE = 50;

export function normalizeSku(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-US");
}

export function normalizeQuantity(value) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || !Number.isInteger(quantity)) {
    return { ok: false, reason: "Tồn kho không phải số nguyên" };
  }
  return { ok: true, value: Math.max(0, quantity) };
}

function reasonRow(product, reason) {
  return { product_code: String(product?.product_code ?? "").trim(), product_name: String(product?.product_name ?? "").trim(), reason };
}

function makeProduct(product, quantity, warehouseId) {
  const sku = String(product.product_code).trim();
  return {
    name: String(product.product_name).trim(),
    custom_id: sku,
    weight: 0,
    is_published: true,
    variations: [{
      custom_id: sku,
      weight: 0,
      is_hidden: false,
      variations_warehouses: [{ warehouse_id: warehouseId, remain_quantity: quantity }]
    }]
  };
}

export function buildPlan({ products, inventory, variations, warehouseId }) {
  const active = products.filter((product) => product?.inactive !== true);
  const sourceCounts = new Map();
  for (const product of active) {
    const sku = normalizeSku(product?.product_code);
    if (sku) sourceCounts.set(sku, (sourceCounts.get(sku) || 0) + 1);
  }

  const inventoryBySku = new Map();
  for (const row of inventory) {
    const sku = normalizeSku(row?.product_code);
    if (sku) inventoryBySku.set(sku, row?.main_stock_quantity);
  }

  const targetBySku = new Map();
  for (const variation of variations) {
    const sku = normalizeSku(variationSku(variation));
    if (!sku) continue;
    const matches = targetBySku.get(sku) || [];
    matches.push(variation);
    targetBySku.set(sku, matches);
  }

  const create = [];
  const update = [];
  const skipped = [];
  for (const product of active) {
    const rawCode = String(product?.product_code ?? "").trim();
    const rawName = String(product?.product_name ?? "").trim();
    const sku = normalizeSku(rawCode);
    if (!rawCode) { skipped.push(reasonRow(product, "Thiếu product_code")); continue; }
    if (!rawName) { skipped.push(reasonRow(product, "Thiếu product_name")); continue; }
    if (sourceCounts.get(sku) > 1) { skipped.push(reasonRow(product, "Mã hàng bị trùng trong AMIS")); continue; }

    const rawQuantity = inventoryBySku.has(sku) ? inventoryBySku.get(sku) : 0;
    const quantity = normalizeQuantity(rawQuantity);
    if (!quantity.ok) { skipped.push(reasonRow(product, quantity.reason)); continue; }

    const targetMatches = targetBySku.get(sku) || [];
    if (targetMatches.length > 1) { skipped.push(reasonRow(product, "SKU bị trùng trong Pancake")); continue; }
    if (targetMatches.length === 0) {
      create.push({ product_code: rawCode, product_name: rawName, remain_quantity: quantity.value, payload: makeProduct(product, quantity.value, warehouseId) });
      continue;
    }
    const id = variationId(targetMatches[0]);
    if (id == null || String(id).trim() === "") { skipped.push(reasonRow(product, "Variation Pancake thiếu ID")); continue; }
    update.push({
      product_code: rawCode,
      product_name: rawName,
      remain_quantity: quantity.value,
      variation_id: id,
      payload: { variation_id: id, warehouse_id: warehouseId, remain_quantity: quantity.value }
    });
  }
  return { activeProducts: active.length, create, update, skipped };
}

function samples(plan) {
  const clean = (row) => {
    const { payload, ...publicRow } = row;
    return publicRow;
  };
  return {
    create_sample: plan.create.slice(0, SAMPLE_LIMIT).map(clean),
    update_sample: plan.update.slice(0, SAMPLE_LIMIT).map(clean),
    skipped_sample: plan.skipped.slice(0, SAMPLE_LIMIT)
  };
}

function publicPlan(plan) {
  return { create_products: plan.create.length, update_inventory: plan.update.length, skipped: plan.skipped.length };
}

function publicContext({ misaStock, pancakeWarehouse, config, plan, variations }) {
  return {
    source: {
      stock_code: misaStock.stock_code ?? "",
      stock_name: misaStock.stock_name ?? "",
      products: plan.activeProducts
    },
    target: {
      shop_id: config.pancakeShopId,
      warehouse_name: pancakeWarehouse.name ?? pancakeWarehouse.warehouse_name ?? "",
      existing_variations: variations.length
    }
  };
}

function warehouseIdOf(warehouse) {
  return warehouse?.id ?? warehouse?.warehouse_id;
}

async function loadContext(config, fetchImpl) {
  const misa = new MisaClient(config, fetchImpl);
  const pancake = new PancakeClient(config, fetchImpl);
  await misa.authenticate();
  const [products, misaStocks, pancakeWarehouses, variations] = await Promise.all([
    misa.listProducts(), misa.listStocks(), pancake.listWarehouses(), pancake.listVariations()
  ]);
  const misaStock = selectMisaStock(misaStocks, config.misaStockCode);
  const pancakeWarehouse = selectPancakeWarehouse(pancakeWarehouses, config.pancakeWarehouseId);
  if (misaStock.async_id == null || String(misaStock.async_id).trim() === "") {
    throw new PublicError("Kho AMIS thiếu async_id.", { code: "MISA_STOCK_ID_MISSING", status: 502 });
  }
  if (warehouseIdOf(pancakeWarehouse) == null || String(warehouseIdOf(pancakeWarehouse)).trim() === "") {
    throw new PublicError("Kho Pancake thiếu ID.", { code: "PANCAKE_WAREHOUSE_ID_MISSING", status: 502 });
  }
  const inventory = await misa.listInventory(misaStock.async_id);
  const plan = buildPlan({ products, inventory, variations, warehouseId: warehouseIdOf(pancakeWarehouse) });
  return { config, misaStock, pancakeWarehouse, variations, plan, pancake };
}

export async function previewSync(config, { fetchImpl = globalThis.fetch } = {}) {
  const context = await loadContext(config, fetchImpl);
  console.info(JSON.stringify({
    event: "sync_preview",
    create: context.plan.create.length,
    update: context.plan.update.length,
    skipped: context.plan.skipped.length
  }));
  return {
    ok: true,
    mode: "preview",
    ...publicContext(context),
    plan: publicPlan(context.plan),
    preview: samples(context.plan)
  };
}

function errorSample(row, error) {
  return { product_code: row.product_code, reason: error?.message || "Lỗi không xác định" };
}

export async function commitSync(config, { fetchImpl = globalThis.fetch } = {}) {
  const context = await loadContext(config, fetchImpl);
  const { plan, pancake } = context;
  const createQueue = plan.create.slice(0, config.createBatchSize);
  const failures = [];
  let failed = 0;
  let created = 0;
  let inventoryUpdated = 0;

  for (const row of createQueue) {
    try {
      await pancake.createProduct(row.payload);
      created += 1;
    } catch (error) {
      failed += 1;
      failures.push(errorSample(row, error));
    }
  }

  for (let index = 0; index < plan.update.length; index += INVENTORY_BATCH_SIZE) {
    const batch = plan.update.slice(index, index + INVENTORY_BATCH_SIZE);
    try {
      await pancake.updateQuantities(batch.map((row) => row.payload));
      inventoryUpdated += batch.length;
    } catch (error) {
      failed += batch.length;
      const remainingSampleSlots = Math.max(0, SAMPLE_LIMIT - failures.length);
      failures.push(...batch.slice(0, remainingSampleSlots).map((row) => errorSample(row, error)));
    }
  }

  const remainingToCreate = Math.max(0, plan.create.length - created);
  console.info(JSON.stringify({
    event: "sync_commit",
    created,
    inventory_updated: inventoryUpdated,
    failed,
    skipped: plan.skipped.length,
    remaining_to_create: remainingToCreate
  }));
  return {
    ok: failed === 0,
    mode: "commit",
    ...publicContext(context),
    plan: publicPlan(plan),
    result: {
      created,
      inventory_updated: inventoryUpdated,
      failed,
      failure_sample: failures.slice(0, SAMPLE_LIMIT),
      skipped: plan.skipped.length,
      skipped_sample: plan.skipped.slice(0, SAMPLE_LIMIT)
    },
    remaining_to_create: remainingToCreate,
    run_again_required: remainingToCreate > 0
  };
}
