import { lookup } from "node:dns";
import { request } from "node:https";
import { BlockList } from "node:net";
import { merchantInfoDestination, productDestination } from "./destinations.js";

// Connect to the same public address we checked, including on every redirect.
const reserved = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
]) reserved.addSubnet(network, prefix, "ipv4");

function publicAddress(host, options, callback) {
  lookup(host, { family: 4, all: true }, (error, addresses) => {
    const address = addresses?.find((entry) => !reserved.check(entry.address))?.address;
    if (error || !address) return callback(error || new Error("No public storefront address"));
    callback(null, address, 4);
  });
}

export function probeDestination(value, method, signal) {
  return new Promise((resolve, reject) => {
    const url = new URL(value);
    if (!/^[a-z\d.-]+\.[a-z]{2,}$/i.test(url.hostname)) return reject(new Error("Invalid storefront host"));
    const req = request(url, { method, signal, family: 4, lookup: publicAddress, agent: false,
      headers: { Accept: "text/html", "User-Agent": "LivingBlueprint/1.0 (merchant link verification)" } }, (response) => {
      resolve({ status: response.statusCode, location: response.headers.location, contentType: response.headers["content-type"] });
      response.destroy();
    });
    req.on("error", reject);
    req.end();
  });
}

export async function verifyRedirectChain(raw, accepts, probe, signal) {
  const seen = new Set();
  let url = raw;
  try {
    while (accepts(url) && !seen.has(url) && seen.size < 6) {
      seen.add(url);
      // Verify the same HTTP method that a shopper's link uses. Stop reading at the headers.
      const response = await probe(url, "GET", signal);
      if (response.status === 200 && (!response.contentType || /^(?:text\/html|application\/xhtml\+xml)\b/i.test(response.contentType))) return raw;
      if (![301, 302, 303, 307, 308].includes(response.status) || !response.location) break;
      url = new URL(response.location, url).href;
    }
  } catch { /* A failed probe leaves this particular link unavailable. */ }
  return null;
}

// Never probe a URL from the browser. All inputs here have come back from Shop MCP.
export async function verifyResponseDestinations(result, probe, signal, checkoutProducts = []) {
  const products = result.products || (result.product ? [result.product] : []);
  const sellers = [...products, ...checkoutProducts];
  const jobs = [];
  for (const product of products) {
    if (product.productUrl) jobs.push(async () => {
      product.productUrl = await verifyRedirectChain(product.productUrl, url => productDestination(url, product), probe, signal);
    });
    // A catalog /buy permalink starts checkout when visited. Keep its source identity for
    // callers; the shopping UI verifies a fresh create_checkout handoff on buyer action.
  }
  for (const group of [result, ...(result.warnings ?? [])]) {
    if (!group.links?.length) continue;
    const links = group.links;
    for (const link of links) jobs.push(async () => {
      const seller = sellers.find(product => merchantInfoDestination(link.url, product));
      link.url = seller && await verifyRedirectChain(link.url, url => merchantInfoDestination(url, seller), probe, signal);
    });
  }
  async function work() {
    while (jobs.length) await jobs.shift()();
  }
  await Promise.all(Array.from({ length: Math.min(8, jobs.length) }, work));
  for (const group of [result, ...(result.warnings ?? [])]) {
    if (group.links) group.links = group.links.filter(link => link.url);
  }
  return result;
}
