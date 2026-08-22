import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST obrigatorio");
}

initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? "demo-nuvem-rush-webhook-inbox" });

async function main() {
  const db = getFirestore();
  const { firestoreWebhookInboxRepository: repository } = await import("../lib/webhooks/inbox.firestore");
  const { eventKey } = await import("../lib/webhooks/idempotency");
  const { WEBHOOK_INBOX_LEASE_MS } = await import("../lib/webhooks/inbox");

  let passed = 0;
  const check = (label: string, condition: boolean) => {
    if (!condition) throw new Error(`FAIL ${label}`);
    console.log(`PASS  ${label}`);
    passed++;
  };

  for (const storeId of ["store-a", "store-b", "store-inactive"]) {
    await db.recursiveDelete(db.doc(`stores/${storeId}`));
  }
  await db.doc("stores/store-a").set({ status: "active" });
  await db.doc("stores/store-b").set({ status: "active" });
  await db.doc("stores/store-inactive").set({ status: "uninstalled" });

  const key = eventKey("order/paid", "order-1");
  const input = {
    storeId: "store-a",
    key,
    event: "order/paid" as const,
    resourceId: "order-1",
    receivedAt: 1_000,
  };
  const concurrent = await Promise.all([
    repository.receive(input),
    repository.receive(input),
  ]);
  check("duplicate concorrente cria um envelope", concurrent.filter((r) => r === "created").length === 1
    && concurrent.filter((r) => r === "duplicate").length === 1
    && (await db.collection("stores/store-a/webhook_inbox").get()).size === 1);

  const envelope = (await db.doc(`stores/store-a/webhook_inbox/${key}`).get()).data()!;
  const allowed = [
    "attempts", "claimedAt", "completedAt", "event", "lastError", "leaseId",
    "nextAttemptAt", "receivedAt", "resourceId", "status",
  ];
  check("envelope persiste somente campos permitidos", Object.keys(envelope).sort().join(",") === allowed.sort().join(","));
  check("inbox nao persiste payload/PII", !/(email|phone|customer|rawPayload|orderJson)/i.test(JSON.stringify(envelope)));

  const otherStore = await repository.receive({ ...input, storeId: "store-b" });
  check("identidade e tenant-scoped", otherStore === "created"
    && (await db.doc(`stores/store-b/webhook_inbox/${key}`).get()).exists);

  const inactiveKey = eventKey("order/created", "order-inactive");
  const inactive = await repository.receive({
    storeId: "store-inactive",
    key: inactiveKey,
    event: "order/created",
    resourceId: "order-inactive",
    receivedAt: 1_000,
  });
  check("store inativa descarta sem criar inbox", inactive === "discarded"
    && !(await db.doc(`stores/store-inactive/webhook_inbox/${inactiveKey}`).get()).exists);

  const workerA = await repository.claim({ storeId: "store-a", key, leaseId: "lease-a", now: 2_000 });
  const workerBFresh = await repository.claim({ storeId: "store-a", key, leaseId: "lease-b", now: 2_001 });
  check("lease fresco permite somente um worker", workerA?.envelope.leaseId === "lease-a" && workerBFresh === null);

  const reclaimAt = 2_000 + WEBHOOK_INBOX_LEASE_MS;
  const workerB = await repository.claim({ storeId: "store-a", key, leaseId: "lease-b", now: reclaimAt });
  check("crash processing e recuperado apos expiracao", workerB?.envelope.leaseId === "lease-b"
    && workerB.envelope.attempts === 2);

  const oldComplete = await repository.complete({ storeId: "store-a", key, leaseId: "lease-a", now: reclaimAt + 1 });
  const oldRetry = await repository.retry({
    storeId: "store-a", key, leaseId: "lease-a", now: reclaimAt + 1,
    errorCode: "PROCESSING_RECOVERABLE",
  });
  const completed = await repository.complete({ storeId: "store-a", key, leaseId: "lease-b", now: reclaimAt + 2 });
  const terminal = (await db.doc(`stores/store-a/webhook_inbox/${key}`).get()).data();
  check("fencing bloqueia worker antigo", oldComplete === false && oldRetry.updated === false);
  check("dono atual completa e estado terminal permanece", completed === true && terminal?.status === "completed");

  const retryKey = eventKey("order/fulfilled", "order-retry");
  await repository.receive({
    storeId: "store-a", key: retryKey, event: "order/fulfilled",
    resourceId: "order-retry", receivedAt: 10_000,
  });
  await repository.claim({ storeId: "store-a", key: retryKey, leaseId: "retry-1", now: 10_000 });
  const retry = await repository.retry({
    storeId: "store-a", key: retryKey, leaseId: "retry-1", now: 10_001,
    errorCode: "NUVEMSHOP_TRANSIENT",
  });
  const retryDoc = (await db.doc(`stores/store-a/webhook_inbox/${retryKey}`).get()).data();
  const tooEarly = await repository.claim({
    storeId: "store-a", key: retryKey, leaseId: "retry-2", now: 10_002,
  });
  const due = await repository.claim({
    storeId: "store-a", key: retryKey, leaseId: "retry-2",
    now: Number(retryDoc?.nextAttemptAt),
  });
  check("retry persiste apenas codigo sanitizado e respeita backoff", retry.updated
    && retry.status === "retry" && retryDoc?.lastError === "NUVEMSHOP_TRANSIENT"
    && tooEarly === null && due?.envelope.leaseId === "retry-2");

  console.log(`\n${passed} testes Firestore Emulator da inbox passaram`);
}

main().catch((error: unknown) => {
  console.error("Order webhook inbox Emulator test failed", {
    name: error instanceof Error ? error.name : "unknown",
    message: error instanceof Error ? error.message : "unknown",
  });
  process.exitCode = 1;
});
