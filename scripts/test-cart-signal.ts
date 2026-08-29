// Testes do endpoint/validação do sinal + segurança do bundle.
import { readFileSync, existsSync } from "node:fs";
import { parseCartSignal } from "../lib/storefront/cartSignal";

let pass = 0;
let fail = 0;
function check(label: string, got: boolean) {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}`);
  got ? pass++ : fail++;
}

async function main() {
  // ---- Validação (payload UNTRUSTED: storeId+cartId obrigatórios) ----
  check("válido ACTIVITY", parseCartSignal({ storeId: "s1", cartId: "c1", phase: "ACTIVITY" }).ok === true);
  check("válido com storeDomain/clientAt", parseCartSignal({ storeId: "s1", cartId: "c1", phase: "COMPLETED", storeDomain: "x.y", clientAt: 5 }).ok === true);
  check("falta storeId => rejeitado", parseCartSignal({ cartId: "c1", phase: "ACTIVITY" }).ok === false);
  check("falta cartId => rejeitado", parseCartSignal({ storeId: "s1", phase: "ACTIVITY" }).ok === false);
  check("phase inválida => rejeitado", parseCartSignal({ storeId: "s1", cartId: "c1", phase: "HACK" }).ok === false);
  check("campo extra (strict) => rejeitado", parseCartSignal({ storeId: "s1", cartId: "c1", phase: "ACTIVITY", email: "a@b.c" }).ok === false);

  // ---- 12) bundle NubeSDK sem segredos e sem window/document/React ----
  {
    const forbiddenSecrets = ["CLIENT_SECRET", "ACCESS_TOKEN", "CRON_SECRET", "INTERNAL_DISPATCH_SECRET", "META_APP_SECRET", "PRIVATE_KEY", "process.env"];
    const forbiddenApis = ["window", "document", "jQuery", "innerHTML", "createElement", "react"];
    const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

    const srcCode = stripComments(readFileSync("nubesdk/src/main.ts", "utf8"));
    check("12 fonte do worker sem segredos", forbiddenSecrets.every((s) => !srcCode.includes(s)));
    check("12 fonte do worker sem window/document/React", forbiddenApis.every((s) => !srcCode.includes(s)));

    const bundlePath = "nubesdk/dist/main.min.js";
    if (existsSync(bundlePath)) {
      const bundle = readFileSync(bundlePath, "utf8");
      check("12 bundle buildado sem segredos", forbiddenSecrets.filter((s) => s !== "process.env").every((s) => !bundle.includes(s)));
      check("12 bundle buildado sem window/document/React", forbiddenApis.every((s) => !bundle.includes(s)));
    } else {
      console.log("SKIP  12 bundle não buildado (rode: cd nubesdk && npm run build)");
    }
  }

  // ---- 13) endpoint sem operação privilegiada + autoridade server-side ----
  {
    const route = readFileSync("app/api/storefront/cart-signal/route.ts", "utf8");
    // Nota: o endpoint usa store.accessToken SERVER-SIDE só para GET /store
    // (validar a loja, bloqueador 1) — leitura, não operação privilegiada.
    const privileged = ["sendWhatsapp", "sendEmail", "applyTag", "triggerWebhook", "dispatchJob", "enrollCartInFlows", "CRON_SECRET"];
    check("13 endpoint sem envio/enroll/segredo de servidor", privileged.every((s) => !route.includes(s)));
    check("13 endpoint nao devolve o accessToken na resposta", !/NextResponse\.json\([^)]*accessToken/.test(route));
    check("13 endpoint valida payload (zod)", route.includes("parseCartSignal"));
    check("13 endpoint usa tempo do servidor (Date.now)", route.includes("Date.now()"));
    check("13 endpoint atualiza terminal atomicamente (transaction)", route.includes("runTransaction"));
    check("13 endpoint valida tenant-origin (originMatchesStore)", route.includes("originMatchesStore"));
    check("13 endpoint checa loja ativa (storeRef)", route.includes("storeRef(storeId)"));
    check("13 endpoint usa identidade hash store-scoped (cartKeyHash)", route.includes("cartKeyHash(cartId)"));
    // Bloqueador 1: cold-start fechado -> GET /store server-side + fail-closed.
    check("1 endpoint busca dominios via GET /store (getStore)", route.includes(".getStore()"));
    check("1 endpoint respeita frescor do cache (isDomainsCacheFresh)", route.includes("isDomainsCacheFresh"));
    check("1 endpoint FAIL CLOSED (403 no catch do getStore)", /catch\s*\{[\s\S]*?status:\s*403/.test(route));
    check("1 endpoint NAO usa sufixo generico como prova de tenant", !route.includes("isAllowedOrigin"));
  }

  // ---- P0: cart_signals e somente telemetria, sem caminho comercial ----
  {
    const vercelConfig = readFileSync("vercel.json", "utf8");
    const cronRoute = readFileSync("app/api/cron/cart-signals/route.ts", "utf8");
    const storefrontRoute = readFileSync("app/api/storefront/cart-signal/route.ts", "utf8");
    const forbiddenCommercialOperations = [
      "collectionGroup",
      "listCheckouts",
      "syncAbandonedCheckout",
      "enrollCartOnce",
      "cart_enrollments",
      "enrollments",
      "jobs",
    ];

    check(
      "P0 vercel nao agenda cron comercial de cart_signals",
      !vercelConfig.includes("/api/cron/cart-signals"),
    );
    check("P0 rota cron esta disabled", cronRoute.includes("disabled"));
    check(
      "P0 rota cron declara telemetria only",
      cronRoute.includes("cart_signals_telemetry_only"),
    );
    check(
      "P0 rota cron nao contem operacoes comerciais",
      forbiddenCommercialOperations.every((operation) => !cronRoute.includes(operation)),
    );
    check(
      "P0 storefront continua persistindo cart_signals",
      storefrontRoute.includes('col(storeId, "cart_signals")'),
    );
    check(
      "P0 storefront continua sem efeitos comerciais",
      forbiddenCommercialOperations
        .filter((operation) => operation !== "collectionGroup")
        .every((operation) => !storefrontRoute.includes(operation)),
    );
  }

  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
