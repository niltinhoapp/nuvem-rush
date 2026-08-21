import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST obrigatorio");
}

initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? "demo-nuvem-rush-lgpd" });

async function main() {
  const db = getFirestore();
  const {
    createFirestoreDataRequestRepository,
    firestoreDataRequestRepository,
  } = await import("../lib/lgpd/dataRequest.firestore");
  const { processDataRequest, DATA_REQUEST_DELIVERY_STATUS } = await import("../lib/lgpd/dataRequest");
  const { firestoreCustomerRedactRepository } = await import("../lib/lgpd/firestore");
  const { processCustomerRedact } = await import("../lib/lgpd/customerRedact");
  const { lgpdRequestId } = await import("../lib/lgpd/model");

  let passed = 0;
  const check = (label: string, condition: boolean) => {
    if (!condition) throw new Error(`FAIL ${label}`);
    console.log(`PASS  ${label}`);
    passed++;
  };

  const x = {
    id: "customer-x-private",
    name: "Titular X Private",
    email: "titular-x@example.com",
    phone: "+55 11 96666-1000",
    identification: "DOC-X-PRIVATE",
  };
  const y = {
    id: "customer-y-private",
    name: "Outro Titular Y",
    email: "titular-y@example.com",
    phone: "+55 11 97777-2000",
  };
  const secrets = {
    accessToken: "oauth-token-must-not-export",
    whatsappToken: "whatsapp-token-must-not-export",
    cloudTaskName: "cloud-task-secret-name",
    lastError: "provider-error-private",
    rawPayload: "raw-webhook-payload-private",
    internalHash: "internal-hash-private",
  };

  const payload = (storeId: string, requestId = "request-x") => ({
    event: "customers/data_request" as const,
    store_id: storeId,
    customer: {
      id: x.id,
      email: x.email,
      phone: x.phone,
      identification: x.identification,
    },
    data_request: { id: requestId },
  });

  async function clear(storeId: string) {
    await db.recursiveDelete(db.doc(`stores/${storeId}`));
  }

  async function seed(storeId: string, storeMarker: string) {
    await clear(storeId);
    const store = db.doc(`stores/${storeId}`);
    await store.set({
      status: "active",
      accessToken: secrets.accessToken,
      whatsapp: { accessToken: secrets.whatsappToken },
      plan: "turbo",
      quotas: { dispatchesMonthUsed: 9 },
    });
    await store.collection("contacts").doc("contact-x").set({
      contactId: "contact-x",
      nsCustomerId: x.id,
      name: x.name,
      email: x.email,
      phone: x.phone,
      identification: x.identification,
      tags: ["vip", storeMarker],
      ordersCount: 2,
      totalSpent: 150,
      optOut: false,
      lastOrderAt: 123,
    });
    await store.collection("contacts").doc("contact-y").set({
      contactId: "contact-y",
      nsCustomerId: y.id,
      name: y.name,
      email: y.email,
      phone: y.phone,
      tags: ["foreign-subject"],
      ordersCount: 1,
      totalSpent: 999,
      optOut: false,
      lastOrderAt: 456,
    });
    await store.collection("orders").doc(`order-x-${storeMarker}`).set({
      orderId: `order-x-${storeMarker}`,
      nsOrderId: `ns-order-x-${storeMarker}`,
      contactId: "contact-x",
      total: 100,
      items: [{
        sku: "SKU-X",
        productId: "product-x",
        categoryIds: ["category-x"],
        brand: "Brand X",
        qty: 1,
        price: 100,
      }],
      status: "paid",
      paidAt: 100,
      fulfilledAt: 110,
      shippingStatus: "shipped",
      trackingCode: "TRACK-X",
      trackingUrl: "https://tracking.invalid/x",
    });
    await store.collection("orders").doc("order-y").set({
      orderId: "order-y",
      nsOrderId: "ns-order-y",
      contactId: "contact-y",
      total: 999,
      items: [],
      status: "paid",
    });
    await store.collection("carts").doc(`cart-x-${storeMarker}`).set({
      cartId: `cart-x-${storeMarker}`,
      nsCheckoutId: `checkout-x-${storeMarker}`,
      contactId: "contact-x",
      total: 50,
      items: [],
      recoveryUrl: "https://recovery.invalid/x",
      createdAt: 10,
      abandonedAt: 20,
      status: "abandoned",
    });
    await store.collection("carts").doc("cart-y").set({
      cartId: "cart-y",
      contactId: "contact-y",
      total: 999,
      items: [],
      status: "abandoned",
    });
    await store.collection("enrollments").doc(`enrollment-doc-x-${storeMarker}`).set({
      enrollmentId: `enrollment-x-${storeMarker}`,
      flowId: "flow-x",
      contactId: "contact-x",
      orderId: `order-x-${storeMarker}`,
      cartId: `cart-x-${storeMarker}`,
      currentStep: 2,
      status: "active",
      startedAt: 30,
    });
    await store.collection("enrollments").doc("enrollment-y").set({
      enrollmentId: "enrollment-y",
      flowId: "flow-y",
      contactId: "contact-y",
      status: "active",
      startedAt: 31,
    });
    for (const [id, channel, status] of [
      ["job-sent", "email", "sent"],
      ["job-scheduled", "email", "scheduled"],
      ["job-processing", "whatsapp", "processing"],
      ["job-failed", "whatsapp", "failed"],
      ["job-cancelled", "email", "cancelled"],
    ] as const) {
      await store.collection("jobs").doc(id).set({
        jobId: id,
        storeId,
        enrollmentId: `enrollment-x-${storeMarker}`,
        flowId: "flow-x",
        stepIndex: 0,
        channel,
        runAt: 1,
        status,
        cloudTaskName: secrets.cloudTaskName,
        lastError: secrets.lastError,
      });
    }
    await store.collection("logs").doc("secret-log").set({ payload: secrets.rawPayload });
    await store.collection("lgpd_suppressions").doc(secrets.internalHash).set({ value: true });
    await store.collection("legacy_data").doc("legacy").set({ payload: secrets.rawPayload });
  }

  await seed("store-a", "A");
  await seed("store-b", "B");
  const storeBBefore = JSON.stringify((await db.doc("stores/store-b").get()).data())
    + JSON.stringify((await db.doc("stores/store-b/contacts/contact-x").get()).data());

  const resultA = await processDataRequest(
    firestoreDataRequestRepository,
    payload("store-a"),
    1_000,
  );
  if (resultA.deduped) throw new Error("resultado inicial inesperadamente deduped");
  const exported = resultA.export;
  check("A customer existente exporta contact", exported.contact?.contactId === "contact-x");
  check("A exporta somente orders/carts/enrollments do titular", exported.orders.length === 1
    && exported.carts.length === 1 && exported.enrollments.length === 1);
  check("B jobs viram somente summary agregado", exported.messagingSummary.length === 2
    && exported.messagingSummary.find((row) => row.channel === "email")?.sent === 1
    && exported.messagingSummary.find((row) => row.channel === "email")?.scheduled === 1
    && exported.messagingSummary.find((row) => row.channel === "email")?.cancelled === 1
    && exported.messagingSummary.find((row) => row.channel === "whatsapp")?.scheduled === 1
    && exported.messagingSummary.find((row) => row.channel === "whatsapp")?.failed === 1);
  const exportedJson = JSON.stringify(exported);
  check("I outro titular na mesma store nao aparece", !exportedJson.includes(y.name)
    && !exportedJson.includes(y.email) && !exportedJson.includes(y.phone)
    && !exportedJson.includes(y.id));
  check("J export nao contem secrets nem campos internos", [
    secrets.accessToken,
    secrets.whatsappToken,
    secrets.cloudTaskName,
    secrets.lastError,
    secrets.rawPayload,
    secrets.internalHash,
    "cloudTaskName",
    "lastError",
    "accessToken",
  ].every((value) => !exportedJson.includes(value)));
  check("D export A nao contem marcador comercial de B", !exportedJson.includes("order-x-B")
    && !exportedJson.includes("cart-x-B") && !exportedJson.includes("enrollment-x-B"));
  const storeBAfter = JSON.stringify((await db.doc("stores/store-b").get()).data())
    + JSON.stringify((await db.doc("stores/store-b/contacts/contact-x").get()).data());
  check("L store B permanece inalterada", storeBAfter === storeBBefore);

  const evidenceId = lgpdRequestId(payload("store-a"));
  const evidence = (await db.doc(`stores/store-a/lgpd_requests/${evidenceId}`).get()).data();
  const evidenceJson = JSON.stringify(evidence);
  check("K evidence minima completed sem export/PII", evidence?.status === "completed"
    && evidence?.affected?.contacts === 1
    && Object.values(evidence?.affected ?? {}).every((value) => typeof value === "number")
    && evidence?.contact == null
    && evidence?.orders == null
    && evidence?.carts == null
    && evidence?.enrollments == null
    && evidence?.export == null
    && ![x.name, x.email, x.phone, x.id].some((value) => evidenceJson.includes(value)));

  const duplicate = await processDataRequest(
    firestoreDataRequestRepository,
    payload("store-a"),
    2_000,
  );
  check("F evento duplicado e idempotente", duplicate.deduped && duplicate.export === null);

  await seed("store-empty", "EMPTY");
  const emptyPayload = {
    event: "customers/data_request" as const,
    store_id: "store-empty",
    customer: { id: "missing", email: "missing@example.com" },
    data_request: { id: "request-missing" },
  };
  const empty = await processDataRequest(firestoreDataRequestRepository, emptyPayload, 3_000);
  check("C customer inexistente gera export vazio completed", !empty.deduped
    && empty.export.contact === null && empty.export.orders.length === 0
    && empty.export.carts.length === 0 && empty.export.enrollments.length === 0
    && (await db.doc(`stores/store-empty/lgpd_requests/${lgpdRequestId(emptyPayload)}`).get()).data()?.status === "completed");

  await seed("store-ambiguous", "AMBIGUOUS");
  await db.doc("stores/store-ambiguous/contacts/contact-conflict").set({
    contactId: "contact-conflict",
    nsCustomerId: "different-id",
    name: "Conflicting Person",
    email: x.email,
    phone: "+55 11 98888-3000",
    tags: [],
    ordersCount: 0,
    totalSpent: 0,
    optOut: false,
    lastOrderAt: null,
  });
  await processDataRequest(
    firestoreDataRequestRepository,
    payload("store-ambiguous", "request-ambiguous"),
    3_500,
  ).then(
    () => check("identificadores ambiguos falham closed", false),
    () => check("identificadores ambiguos falham closed", true),
  );

  await seed("store-redacted", "REDACTED");
  const redactPayload = {
    event: "customers/redact" as const,
    store_id: "store-redacted",
    customer: { id: x.id, email: x.email, phone: x.phone },
  };
  await processCustomerRedact(firestoreCustomerRedactRepository, redactPayload, 4_000);
  const afterRedact = await processDataRequest(
    firestoreDataRequestRepository,
    payload("store-redacted", "request-after-redact"),
    5_000,
  );
  if (afterRedact.deduped) throw new Error("data request redacted inesperadamente deduped");
  check("E titular redacted nao tem PII reconstruida", afterRedact.export.contact === null
    && afterRedact.export.orders.length === 0 && afterRedact.export.carts.length === 0
    && afterRedact.export.enrollments.length === 0
    && !JSON.stringify(afterRedact.export).includes(x.email));

  await seed("store-race", "RACE");
  const race = await Promise.allSettled([
    processDataRequest(firestoreDataRequestRepository, payload("store-race", "request-race"), 6_000),
    processDataRequest(firestoreDataRequestRepository, payload("store-race", "request-race"), 6_000),
  ]);
  check("G lease race real permite um processamento", race.filter((item) =>
    item.status === "fulfilled" && !item.value.deduped).length === 1
    && race.filter((item) => item.status === "rejected"
      || (item.status === "fulfilled" && item.value.deduped)).length === 1);

  await seed("store-retry", "RETRY");
  let failOnce = true;
  const failingRepository = createFirestoreDataRequestRepository({
    async afterCompile() {
      if (failOnce) {
        failOnce = false;
        throw new Error("fixture_partial_failure");
      }
    },
  });
  await processDataRequest(
    failingRepository,
    payload("store-retry", "request-retry"),
    7_000,
  ).then(() => check("H partial failure propaga", false), () => check("H partial failure propaga", true));
  const retryId = lgpdRequestId(payload("store-retry", "request-retry"));
  check("H partial failure persiste somente failed sanitizado",
    (await db.doc(`stores/store-retry/lgpd_requests/${retryId}`).get()).data()?.status === "failed");
  const retry = await processDataRequest(
    firestoreDataRequestRepository,
    payload("store-retry", "request-retry"),
    8_000,
  );
  check("H retry completa export integro sem duplicacao", !retry.deduped
    && retry.export.orders.length === 1 && retry.export.carts.length === 1
    && retry.export.enrollments.length === 1
    && (await db.doc(`stores/store-retry/lgpd_requests/${retryId}`).get()).data()?.attempts === 2);

  check("delivery aguarda acesso autenticado pelo dashboard",
    DATA_REQUEST_DELIVERY_STATUS === "DELIVERY_PENDING_AUTHENTICATED_DASHBOARD_ACCESS");
  console.log(`\n${passed} testes customers/data_request no Firestore Emulator passaram`);
}

main().catch((error: unknown) => {
  console.error("LGPD customers/data_request Emulator test failed", {
    name: error instanceof Error ? error.name : "unknown",
    message: error instanceof Error ? error.message : "unknown",
  });
  process.exitCode = 1;
});
