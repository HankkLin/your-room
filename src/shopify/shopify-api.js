import { randomUUID } from "node:crypto";
import { createProductCandidate, productCandidateId, shopifyHttpsUrl as httpsUrl } from "../contracts/product.js";
import { recommendProductCandidate } from "../agents/product-recommendation.js";

const endpoint = "https://mcp.shop.com/";
const protocolVersion = "2026-07-28";
const apiPrefix = "/api/shopify/";
const context = { address_country: "US", currency: "USD" };
const maxQueryLength = 200;
const maxRequestBytes = 32 * 1024;
const maxLookupRefs = 50;
const searchLimit = 8;
const totalLabels = {
  subtotal: "Subtotal",
  items_discount: "Item discounts",
  discount: "Discount",
  fulfillment: "Shipping",
  tax: "Tax",
  fee: "Fee",
  total: "Total",
};

class ShopifyApiError extends Error {
  constructor(status, message, details = {}) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function textValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function validCurrency(value) {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value) ? value : null;
}

function readRef(value) {
  if (!productCandidateId(value)) {
    throw new ShopifyApiError(400, "Choose a Shopify variant and merchant from the catalog.");
  }
  return { variantId: value.variantId, sellerDomain: value.sellerDomain };
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function linksFrom(value) {
  return list(value).flatMap((link) => {
    const url = httpsUrl(link?.url);
    const label = textValue(link?.title) ?? textValue(link?.label) ?? textValue(link?.type) ?? "More information";
    return url ? [{ label, url }] : [];
  });
}

function warningsFrom(document, types = ["warning"]) {
  return list(document?.messages).flatMap((message) => {
    const text = textValue(message?.content);
    if (!types.includes(message?.type) || !text) return [];
    const links = linksFrom(message.links);
    const referenceUrl = httpsUrl(message.url);
    if (referenceUrl && !links.some(({ url }) => url === referenceUrl)) {
      links.push({ label: textValue(message.title) ?? "More information", url: referenceUrl });
    }
    const imageUrl = httpsUrl(message.image_url);
    const path = textValue(message.path);
    return [{
      text,
      ...(links.length ? { links } : {}),
      ...(imageUrl ? { imageUrl } : {}),
      ...(path ? { path } : {}),
    }];
  });
}

function retrySeconds(value) {
  const seconds = Number(value);
  return Number.isInteger(seconds) && seconds > 0 && seconds <= 3600 ? seconds : null;
}

function rateLimited(value) {
  const retryAfter = retrySeconds(value);
  return new ShopifyApiError(429, "Shopify is receiving too many requests. Try again shortly.",
    retryAfter ? { retryAfter } : {});
}

function catalogFailure() {
  return new ShopifyApiError(502, "Shopify could not load current product details. Try again.");
}

function checkoutFailure() {
  return new ShopifyApiError(502, "Shopify could not confirm a checkout link. Visit the merchant to continue.", {
    uncertain: true,
  });
}

async function callShopTool(fetchImpl, name, args, signal) {
  const creatingCheckout = name === "create_checkout";
  const failure = creatingCheckout ? checkoutFailure : catalogFailure;
  try {
    signal.throwIfAborted();
    const response = await fetchImpl(endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": protocolVersion,
        "Mcp-Method": "tools/call",
        "Mcp-Name": name,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name,
          arguments: args,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": protocolVersion,
            "io.modelcontextprotocol/clientInfo": { name: "stillroom-studio", version: "0.1.0" },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
      signal,
    });
    if (response.status === 429) throw rateLimited(response.headers.get("Retry-After"));
    if (!response.ok) throw failure();
    const { jsonrpc, id, result, error } = await response.json();
    signal.throwIfAborted();
    if (jsonrpc !== "2.0" || id !== 1 || error || !result) throw failure();

    const document = result.structuredContent;
    if (result.isError || document?.ucp?.status === "error") {
      const info = result._meta?.["com.shopify/error"];
      const codes = list(document?.messages).filter((message) => message?.type === "error")
        .map((message) => message.code);
      if (info?.code === "rate_limited" || codes.includes("rate_limited")) throw rateLimited(info?.retry_after);
      if (name === "get_product" && codes.includes("not_found")) {
        throw new ShopifyApiError(404, "Shopify could not find the selected variant.", { warnings: warningsFrom(document) });
      }
      if (creatingCheckout && codes.includes("out_of_stock")) {
        throw new ShopifyApiError(409, "This variant is no longer available from the merchant.", { warnings: warningsFrom(document) });
      }
      if (creatingCheckout && ["discovery_failed", "upstream_rejected", "upstream_input_required"].includes(info?.code)) {
        throw new ShopifyApiError(502, "This merchant could not create a checkout through Shopify. Visit the merchant to continue.", {
          warnings: warningsFrom(document),
        });
      }
      throw failure();
    }
    if (!document || Array.isArray(document) || typeof document !== "object") throw failure();
    return document;
  } catch (error) {
    if (signal.aborted) {
      const message = creatingCheckout
        ? "Shopify did not confirm the checkout link in time. Visit the merchant to continue."
        : "Shopify took too long to respond. Try again.";
      throw new ShopifyApiError(504, message, creatingCheckout ? { uncertain: true } : {});
    }
    if (error instanceof ShopifyApiError) throw error;
    throw failure();
  }
}

function productsFrom(document) {
  if (!Array.isArray(document.products)) throw catalogFailure();
  return document.products;
}

async function searchProducts(call, { query: rawQuery, modelsOnly }) {
  const query = textValue(rawQuery);
  if (!query || query.length > maxQueryLength) {
    throw new ShopifyApiError(400, `Enter a product search of 1 to ${maxQueryLength} characters.`);
  }
  const document = await call("search_catalog", {
    catalog: { query, context, pagination: { limit: searchLimit },
      ...(modelsOnly === true ? { filters: { media: [{ type: "model_3d" }] } } : {}) },
  });
  const uniqueProducts = new Map();
  for (const item of productsFrom(document)) {
    for (const variant of list(item?.variants)) {
      const product = createProductCandidate(item, variant);
      if (product && !uniqueProducts.has(product.id)) uniqueProducts.set(product.id, product);
      if (uniqueProducts.size >= maxLookupRefs) break;
    }
    if (uniqueProducts.size >= maxLookupRefs) break;
  }
  return { products: [...uniqueProducts.values()], warnings: warningsFrom(document) };
}

async function findVariant(call, ref) {
  const document = await call("get_product", {
    catalog: { id: ref.variantId, context, filters: { available: false } },
  });
  const { product } = document;
  if (!Array.isArray(product?.variants)) throw catalogFailure();

  const key = productCandidateId(ref);
  const warnings = warningsFrom(document);
  for (const variant of product.variants) {
    const candidate = createProductCandidate(product, variant);
    if (candidate?.id === key) return { product: candidate, warnings };
  }
  throw new ShopifyApiError(404, "Shopify could not find this exact variant from the selected merchant.", { warnings });
}

async function lookupProducts(call, { refs: rawRefs }) {
  if (!Array.isArray(rawRefs) || !rawRefs.length || rawRefs.length > maxLookupRefs) {
    throw new ShopifyApiError(400, `Choose between 1 and ${maxLookupRefs} Shopify variants to refresh.`);
  }
  const refs = rawRefs.map(readRef);
  const requested = new Set(refs.map(productCandidateId));
  const ids = [...new Set(refs.map(({ variantId }) => variantId))];
  const document = await call("lookup_catalog", {
    catalog: { ids, context, filters: { available: false } },
  });
  const matches = new Map();
  for (const product of productsFrom(document)) {
    for (const variant of list(product?.variants)) {
      const candidate = createProductCandidate(product, variant);
      const exact = list(variant?.inputs).some((input) => input?.id === candidate?.variantId && input?.match === "exact");
      if (!candidate || !exact) continue;
      const key = candidate.id;
      if (requested.has(key)) matches.set(key, candidate);
    }
  }
  const products = [...requested].map((key) => matches.get(key)).filter(Boolean);
  return { products, warnings: warningsFrom(document) };
}

function readCheckoutLines({ ref, lines }) {
  // Older callers submit a single reference with an implicit quantity of one.
  if (lines === undefined) return [{ ref: readRef(ref), quantity: 1 }];
  if (!Array.isArray(lines) || !lines.length || lines.length > maxLookupRefs) {
    throw new ShopifyApiError(400, `Choose between 1 and ${maxLookupRefs} variants per merchant checkout.`);
  }
  const seen = new Set();
  let merchant;
  return lines.map((line) => {
    const reference = readRef(line?.ref);
    const domain = reference.sellerDomain.toLowerCase();
    if ((merchant && domain !== merchant) || seen.has(reference.variantId)) {
      throw new ShopifyApiError(400, "Group each merchant’s variants and combine repeated quantities.");
    }
    const { quantity, priceMinor, currency } = line;
    if (!Number.isSafeInteger(quantity) || quantity < 1 ||
        !Number.isSafeInteger(priceMinor) || priceMinor < 0 || !validCurrency(currency)) {
      throw new ShopifyApiError(400, "Each variant needs a positive quantity and a confirmed price.");
    }
    seen.add(reference.variantId);
    merchant = domain;
    return { ref: reference, quantity, priceMinor, currency };
  });
}

async function startCheckout(call, input) {
  const lines = readCheckoutLines(input);
  const quotes = await Promise.all(lines.map(({ ref }) => findVariant(call, ref)));
  const warnings = quotes.flatMap((quote) => quote.warnings);
  const products = quotes.map((quote) => quote.product);
  for (const [index, product] of products.entries()) {
    const label = [product.title, product.variantTitle].filter(Boolean).join(" · ");
    const details = { warnings, products };
    if (product.available !== true) {
      throw new ShopifyApiError(409, `Shopify could not confirm that ${label} is in stock.`, details);
    }
    if (product.priceMinor === null || !product.currency) {
      throw new ShopifyApiError(409, `The merchant has not confirmed the price of ${label}.`, details);
    }
    const expected = lines[index];
    if (expected.currency && (expected.currency !== product.currency || expected.priceMinor !== product.priceMinor)) {
      throw new ShopifyApiError(409, `The price of ${label} changed. Review the updated price and start checkout again.`, details);
    }
  }
  const expectedLines = new Map(lines.map((line, index) => [line.ref.variantId, { ...line, product: products[index] }]));
  const document = await call("create_checkout", {
    shop: products[0].sellerDomain,
    checkout: {
      line_items: lines.map(({ ref, quantity }) => ({ item: { id: ref.variantId }, quantity })),
      context: { address_country: context.address_country },
    },
    meta: { "idempotency-key": randomUUID() },
  });
  const continueUrl = httpsUrl(document.continue_url);
  const currency = validCurrency(document.currency);
  if (!continueUrl || !currency || !Array.isArray(document.line_items) ||
      !["incomplete", "requires_escalation", "ready_for_complete"].includes(document.status) ||
      !Array.isArray(document.totals)) {
    throw checkoutFailure();
  }
  for (const line of document.line_items) {
    const id = line?.item?.id;
    const expected = expectedLines.get(id);
    if (!expected || expected.quantity !== line.quantity) throw checkoutFailure();
    if (expected.currency && (expected.currency !== currency ||
        (line.item.price !== undefined && line.item.price !== expected.priceMinor))) {
      warnings.push({ text: `The merchant changed the price or currency for ${expected.product.title} while creating checkout. Review the merchant totals before continuing.` });
    }
    expectedLines.delete(id);
  }
  if (expectedLines.size) throw checkoutFailure();
  const totals = document.totals.map((total) => {
    const label = textValue(total?.display_text) ?? (Object.hasOwn(totalLabels, total?.type) ? totalLabels[total.type] : null);
    if (!label || !Number.isSafeInteger(total.amount)) throw checkoutFailure();
    return { label, amountMinor: total.amount };
  });
  return {
    continueUrl,
    currency,
    totals,
    links: linksFrom(document.links),
    warnings: [...warnings, ...warningsFrom(document, ["warning", "error", "info"])],
  };
}

async function readBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > maxRequestBytes) {
      request.resume();
      throw new ShopifyApiError(413, "The Shopify request is too large.");
    }
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (body && typeof body === "object" && !Array.isArray(body)) return body;
  } catch {
    // The response below covers invalid JSON and invalid request shapes.
  }
  throw new ShopifyApiError(400, "Send a valid Shopify request.");
}

function respond(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

export function createShopifyApiMiddleware({ fetchImpl = fetch, timeoutMs = 12_000, generateRecommendation } = {}) {
  const routes = new Map([
    [`${apiPrefix}search`, searchProducts],
    [`${apiPrefix}recommend`, async (call, input) => {
      const { mode, instruction, kind, objectId } = input;
      if (mode === "replace" && (!textValue(objectId) || objectId.length > 160)) throw new ShopifyApiError(400, "Select the piece to replace.");
      if (!["add", "replace"].includes(mode) || !textValue(instruction) || instruction.length > maxQueryLength ||
          !textValue(kind) || kind.length > 40) throw new ShopifyApiError(400, "Choose furniture and enter a short design instruction.");
      const catalog = await lookupProducts(call, input);
      const choice = await recommendProductCandidate({ mode, instruction, kind, candidates: catalog.products }, generateRecommendation);
      const operation = mode === "replace" ? { type: mode, objectId, productId: choice } : { type: mode, productId: choice };
      return { ...catalog, scenePatch: { operations: [operation] } };
    }],
    [`${apiPrefix}variant`, (call, { ref }) => findVariant(call, readRef(ref))],
    [`${apiPrefix}lookup`, lookupProducts],
    [`${apiPrefix}checkout`, startCheckout],
  ]);

  return async (request, response, next) => {
    const route = routes.get(request.url?.split("?", 1)[0]);
    if (!route) return next();
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      return respond(response, 405, { error: "Send a POST request to the Shopify catalog." });
    }
    const origin = `${request.socket.encrypted ? "https" : "http"}://${request.headers.host}`;
    if (request.headers.origin && request.headers.origin !== origin) {
      return respond(response, 403, { error: "Open Stillroom directly to use the Shopify catalog." });
    }
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] || "")) {
      return respond(response, 415, { error: "Send the Shopify request as JSON." });
    }

    try {
      const body = await readBody(request);
      const signal = AbortSignal.timeout(timeoutMs);
      const call = (name, args) => callShopTool(fetchImpl, name, args, signal);
      const result = await route(call, body);
      respond(response, 200, result);
    } catch (error) {
      if (error instanceof ShopifyApiError || error.name === "ProductRecommendationError") {
        if (error.details?.retryAfter) response.setHeader("Retry-After", String(error.details.retryAfter));
        return respond(response, error.status, { error: error.message, ...error.details });
      }
      respond(response, 500, { error: "The Shopify service could not complete the request." });
    }
  };
}
