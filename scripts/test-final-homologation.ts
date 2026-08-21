import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = process.cwd();
const npmCli = process.env.npm_execpath
  ?? join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const productionFallback = "https://nuvem-rush.vercel.app/api/storefront/cart-signal";
const explicitEndpoint = "https://preview.example.test/api/storefront/cart-signal";
const secretMarkers = [
  "NUVEMSHOP_CLIENT_SECRET",
  "NUVEMSHOP_ACCESS_TOKEN",
  "META_TOKEN",
  "CRON_SECRET",
  "INTERNAL_DISPATCH_SECRET",
  "FIREBASE_ADMIN_CREDENTIALS",
  "PRIVATE_KEY",
];

function buildWorker(endpoint?: string) {
  const env = { ...process.env };
  if (endpoint === undefined) delete env.CART_SIGNAL_ENDPOINT;
  else env.CART_SIGNAL_ENDPOINT = endpoint;

  execFileSync(process.execPath, [npmCli, "run", "build"], {
    cwd: join(root, "nubesdk"),
    env,
    stdio: "pipe",
  });
  return readFileSync(join(root, "nubesdk", "dist", "main.min.js"), "utf8");
}

const terms = readFileSync(join(root, "app", "termos", "page.tsx"), "utf8");
assert.match(terms, /export default function TermosPage/);
assert.match(terms, /href="\/privacidade"/);
assert.match(terms, /href="\/suporte"/);

const support = readFileSync(join(root, "app", "suporte", "page.tsx"), "utf8");
assert.doesNotMatch(support, /desinstalar[\s\S]{0,160}dados s[aã]o removidos/i);
assert.match(support, /desinstalação interrompe o processamento ativo/i);
assert.match(support, /remoção ou\s+anonimização de dados ocorre conforme os processos/i);

const bundleWithoutEndpoint = buildWorker();
assert.equal(bundleWithoutEndpoint.includes(productionFallback), false);
assert.equal(bundleWithoutEndpoint.includes(explicitEndpoint), false);
assert.ok(secretMarkers.every((marker) => !bundleWithoutEndpoint.includes(marker)));

const bundleWithEndpoint = buildWorker(explicitEndpoint);
assert.equal(bundleWithEndpoint.split(explicitEndpoint).length - 1, 1);
assert.equal(bundleWithEndpoint.includes(productionFallback), false);
assert.ok(secretMarkers.every((marker) => !bundleWithEndpoint.includes(marker)));

console.log("PASS  final homologation pages and NubeSDK endpoint build contract");
