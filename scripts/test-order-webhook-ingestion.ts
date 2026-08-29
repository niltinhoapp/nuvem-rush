import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { verifyHmac } from "../lib/nuvemshop/webhooks";
import { parseSignedWebhookRequest } from "../lib/webhooks/request";
import {
  ingestOrderWebhook,
  webhookInboxRetryPlan,
  WEBHOOK_INBOX_MAX_ATTEMPTS,
  type ReceiveWebhookInput,
  type WebhookInboxRepository,
} from "../lib/webhooks/inbox";

let passed = 0;
function check(label: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL ${label}`);
  console.log(`PASS  ${label}`);
  passed++;
}

function fakeRepository(
  receive: WebhookInboxRepository["receive"],
): WebhookInboxRepository {
  const unsupported = async () => { throw new Error("nao usado neste teste"); };
  return {
    receive,
    listDue: unsupported,
    claim: unsupported,
    complete: unsupported,
    retry: unsupported,
    fail: unsupported,
    discard: unsupported,
  } as WebhookInboxRepository;
}

async function main() {
  const previousSecret = process.env.NUVEMSHOP_CLIENT_SECRET;
  const raw = JSON.stringify({ event: "order/paid", store_id: 10, id: 20 });
  try {
    delete process.env.NUVEMSHOP_CLIENT_SECRET;
    check("secret ausente rejeita HMAC", !verifyHmac(raw, "00".repeat(32)));
    process.env.NUVEMSHOP_CLIENT_SECRET = "";
    check("secret vazio rejeita HMAC", !verifyHmac(raw, "00".repeat(32)));
    process.env.NUVEMSHOP_CLIENT_SECRET = "   ";
    check("secret whitespace rejeita HMAC", !verifyHmac(raw, "00".repeat(32)));

    const secret = "fixture-secret";
    process.env.NUVEMSHOP_CLIENT_SECRET = secret;
    const signature = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
    check("assinatura ausente rejeitada", !verifyHmac(raw, null));
    const invalidSignature = parseSignedWebhookRequest(raw, "00".repeat(32));
    check("assinatura invalida produz 401", !invalidSignature.ok && invalidSignature.status === 401);
    check("assinatura valida aceita payload minimo", parseSignedWebhookRequest(raw, signature).ok);
  } finally {
    if (previousSecret == null) delete process.env.NUVEMSHOP_CLIENT_SECRET;
    else process.env.NUVEMSHOP_CLIENT_SECRET = previousSecret;
  }

  const captured: ReceiveWebhookInput[] = [];
  const seen = new Set<string>();
  const repository = fakeRepository(async (input) => {
    const identity = `${input.storeId}/${input.key}`;
    if (seen.has(identity)) return "duplicate";
    seen.add(identity);
    captured.push(input);
    return "created";
  });
  const first = await ingestOrderWebhook(repository, {
    storeId: "store-a",
    event: "order/paid",
    resourceId: "order-1",
  }, 1_000);
  const duplicate = await ingestOrderWebhook(repository, {
    storeId: "store-a",
    event: "order/paid",
    resourceId: "order-1",
  }, 2_000);
  check("webhook valido persiste inbox e responde 2xx", first.httpStatus === 200 && captured.length === 1);
  check("duplicata responde 2xx e mantem um envelope", duplicate.httpStatus === 200
    && "ok" in duplicate.body && duplicate.body.ok && duplicate.body.deduped && captured.length === 1);

  const serialized = JSON.stringify(captured[0]);
  check("envelope nao contem raw payload nem PII", !serialized.includes("raw")
    && !serialized.includes("email") && !serialized.includes("phone")
    && !serialized.includes("customer"));

  const failed = await ingestOrderWebhook(fakeRepository(async () => {
    throw new Error("firestore unavailable with sensitive detail");
  }), { storeId: "store-a", event: "order/created", resourceId: "order-2" }, 3_000);
  check("falha de persistencia responde 5xx sanitizado", failed.httpStatus === 500
    && JSON.stringify(failed).includes("falha ao persistir evento")
    && !JSON.stringify(failed).includes("sensitive detail"));

  const discarded = await ingestOrderWebhook(fakeRepository(async () => "discarded"), {
    storeId: "inactive",
    event: "order/fulfilled",
    resourceId: "order-3",
  }, 4_000);
  check("store inativa e descartada sem processamento futuro", discarded.httpStatus === 200
    && "ok" in discarded.body && discarded.body.ok && discarded.body.discarded);

  const routeSource = readFileSync(resolve("app/api/webhooks/nuvemshop/route.ts"), "utf8");
  check("rota nao importa nem chama handleOrderEvent", !routeSource.includes("handleOrderEvent"));
  check("rota nao chama syncOrder/getOrder/getProduct", !/(syncOrder|getOrder|getProduct)/.test(routeSource));
  check("rota usa inbox duravel antes do 2xx", routeSource.includes("ingestOrderWebhook")
    && routeSource.includes("firestoreWebhookInboxRepository"));

  const retry = webhookInboxRetryPlan(1, 10_000);
  const terminal = webhookInboxRetryPlan(WEBHOOK_INBOX_MAX_ATTEMPTS, 10_000);
  check("backoff e deterministico e futuro", retry.status === "retry" && retry.nextAttemptAt === 40_000);
  check("retry e limitado por max attempts", terminal.status === "failed" && terminal.nextAttemptAt === null);

  console.log(`\n${passed} testes de ingestao duravel passaram`);
}

main().catch((error: unknown) => {
  console.error("Order webhook ingestion test failed", {
    name: error instanceof Error ? error.name : "unknown",
    message: error instanceof Error ? error.message : "unknown",
  });
  process.exitCode = 1;
});
