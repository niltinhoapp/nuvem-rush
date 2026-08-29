import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NuvemshopApiError, NuvemshopRequestError } from "../lib/nuvemshop/client";
import { runWithFinalCommercialGuard } from "../lib/dispatch/finalGuard";
import { classifyWebhookWorkerError } from "../lib/webhooks/worker";
import { isWebhookInboxCronAuthorized } from "../lib/webhooks/cronAuth";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function main() {
  assert.equal(isWebhookInboxCronAuthorized(undefined, "Bearer "), false);
  assert.equal(isWebhookInboxCronAuthorized("", "Bearer "), false);
  assert.equal(isWebhookInboxCronAuthorized("   ", "Bearer    "), false);
  assert.equal(isWebhookInboxCronAuthorized("cron-secret", "Bearer invalid"), false);
  assert.equal(isWebhookInboxCronAuthorized("cron-secret", "Bearer cron-secret"), true);

  assert.deepEqual(
    classifyWebhookWorkerError(new NuvemshopApiError(503, true)),
    { action: "retry", code: "NUVEMSHOP_TRANSIENT" },
  );
  assert.deepEqual(
    classifyWebhookWorkerError(new NuvemshopApiError(404, false)),
    { action: "fail", code: "PROCESSING_TERMINAL" },
  );
  assert.deepEqual(
    classifyWebhookWorkerError(new NuvemshopRequestError("timeout", true)),
    { action: "retry", code: "NUVEMSHOP_TRANSIENT" },
  );
  assert.deepEqual(
    classifyWebhookWorkerError({ code: "unavailable" }),
    { action: "retry", code: "FIRESTORE_TRANSIENT" },
  );
  assert.deepEqual(classifyWebhookWorkerError(new Error("store_inactive")), { action: "discard" });

  // Q/M: dispatch ja reivindicou o job, mas cancellation vence antes da
  // guarda final. A guarda relê enrollment e job; provider permanece em zero.
  {
    const reachedBarrier = deferred();
    const resume = deferred();
    const state = { job: "processing", enrollment: "active", providerCalls: 0, quota: 0 };
    const dispatch = (async () => {
      reachedBarrier.resolve();
      await resume.promise;
      const delivery = await runWithFinalCommercialGuard(
        async () => ({
          storeActive: true,
          commercialAccess: true,
          jobProcessing: state.job === "processing",
          enrollmentActive: state.enrollment === "active",
        }),
        async () => { state.providerCalls++; },
      );
      if (delivery.status === "sent" && state.job === "processing") {
        state.job = "sent";
        state.quota++;
      }
    })();
    await reachedBarrier.promise;
    state.enrollment = "cancelled";
    state.job = "cancelled";
    resume.resolve();
    await dispatch;
    assert.equal(state.providerCalls, 0);
    assert.equal(state.job, "cancelled");
    assert.equal(state.quota, 0);
  }

  // O: depois que o provider iniciou nao ha rollback fisico. O estado
  // cancelado e a cota zero sao preservados pela finalizacao Firestore real.
  {
    const providerStarted = deferred();
    const providerDone = deferred();
    const state = { job: "processing", enrollment: "active", providerCalls: 0, quota: 0 };
    const deliveryPromise = runWithFinalCommercialGuard(
      async () => ({ storeActive: true, commercialAccess: true, jobProcessing: true, enrollmentActive: true }),
      async () => {
        state.providerCalls++;
        providerStarted.resolve();
        await providerDone.promise;
      },
    );
    await providerStarted.promise;
    state.enrollment = "cancelled";
    state.job = "cancelled";
    providerDone.resolve();
    const delivery = await deliveryPromise;
    assert.equal(delivery.status, "sent", "provider ja tinha sido invocado");
    assert.equal(state.providerCalls, 1);
    assert.equal(state.job, "cancelled");
    assert.equal(state.quota, 0);
  }

  const cronSource = readFileSync(new URL("../app/api/cron/webhook-inbox/route.ts", import.meta.url), "utf8");
  assert.match(cronSource, /isWebhookInboxCronAuthorized/);
  assert.doesNotMatch(cronSource, /x-store-id|storeId=.*searchParams|NODE_ENV/);
  assert.match(cronSource, /BATCH_SIZE = 5/);

  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
    crons: Array<{ path: string; schedule: string }>;
  };
  assert.deepEqual(
    vercel.crons.find((cron) => cron.path === "/api/cron/webhook-inbox"),
    { path: "/api/cron/webhook-inbox", schedule: "* * * * *" },
  );
  assert.deepEqual(
    vercel.crons.find((cron) => cron.path === "/api/cron/dispatch"),
    { path: "/api/cron/dispatch", schedule: "*/5 * * * *" },
  );

  const processorSource = readFileSync(new URL("../lib/webhooks/orderProcessor.ts", import.meta.url), "utf8");
  const cancellationBranch = processorSource.slice(
    processorSource.indexOf('candidate.envelope.event === "order/cancelled"'),
    processorSource.indexOf("const result = await handleOrderEvent"),
  );
  assert.match(cancellationBranch, /cancelOrderCommercialWork/);
  assert.doesNotMatch(cancellationBranch, /handleOrderEvent|getOrder|syncOrder/);

  const dispatchSource = readFileSync(new URL("../lib/dispatch.ts", import.meta.url), "utf8");
  assert.match(dispatchSource, /enrollmentActive/);
  assert.match(dispatchSource, /provider_completed_not_finalized/);

  const indexConfig = JSON.parse(
    readFileSync(new URL("../firestore.indexes.json", import.meta.url), "utf8"),
  ) as { indexes: Array<{ collectionGroup: string; queryScope: string; fields: unknown[] }> };
  const inboxIndexes = indexConfig.indexes.filter((index) => index.collectionGroup === "webhook_inbox");
  assert.equal(inboxIndexes.length, 3);
  assert.ok(inboxIndexes.every((index) => index.queryScope === "COLLECTION_GROUP"));

  console.log("order webhook worker and safe cancellation: OK");
}

void main();
