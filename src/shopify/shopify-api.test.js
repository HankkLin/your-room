import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createShopifyApiMiddleware } from "./shopify-api.js";

const ref = {
  variantId: "gid://shopify/ProductVariant/12345",
  sellerDomain: "oak-and-co.myshopify.com",
};
const otherRef = { ...ref, variantId: "gid://shopify/ProductVariant/56789" };
const context = { address_country: "US", currency: "USD" };
const productUrl = "https://oak.example/products/table?variant=12345&_gsid=abc%2Fdef&utm_source=shopify";
const checkoutUrl = "https://oak.example/checkouts/cn/opaque-id?key=private%2Ftoken";
const imageUrl = "https://cdn.shopify.com/oak-table.png?v=42";
const warning = {
  type: "warning",
  content: "The display price is for one table.",
  path: "$.products[0]",
  url: "https://oak.example/prices?region=US",
  image_url: "https://oak.example/price-label.png",
};

function catalogVariant(overrides = {}) {
  return {
    id: ref.variantId,
    title: "Natural Oak",
    seller: { domain: ref.sellerDomain, name: "Oak & Co." },
    price: { amount: 45_999, currency: "USD" },
    availability: { available: true },
    media: [{ type: "image", url: imageUrl }],
    url: productUrl,
    ...overrides,
  };
}

function catalogProduct(...variants) {
  return { title: "Oak Coffee Table", variants };
}

function toolResponse(structuredContent, fields = {}) {
  return Response.json({ jsonrpc: "2.0", id: 1, result: { structuredContent, ...fields } });
}

async function requestApi(fetchImpl, {
  route = "search",
  path = `/api/shopify/${route}`,
  input = { query: "oak coffee table" },
  rawBody = JSON.stringify(input),
  method = "POST",
  headers = {},
  timeoutMs,
} = {}) {
  const request = Readable.from([Buffer.from(rawBody)]);
  Object.assign(request, {
    url: path,
    method,
    socket: {},
    headers: {
      host: "127.0.0.1:5173",
      origin: "http://127.0.0.1:5173",
      "content-type": "application/json",
      ...headers,
    },
  });
  const response = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(body) { this.body = body; },
  };
  await createShopifyApiMiddleware({ fetchImpl, timeoutMs })(request, response, () => { response.calledNext = true; });
  if (response.body) response.json = JSON.parse(response.body);
  return response;
}

test("search sends an anonymous Shop MCP request and preserves merchant attribution and warnings", async () => {
  let called = false;
  const response = await requestApi((url, options) => {
    called = true;
    assert.equal(url, "https://mcp.shop.com/");
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers["MCP-Protocol-Version"], "2026-07-28");
    assert.equal(options.headers["Mcp-Method"], "tools/call");
    assert.equal(options.headers["Mcp-Name"], "search_catalog");
    assert.equal(options.headers.Accept, "application/json, text/event-stream");
    assert.equal(options.headers.Authorization, undefined);
    const envelope = JSON.parse(options.body);
    assert.equal(envelope.jsonrpc, "2.0");
    assert.equal(envelope.method, "tools/call");
    assert.equal(envelope.params.name, "search_catalog");
    assert.equal(envelope.params._meta["io.modelcontextprotocol/protocolVersion"], "2026-07-28");
    assert.deepEqual(envelope.params.arguments, {
      catalog: { query: "oak coffee table", context, pagination: { limit: 8 } },
    });

    const item = catalogProduct(catalogVariant());
    return toolResponse({
      products: [item, item, catalogProduct(catalogVariant({ id: "unrecognized id" }))],
      messages: [warning, { type: "info", content: "Private upstream debug information" }],
    });
  }, { input: { query: "  oak coffee table  ", privateHomeAddress: "never forward this" } });

  assert.equal(called, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.deepEqual(response.json, {
    products: [{
      ...ref, id: ref.variantId + "|" + ref.sellerDomain, productId: null,
      deliveryEstimate: null, dimensions: null, dimensionsSource: null,
      title: "Oak Coffee Table",
      variantTitle: "Natural Oak",
      merchant: "Oak & Co.",
      priceMinor: 45_999,
      currency: "USD",
      available: true,
      imageUrl,
      productUrl,
    }],
    warnings: [{
      text: warning.content,
      links: [{ label: "More information", url: warning.url }],
      imageUrl: warning.image_url,
      path: warning.path,
    }],
  });
});

test("variant refresh requires the same variant and seller and allows missing optional details", async () => {
  const exact = catalogVariant({
    title: "Oak Coffee Table",
    options: [{ name: "Finish", label: "Oil" }, { name: "Size", label: "Small" }],
    media: [{ type: "image", url: "javascript:unsafe()" }],
    url: "https://unsafe@oak.example/products/table",
    price: null,
    availability: { available: false },
  });
  const wrongVariant = catalogVariant({ id: otherRef.variantId });
  const wrongSeller = catalogVariant({ seller: { domain: "other.myshopify.com" } });
  const response = await requestApi((_, options) => {
    const { name, arguments: args } = JSON.parse(options.body).params;
    assert.equal(name, "get_product");
    assert.deepEqual(args, { catalog: { id: ref.variantId, context, filters: { available: false } } });
    return toolResponse({ product: {
      ...catalogProduct(wrongVariant, wrongSeller, exact),
      media: [{ type: "image", url: imageUrl }],
    } });
  }, { route: "variant", input: { ref } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json.product, {
    ...ref, id: ref.variantId + "|" + ref.sellerDomain, productId: null,
    deliveryEstimate: null, dimensions: null, dimensionsSource: null,
    title: "Oak Coffee Table",
    variantTitle: "Oil / Small",
    merchant: "Oak & Co.",
    priceMinor: null,
    currency: null,
    available: false,
    imageUrl,
    productUrl: null,
  });

  const mismatch = await requestApi(() => toolResponse({ product: catalogProduct(wrongVariant, wrongSeller) }), {
    route: "variant", input: { ref },
  });
  assert.equal(mismatch.statusCode, 404);
  assert.match(mismatch.json.error, /exact variant/);
});

test("lookup returns only exact, same-seller variant matches in saved order", async () => {
  const featured = catalogVariant({
    id: otherRef.variantId,
    inputs: [{ id: otherRef.variantId, match: "featured" }],
  });
  const wrongSeller = catalogVariant({
    id: otherRef.variantId,
    seller: { domain: "other.myshopify.com", name: "Wrong Seller" },
    inputs: [{ id: otherRef.variantId, match: "exact" }],
  });
  const exact = catalogVariant({ inputs: [{ id: ref.variantId, match: "exact" }] });
  const exactOther = { ...featured, inputs: [{ id: otherRef.variantId, match: "exact" }] };
  const response = await requestApi((_, options) => {
    const { name, arguments: args } = JSON.parse(options.body).params;
    assert.equal(name, "lookup_catalog");
    assert.deepEqual(args.catalog, {
      ids: [otherRef.variantId, ref.variantId], context, filters: { available: false },
    });
    return toolResponse({ products: [catalogProduct(exact, exactOther, featured, wrongSeller)] });
  }, { route: "lookup", input: { refs: [otherRef, ref, ref] } });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json.products.map(({ variantId, sellerDomain }) => ({ variantId, sellerDomain })), [otherRef, ref]);

  const fallback = await requestApi(() => toolResponse({ products: [catalogProduct(featured, wrongSeller)] }), {
    route: "lookup", input: { refs: [otherRef] },
  });
  assert.deepEqual(fallback.json.products, []);
});

function checkoutDocument(overrides = {}) {
  return {
    id: "private-checkout-id",
    status: "requires_escalation",
    continue_url: checkoutUrl,
    currency: "CAD",
    line_items: [{ item: { id: ref.variantId }, quantity: 1 }],
    totals: [
      { type: "subtotal", amount: 58_000 },
      { type: "discount", display_text: "Sale discount", amount: -100 },
      { type: "total", amount: 57_900 },
    ],
    links: [{ type: "privacy_policy", title: "Privacy policy", url: "https://oak.example/policy" }],
    messages: [{ type: "warning", content: "The merchant confirms delivery at checkout." }],
    ...overrides,
  };
}

test("checkout refreshes the exact variant, creates one merchant checkout, and returns only handoff fields", async () => {
  const keys = new Set();
  for (let attempt = 0; attempt < 2; attempt++) {
    const tools = [];
    const response = await requestApi((_, options) => {
      const { name, arguments: args } = JSON.parse(options.body).params;
      tools.push(name);
      if (name === "get_product") return toolResponse({ product: catalogProduct(catalogVariant()) });

      assert.equal(name, "create_checkout");
      assert.deepEqual(args.checkout, {
        line_items: [{ item: { id: ref.variantId }, quantity: 1 }],
        context: { address_country: "US" },
      });
      assert.equal(args.shop, ref.sellerDomain);
      assert.match(args.meta["idempotency-key"], /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
      keys.add(args.meta["idempotency-key"]);
      return toolResponse(checkoutDocument());
    }, { route: "checkout", input: { ref, quantity: 100, email: "should-not-be-sent" } });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(tools, ["get_product", "create_checkout"]);
    assert.deepEqual(response.json, {
      continueUrl: checkoutUrl,
      currency: "CAD",
      totals: [
        { label: "Subtotal", amountMinor: 58_000 },
        { label: "Sale discount", amountMinor: -100 },
        { label: "Total", amountMinor: 57_900 },
      ],
      links: [{ label: "Privacy policy", url: "https://oak.example/policy" }],
      warnings: [{ text: "The merchant confirms delivery at checkout." }],
    });
    assert.equal(response.headers["Cache-Control"], "no-store");
  }
  assert.equal(keys.size, 2);
});

test("checkout stops for unavailable variants and protects checkout capabilities on upstream failure", async () => {
  const tools = [];
  const unavailable = await requestApi((_, options) => {
    tools.push(JSON.parse(options.body).params.name);
    return toolResponse({ product: catalogProduct(catalogVariant({ availability: { available: false } })) });
  }, { route: "checkout", input: { ref } });
  assert.equal(unavailable.statusCode, 409);
  assert.deepEqual(tools, ["get_product"]);

  const badResponses = [
    () => toolResponse(checkoutDocument({ line_items: [{ item: { id: otherRef.variantId }, quantity: 1 }] })),
    () => toolResponse(checkoutDocument({ status: "completed" })),
    () => toolResponse(checkoutDocument({ continue_url: `http://oak.example/private-checkout-id` })),
    () => toolResponse(undefined, {
      isError: true,
      content: [{ type: "text", text: `Ambiguous result from ${checkoutUrl}` }],
      _meta: { "com.shopify/error": { code: "ambiguous_outcome", continue_url: checkoutUrl } },
    }),
  ];
  for (const badResponse of badResponses) {
    let creations = 0;
    const response = await requestApi((_, options) => {
      if (JSON.parse(options.body).params.name === "get_product") {
        return toolResponse({ product: catalogProduct(catalogVariant()) });
      }
      creations++;
      return badResponse();
    }, { route: "checkout", input: { ref } });
    assert.equal(response.statusCode, 502);
    assert.equal(creations, 1);
    assert.doesNotMatch(response.body, /opaque-id|private-checkout-id|private%2Ftoken/);
  }
});

test("invalid requests and unrelated paths never call Shop MCP", async () => {
  let calls = 0;
  const upstream = () => { calls++; };
  const invalid = [
    [{ input: { query: "  " } }, 400],
    [{ input: { query: "a".repeat(201) } }, 400],
    [{ rawBody: "[" }, 400],
    [{ rawBody: "a".repeat(32 * 1024 + 1) }, 413],
    [{ route: "checkout", input: { ref: { ...ref, sellerDomain: "https://oak.example/path" } } }, 400],
    [{ route: "variant", input: { ref: { ...ref, variantId: "https://oak.example/path" } } }, 400],
    [{ route: "lookup", input: { refs: Array(51).fill(ref) } }, 400],
    [{ method: "GET" }, 405],
    [{ headers: { "content-type": "text/plain" } }, 415],
    [{ headers: { origin: "https://cross-origin.example" } }, 403],
  ];
  for (const [input, status] of invalid) {
    const response = await requestApi(upstream, input);
    assert.equal(response.statusCode, status);
    assert.equal(typeof response.json.error, "string");
  }
  const unrelated = await requestApi(upstream, { path: "/api/personas/generate" });
  assert.equal(unrelated.calledNext, true);
  assert.equal(calls, 0);
});

test("Shop MCP HTTP throttling, tool throttling, malformed data and timeouts return safe errors", async () => {
  const throttles = [
    () => new Response(null, { status: 429, headers: { "Retry-After": "30" } }),
    () => toolResponse(undefined, {
      isError: true,
      _meta: { "com.shopify/error": { code: "rate_limited", retry_after: 30 } },
    }),
  ];
  for (const throttle of throttles) {
    const response = await requestApi(throttle);
    assert.equal(response.statusCode, 429);
    assert.equal(response.headers["Retry-After"], "30");
    assert.equal(response.json.retryAfter, 30);
  }

  for (const failure of [
    () => toolResponse({ unexpected: "private raw message" }),
    () => new Response("private raw message", { status: 200 }),
    () => Response.json({ jsonrpc: "2.0", id: 1, error: { message: "private raw message" } }),
  ]) {
    const response = await requestApi(failure);
    assert.equal(response.statusCode, 502);
    assert.doesNotMatch(response.body, /private raw message/);
  }

  const timeout = await requestApi((_, { signal }) => delay(100, null, { signal }), { timeoutMs: 5 });
  assert.equal(timeout.statusCode, 504);
  assert.match(timeout.json.error, /too long/);
});
