
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();

// === Helpers robustos para inventario ===
function asArray(x) {
  if (Array.isArray(x)) return x;
  if (!x) return [];
  if (typeof x === "object") return Object.values(x);
  return [];
}

function pickNumber(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (!Number.isNaN(n) && Number.isFinite(n)) return n;
  }
  return 0;
}

// Devuelve el stock total sin depender del nombre exacto de la propiedad
function extractStock(item) {
  const whArrays = []
    .concat(asArray(item.warehouses))
    .concat(asArray(item.inventory));

  // Si hay info por almacén, suma campos típicos por cada almacén
  if (whArrays.length) {
    let sum = 0;
    for (const wh of whArrays) {
      if (!wh || typeof wh !== "object") continue;
      // nombres comunes que he visto en distintas cuentas/esquemas
      const qty = pickNumber(
        wh.available,
        wh.availableQuantity,
        wh.quantity,
        wh.currentQuantity,
        wh.quantityAvailable,
        wh.stock
      );
      sum += qty;
    }
    return sum;
  }

  // Fallback si no vino por almacén
  return pickNumber(
    item.available,
    item.availableQuantity,
    item.currentQuantity,
    item.quantity,
    item.stock
  );
}

// Precio/currency robustos (arreglo u objeto)
function extractPriceAndCurrency(item) {
  const arr = item.prices || item.price;
  if (Array.isArray(arr)) {
    const p0 = arr[0] || {};
    return { price: Number(p0.price) || null, currency: p0.currency || "MXN" };
  }
  if (arr && typeof arr === "object") {
    return { price: Number(arr.price) || null, currency: arr.currency || "MXN" };
  }
  return { price: null, currency: "MXN" };
}

const app = express();
app.use(cors());
app.use(express.json());

const ALEGRA_EMAIL = process.env.ALEGRA_EMAIL;
const ALEGRA_TOKEN = process.env.ALEGRA_TOKEN;
const ALEGRA_BASE  = "https://api.alegra.com/api/v1";

if (!ALEGRA_EMAIL || !ALEGRA_TOKEN) {
  console.warn("[AVISO] Define ALEGRA_EMAIL y ALEGRA_TOKEN en tu archivo .env");
}

function alegraClient() {
  const auth = Buffer.from(`${ALEGRA_EMAIL}:${ALEGRA_TOKEN}`).toString("base64");
  return axios.create({
    baseURL: ALEGRA_BASE,
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    timeout: 15000,
  });
}

async function searchItem(api, sku) {
  // Intento 1: filtro por reference (si tu plan/entorno lo soporta)
  try {
    const r = await api.get(`/items?reference=${encodeURIComponent(sku)}&limit=1`);
    if (Array.isArray(r.data) && r.data.length) return r.data[0];
  } catch (e) {
    // seguimos con fallback
  }
  // Intento 2: búsqueda full-text con q=
  const r2 = await api.get(`/items?q=${encodeURIComponent(sku)}&limit=5`);
  const list = Array.isArray(r2.data) ? r2.data : [];
  const exact = list.find(x => (x.reference || "").toString().toLowerCase() === sku.toLowerCase());
  return exact || list[0] || null;
}

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "vapi-alegra-starter" });
});

// 1) Buscar item por SKU/reference
// 1) Buscar item por SKU/reference (VERSIÓN ROBUSTA)
// 1) Buscar item por SKU/reference (VERSIÓN GRANÍTICA)
// 1) Buscar item por SKU/reference (detecta array u objeto y suma stock correctamente)
app.post("/api/alegra/itemBySKU", async (req, res) => {
  try {
    const { sku } = req.body || {};
    if (!sku) return res.status(400).json({ error: "Falta sku" });

    const api = alegraClient();
    const item = await searchItem(api, sku);
    if (!item) return res.json({ found: false });

    // ===== Helpers =====
    const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
    const asArray = (x) => (Array.isArray(x) ? x : isObj(x) ? [x] : []);

    const pickNumber = (...vals) => {
      for (const v of vals) {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
      }
      return 0;
    };

    const extractPriceAndCurrency = (it) => {
      const arr = it.prices || it.price;
      if (Array.isArray(arr)) {
        const p0 = arr[0] || {};
        const cur = p0.currency;
        return { price: (p0.price != null) ? Number(p0.price) : null,
                 currency: (typeof cur === "object" ? (cur.code || "MXN") : (cur || "MXN")) };
      }
      if (isObj(arr)) {
        const cur = arr.currency;
        return { price: (arr.price != null) ? Number(arr.price) : null,
                 currency: (typeof cur === "object" ? (cur.code || "MXN") : (cur || "MXN")) };
      }
      return { price: null, currency: "MXN" };
    };

    // Extrae cantidad desde un OBJETO de almacén/inventario con nombres variables
    const qtyFromObj = (wh) => {
      if (!isObj(wh)) return 0;
      // Prioridades: current > available > quantity > stock
      const byName = (key) =>
        Object.entries(wh).find(([k]) => k.toLowerCase().includes(key));
      const current = byName("current");            // e.g. currentQuantity
      const avail   = byName("available");          // e.g. availableQuantity
      const quant   = byName("quantity");           // e.g. quantity (ojo: evita initial*)
      const stock   = Object.prototype.hasOwnProperty.call(wh, "stock") ? ["stock", wh.stock] : null;

      // Evita cantidades "initial/min/max"
      const safe = ([k, v]) =>
        k && !k.toLowerCase().includes("initial") &&
        !k.toLowerCase().includes("min") &&
        !k.toLowerCase().includes("max") &&
        Number.isFinite(Number(v));

      const candidates = [current, avail, quant, stock].filter(Boolean).filter(safe);
      if (candidates.length) return Number(candidates[0][1]) || 0;

      // Si no hubo coincidencias por nombre, toma el MAYOR número del objeto (ignorando costos)
      let best = 0;
      for (const [k, v] of Object.entries(wh)) {
        const key = k.toLowerCase();
        if (key.includes("cost")) continue; // ignora costo
        const n = Number(v);
        if (Number.isFinite(n)) best = Math.max(best, n);
      }
      return best;
    };

    const extractStock = (it) => {
      // 1) Si viene como ARRAY de almacenes
      if (Array.isArray(it.warehouses) && it.warehouses.length && isObj(it.warehouses[0])) {
        return it.warehouses.reduce((s, wh) => s + qtyFromObj(wh), 0);
      }
      if (Array.isArray(it.inventory) && it.inventory.length && isObj(it.inventory[0])) {
        return it.inventory.reduce((s, wh) => s + qtyFromObj(wh), 0);
      }

      // 2) Si viene como OBJETO (tu caso)
      if (isObj(it.warehouses)) {
        const q = qtyFromObj(it.warehouses);
        if (q) return q;
      }
      if (isObj(it.inventory)) {
        const q = qtyFromObj(it.inventory);
        if (q) return q;
      }

      // 3) Fallback en el propio item
      return pickNumber(it.currentQuantity, it.availableQuantity, it.available, it.quantity, it.stock);
    };

    const warehouses = [
      ...asArray(item.warehouses),
      ...asArray(item.inventory)
    ];
    const stockTotal = extractStock(item);
    const { price, currency } = extractPriceAndCurrency(item);

    res.json({
      found: true,
      id: item.id,
      name: item.name,
      reference: item.reference,
      codes: item.code || item.codes || null,
      priceBase: price,
      currency,
      stockTotal,
      warehouses,
      customFields: item.customFields || []
    });
  } catch (err) {
    const e = err?.response?.data || err.message;
    res.status(500).json({ error: e });
  }
});


// 2) Buscar cliente por teléfono
// 2) Buscar cliente por teléfono (match EXACTO)
app.post("/api/alegra/customerByPhone", async (req, res) => {
  try {
    const phoneRaw = req.body?.phone || "";
    const phone = (phoneRaw + "").replace(/\D/g, ""); // deja solo dígitos
    if (!phone) return res.json({ found: false });

    const api = alegraClient();

    // Busca candidatos por query (Alegra)
    const q = encodeURIComponent(phone);
    const candidates = await api.get(`/contacts?query=${q}&type=client`);

    const norm = (s) => (s || "").replace(/\D/g, "");
    // Coincidencia EXACTA en phonePrimary / phoneSecondary / mobile
    const match = (Array.isArray(candidates) ? candidates : [])
      .find(c =>
        [c.phonePrimary, c.phoneSecondary, c.mobile]
          .some(p => norm(p) === phone)
      );

    if (!match) {
      return res.json({ found: false });
    }

    // Respuesta minimal (¡ojo! solo datos reales del match)
    res.json({
      found: true,
      id: match.id,
      name: match.name,
      identification: match.identification,
      phonePrimary: match.phonePrimary,
      priceList: match.priceList || null
    });
  } catch (err) {
    const e = err?.response?.data || err?.message;
    res.status(500).json({ error: e });
  }
});

// 3) Precio de un SKU según lista de precios
app.post("/api/alegra/priceForCustomer", async (req, res) => {
  try {
    const { sku, priceListId } = req.body || {};
    if (!sku || !priceListId) return res.status(400).json({ error: "Falta sku o priceListId" });
    const api = alegraClient();

    const item = await searchItem(api, sku);
    if (!item) return res.json({ found: false });

    const priceArr = item.prices || item.price || [];
    const listMatch = priceArr.find(p => `${p?.priceList?.id}` === `${priceListId}`);
    const base = priceArr[0];

    res.json({
      found: true,
      sku: item.reference,
      name: item.name,
      priceForList: listMatch?.price ?? null,
      currency: listMatch?.currency || base?.currency || "MXN",
      fallbackBasePrice: base?.price ?? null
    });
  } catch (err) {
    const e = err?.response?.data || err.message;
    res.status(500).json({ error: e });
  }
});

// 4) Crear factura sencilla
app.post("/api/alegra/createInvoice", async (req, res) => {
  try {
    const { clientId, items, observations } = req.body || {};
    if (!clientId || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "Faltan parámetros: clientId, items[]" });
    }
    const api = alegraClient();

    // Resolver IDs por SKU
    const resolved = [];
    for (const it of items) {
      const item = await searchItem(api, it.sku);
      if (!item) continue;
      resolved.push({
        id: item.id,
        price: it.price,
        quantity: it.quantity
      });
    }
    if (!resolved.length) return res.status(400).json({ error: "Ningún SKU válido" });

    const payload = {
      date: new Date().toISOString().slice(0,10),
      client: { id: clientId },
      items: resolved.map(r => ({ id: r.id, price: r.price, quantity: r.quantity })),
      observations: observations || "Venta generada por agente de voz"
    };

    const { data } = await api.post(`/invoices`, payload);
    res.json({ ok: true, invoice: { id: data.id, number: data.number } });
  } catch (err) {
    const e = err?.response?.data || err.message;
    res.status(500).json({ error: e });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor listo en http://localhost:${PORT}`);
});
