import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST obrigatorio");
}

initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? "demo-nuvem-rush-webhook-worker" });

async function main() {
  const db = getFirestore();
  const { firestoreWebhookInboxRepository: repository } = await import("../lib/webhooks/inbox.firestore");
  const { processWebhookInboxBatch } = await import("../lib/webhooks/worker");
  const { firestoreOrderWebhookProcessor } = await import("../lib/webhooks/orderProcessor");
  const { eventKey } = await import("../lib/webhooks/idempotency");
  const { WEBHOOK_INBOX_LEASE_MS } = await import("../lib/webhooks/inbox");
  const { NuvemshopClient } = await import("../lib/nuvemshop/client");
  const { syncOrder } = await import("../lib/nuvemshop/sync");

  let passed = 0;
  const check = (label: string, condition: boolean) => {
    if (!condition) throw new Error(`FAIL ${label}`);
    console.log(`PASS  ${label}`);
    passed++;
  };

  const stores = [
    "worker-paid", "worker-crash", "worker-lease", "worker-concurrent",
    "worker-uninstalled", "worker-redacting", "worker-redacted", "worker-cancel",
  ];
  for (const storeId of stores) await db.recursiveDelete(db.doc(`stores/${storeId}`));

  async function seedStore(storeId: string, status = "active", withFlow = false) {
    await db.doc(`stores/${storeId}`).set({
      status,
      accessToken: "fixture-token-never-sent",
      quotas: {
        periodKey: "2026-08",
        dispatchesMonthUsed: 0,
        dispatchesMonthLimit: 100,
        whatsappMonthUsed: 0,
        whatsappMonthLimit: 100,
      },
    });
    if (withFlow) {
      await db.doc(`stores/${storeId}/flows/flow-paid`).set({
        flowId: "flow-paid",
        name: "Fixture paid",
        status: "active",
        trigger: { event: "order_paid", match: "all", conditions: [] },
        steps: [{ delay: { value: 10, unit: "minutes" }, action: "email" }],
        stats: { enrolled: 0, sent: 0, failed: 0 },
        createdAt: 1,
      });
    }
  }

  async function receive(
    storeId: string,
    event: "order/created" | "order/paid" | "order/fulfilled" | "order/cancelled",
    resourceId: string,
    now: number,
  ) {
    const key = eventKey(event, resourceId);
    const result = await repository.receive({ storeId, key, event, resourceId, receivedAt: now });
    return { key, result };
  }

  let orderApiCalls = 0;
  const originalGetOrder = NuvemshopClient.prototype.getOrder;
  NuvemshopClient.prototype.getOrder = async function (orderId: string) {
    orderApiCalls++;
    return {
      id: orderId,
      customer: { id: `customer-${orderId}`, name: "Fixture", email: `fixture-${orderId}@example.test` },
      total: "100",
      products: [],
    };
  };

  try {
    // A/F: received -> claim -> sync -> enrollment/job deterministico -> complete.
    await seedStore("worker-paid", "active", true);
    const paid = await receive("worker-paid", "order/paid", "order-1", 1_000);
    const paidStats = await processWebhookInboxBatch({
      repository, processor: firestoreOrderWebhookProcessor, batchSize: 5, now: 2_000,
      leaseIdFactory: () => "paid-lease",
    });
    const paidEnvelope = (await db.doc(`stores/worker-paid/webhook_inbox/${paid.key}`).get()).data();
    const paidEnrollments = await db.collection("stores/worker-paid/enrollments").get();
    const paidJobs = await db.collection("stores/worker-paid/jobs").get();
    check("A received -> claim -> complete", paidStats.completed === 1 && paidEnvelope?.status === "completed");
    check("F order/paid sincroniza e cria enrollment/job", orderApiCalls === 1
      && paidEnrollments.size === 1 && paidJobs.size === 1);

    // G: duplicata nao reabre envelope nem duplica efeitos comerciais.
    const duplicate = await receive("worker-paid", "order/paid", "order-1", 3_000);
    await processWebhookInboxBatch({ repository, processor: firestoreOrderWebhookProcessor, batchSize: 5, now: 3_000 });
    check("G duplicate webhook mantem efeitos unicos", duplicate.result === "duplicate"
      && (await db.collection("stores/worker-paid/enrollments").get()).size === 1
      && (await db.collection("stores/worker-paid/jobs").get()).size === 1
      && orderApiCalls === 1);

    // B/C/H: crash depois de sync -> retry futuro nao roda; due completa sem duplicar jobs.
    await seedStore("worker-crash", "active", true);
    const crash = await receive("worker-crash", "order/paid", "order-crash", 10_000);
    let crashOnce = true;
    const partialProcessor = {
      async process(candidate: { storeId: string; envelope: { resourceId: string } }) {
        if (crashOnce) {
          crashOnce = false;
          await syncOrder(candidate.storeId, "fixture-token-never-sent", candidate.envelope.resourceId, "paid");
          throw new Error("recoverable_fixture");
        }
        return firestoreOrderWebhookProcessor.process(candidate as never);
      },
    };
    const firstCrash = await processWebhookInboxBatch({
      repository, processor: partialProcessor, batchSize: 5, now: 10_000,
      leaseIdFactory: () => "crash-1",
    });
    const retryEnvelope = (await db.doc(`stores/worker-crash/webhook_inbox/${crash.key}`).get()).data();
    const future = await processWebhookInboxBatch({
      repository, processor: partialProcessor, batchSize: 5, now: Number(retryEnvelope?.nextAttemptAt) - 1,
      leaseIdFactory: () => "crash-early",
    });
    const recovered = await processWebhookInboxBatch({
      repository, processor: partialProcessor, batchSize: 5, now: Number(retryEnvelope?.nextAttemptAt),
      leaseIdFactory: () => "crash-2",
    });
    check("B erro recuperavel agenda retry", firstCrash.retried === 1 && retryEnvelope?.status === "retry");
    check("C retry futuro nao processa", future.listed === 0);
    check("H retry apos efeito parcial nao duplica enrollment/job", recovered.completed === 1
      && (await db.collection("stores/worker-crash/enrollments").get()).size === 1
      && (await db.collection("stores/worker-crash/jobs").get()).size === 1);

    // D: processing orfao e retomado pelo worker.
    await seedStore("worker-lease");
    const lease = await receive("worker-lease", "order/created", "order-lease", 20_000);
    await repository.claim({ storeId: "worker-lease", key: lease.key, leaseId: "dead", now: 20_000 });
    let leaseProcesses = 0;
    const leaseStats = await processWebhookInboxBatch({
      repository,
      processor: { async process() { leaseProcesses++; return "completed"; } },
      batchSize: 5,
      now: 20_000 + WEBHOOK_INBOX_LEASE_MS,
      leaseIdFactory: () => "recovered",
    });
    check("D processing lease expired e reclaimado", leaseStats.completed === 1 && leaseProcesses === 1);

    // E: dois cron workers concorrentes convergem para um processamento.
    await seedStore("worker-concurrent");
    await receive("worker-concurrent", "order/created", "order-concurrent", 30_000);
    let concurrentProcesses = 0;
    const slowProcessor = {
      async process() {
        concurrentProcesses++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return "completed" as const;
      },
    };
    await Promise.all([
      processWebhookInboxBatch({ repository, processor: slowProcessor, batchSize: 5, now: 30_000, leaseIdFactory: () => "w1" }),
      processWebhookInboxBatch({ repository, processor: slowProcessor, batchSize: 5, now: 30_000, leaseIdFactory: () => "w2" }),
    ]);
    check("E two workers executam um processamento", concurrentProcesses === 1);

    // I/J/K: recebido enquanto ativo, store muda antes do worker -> discard e zero API.
    const beforeInactiveCalls = orderApiCalls;
    for (const [storeId, status] of [
      ["worker-uninstalled", "uninstalled"],
      ["worker-redacting", "redacting"],
      ["worker-redacted", "redacted"],
    ] as const) {
      await seedStore(storeId);
      const item = await receive(storeId, "order/paid", `order-${status}`, 40_000);
      await db.doc(`stores/${storeId}`).update({ status });
      const stats = await processWebhookInboxBatch({
        repository, processor: firestoreOrderWebhookProcessor, batchSize: 5, now: 40_000,
        leaseIdFactory: () => `lease-${status}`,
      });
      const terminal = (await db.doc(`stores/${storeId}/webhook_inbox/${item.key}`).get()).data();
      check(`${status} descarta envelope`, stats.discarded === 1 && terminal?.status === "discarded");
    }
    check("I/J/K store inativa nao chama API externa", orderApiCalls === beforeInactiveCalls);

    // L/N: cancellation usa orderId, cancela scheduled/processing e preserva historico.
    await seedStore("worker-cancel");
    await db.doc("stores/worker-cancel/enrollments/enroll-cancel").set({
      enrollmentId: "enroll-cancel", flowId: "flow-x", contactId: "contact-x",
      orderId: "order-cancel", currentStep: 0, status: "active", startedAt: 1,
    });
    for (const status of ["scheduled", "processing", "sent", "failed"] as const) {
      await db.doc(`stores/worker-cancel/jobs/job-${status}`).set({
        jobId: `job-${status}`, storeId: "worker-cancel", enrollmentId: "enroll-cancel",
        flowId: "flow-x", stepIndex: 0, channel: "email", runAt: 1, status,
      });
    }
    const beforeCancelCalls = orderApiCalls;
    const cancel = await receive("worker-cancel", "order/cancelled", "order-cancel", 50_000);
    const cancelStats = await processWebhookInboxBatch({
      repository, processor: firestoreOrderWebhookProcessor, batchSize: 5, now: 50_000,
      leaseIdFactory: () => "cancel-lease",
    });
    const jobs = Object.fromEntries((await db.collection("stores/worker-cancel/jobs").get()).docs
      .map((doc) => [doc.id, doc.data()]));
    const cancelEnvelope = (await db.doc(`stores/worker-cancel/webhook_inbox/${cancel.key}`).get()).data();
    check("L cancellation completa envelope e cancela scheduled/processing", cancelStats.completed === 1
      && cancelEnvelope?.status === "completed"
      && jobs["job-scheduled"]?.status === "cancelled"
      && jobs["job-processing"]?.status === "cancelled"
      && jobs["job-processing"]?.cancelReason === "order_cancelled");
    check("N sent/failed preservados", jobs["job-sent"]?.status === "sent"
      && jobs["job-failed"]?.status === "failed");
    check("order/cancelled prioritario nao chama GET orders", orderApiCalls === beforeCancelCalls);

    console.log(`\n${passed} testes Firestore Emulator do worker passaram`);
  } finally {
    NuvemshopClient.prototype.getOrder = originalGetOrder;
  }
}

main().catch((error: unknown) => {
  console.error("Order webhook worker Emulator test failed", {
    name: error instanceof Error ? error.name : "unknown",
    message: error instanceof Error ? error.message : "unknown",
  });
  process.exitCode = 1;
});
