import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DATA_REQUEST_DELIVERY_STATUS,
  processDataRequest,
  type DataRequestEvidence,
  type DataRequestExport,
  type DataRequestRepository,
} from "../lib/lgpd/dataRequest";

async function main() {
  const payload = {
    event: "customers/data_request" as const,
    store_id: "store-test",
    customer: { id: "customer-test" },
    data_request: { id: "request-test" },
  };
  const evidence: DataRequestEvidence = {
    requestId: "opaque-request",
    type: "customers/data_request",
    status: "processing",
    attempts: 1,
    receivedAt: 1,
    updatedAt: 1,
    processingAt: 1,
    leaseId: "lease-test",
  };
  const compiled: DataRequestExport = {
    requestId: evidence.requestId,
    storeId: payload.store_id,
    generatedAt: 1,
    contact: null,
    orders: [],
    carts: [],
    enrollments: [],
    messagingSummary: [],
  };
  let completed = false;
  const repository: DataRequestRepository = {
    async begin() { return { action: "process", evidence }; },
    async compile() { return compiled; },
    async complete() { completed = true; },
    async fail() { throw new Error("fail nao esperado"); },
  };
  const result = await processDataRequest(repository, payload, 1);
  assert.equal(result.deduped, false);
  assert.equal(completed, true);

  const duplicate = await processDataRequest({
    ...repository,
    async begin() { return { action: "duplicate", evidence }; },
  }, payload, 2);
  assert.equal(duplicate.deduped, true);
  assert.equal(duplicate.export, null);

  let sanitizedError: string | undefined;
  await processDataRequest({
    ...repository,
    async compile() { throw new Error("raw-private-error"); },
    async fail(_payload, _evidence, errorCode) { sanitizedError = errorCode; },
  }, payload, 3).then(
    () => assert.fail("erro de compilacao deveria propagar"),
    () => undefined,
  );
  assert.equal(sanitizedError, "lgpd_data_request_failed");

  const routeSource = readFileSync("app/api/webhooks/nuvemshop/route.ts", "utf8");
  const serviceSource = readFileSync("lib/lgpd/dataRequest.ts", "utf8");
  const repositorySource = readFileSync("lib/lgpd/dataRequest.firestore.ts", "utf8");
  assert.match(routeSource, /processDataRequest\(firestoreDataRequestRepository/);
  assert.doesNotMatch(routeSource, /registerMinimalLgpdRequest/);
  assert.equal(DATA_REQUEST_DELIVERY_STATUS, "DELIVERY_BLOCKED_BY_OFFICIAL_CONTRACT");
  assert.doesNotMatch(serviceSource + repositorySource, /sendEmail|sendWhatsapp|upload|signedUrl|storageBucket/i);
  assert.doesNotMatch(repositorySource, /accessToken|cloudTaskName|lastError|collection\("logs"\)/);

  console.log("lgpd data request compilation: OK");
}

main().catch((error: unknown) => {
  console.error("lgpd data request unit test failed", {
    name: error instanceof Error ? error.name : "unknown",
    message: error instanceof Error ? error.message : "unknown",
  });
  process.exitCode = 1;
});
