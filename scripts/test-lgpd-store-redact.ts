import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST obrigatorio");
}

initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? "demo-nuvem-rush-lgpd" });

async function main() {
  const db = getFirestore();
  const { processStoreRedact } = await import("../lib/lgpd/storeRedact");
  const {
    createFirestoreStoreRedactRepository,
    firestoreStoreRedactRepository,
  } = await import("../lib/lgpd/storeRedact.firestore");
  const { processCustomerRedact } = await import("../lib/lgpd/customerRedact");
  const { firestoreCustomerRedactRepository } = await import("../lib/lgpd/firestore");
  const { lgpdRequestId } = await import("../lib/lgpd/model");
  const { enrollCartInFlows } = await import("../lib/rules/process");
  const { enrollCartOnce } = await import("../lib/storefront/enrollCartOnce");
  const { firestoreEventClaim } = await import("../lib/webhooks/idempotency.firestore");
  const { saveFlow } = await import("../lib/flows/repo");
  const { handleAppUninstalled } = await import("../lib/lifecycle/uninstall");
  const { syncAbandonedCheckout } = await import("../lib/nuvemshop/carts");
  const { syncOrder } = await import("../lib/nuvemshop/sync");
  const { NuvemshopClient } = await import("../lib/nuvemshop/client");
  const {
    buildStoreInstallData,
    isFirstCommercialInstall,
  } = await import("../lib/nuvemshop/store-install");

  let passed = 0;
  const check = (label: string, condition: boolean) => {
    if (!condition) throw new Error(`FAIL ${label}`);
    console.log(`PASS  ${label}`);
    passed++;
  };

  const pii = {
    name: "Store Redact Person",
    email: "store-redact@example.com",
    phone: "+55 11 96666-5544",
    customerId: "customer-store-redact-123",
    accessToken: "nuvemshop-secret-fixture",
    metaToken: "meta-secret-fixture",
    recoveryUrl: "https://fixture.invalid/recovery-secret",
    payload: "raw-payload-fixture",
  };
  const collections = [
    "flows", "contacts", "products", "orders", "carts", "cart_signals",
    "cart_enrollments", "enrollments", "jobs", "logs", "webhook_events",
    "lgpd_requests", "lgpd_suppressions", "templates", "legacy_data",
  ];
  const storePayload = (storeId: string) => ({
    event: "store/redact" as const,
    store_id: storeId,
  });
  const customerPayload = (storeId: string) => ({
    event: "customers/redact" as const,
    store_id: storeId,
    customer: { id: pii.customerId, email: pii.email, phone: pii.phone },
  });

  async function clear(storeId: string) {
    await db.recursiveDelete(db.collection("stores").doc(storeId));
    await db.collection("lgpd_store_redactions")
      .doc(lgpdRequestId(storePayload(storeId)))
      .delete();
  }

  async function seed(storeId: string) {
    await clear(storeId);
    const store = db.collection("stores").doc(storeId);
    await store.set({
      storeId,
      status: "active",
      accessToken: pii.accessToken,
      scope: "read_orders,write_orders",
      plan: "turbo",
      installedAt: 1,
      originalDomain: `${storeId}.example.invalid`,
      domains: [`${storeId}.example.invalid`],
      quotas: { dispatchesMonthUsed: 9, whatsappMonthUsed: 7 },
      whatsapp: {
        accessToken: pii.metaToken,
        wabaId: "waba-fixture",
        phoneNumberId: "phone-fixture",
        status: "connected",
      },
    });
    await store.collection("contacts").doc(`email:${pii.email}`).set({
      contactId: `email:${pii.email}`,
      nsCustomerId: pii.customerId,
      name: pii.name,
      email: pii.email,
      phone: pii.phone,
      optOut: false,
      tags: [],
      ordersCount: 1,
      totalSpent: 10,
    });
    await store.collection("products").doc("product-1").set({ name: "Product" });
    await store.collection("orders").doc("order-1").set({
      contactId: `email:${pii.email}`,
      nsOrderId: "order-1",
      trackingUrl: pii.recoveryUrl,
    });
    await store.collection("carts").doc("cart-1").set({
      contactId: `email:${pii.email}`,
      recoveryUrl: pii.recoveryUrl,
    });
    await store.collection("cart_signals").doc("signal-1").set({
      status: "pending",
      telemetry: pii.payload,
    });
    await store.collection("cart_enrollments").doc("cart-enrollment-1").set({
      status: "enrolled",
    });
    await store.collection("enrollments").doc("enrollment-1").set({
      enrollmentId: "enrollment-1",
      flowId: "flow-1",
      contactId: `email:${pii.email}`,
      status: "active",
    });
    for (const status of ["scheduled", "processing", "sent"] as const) {
      await store.collection("jobs").doc(`${status}-job`).set({
        jobId: `${status}-job`,
        storeId,
        enrollmentId: "enrollment-1",
        flowId: "flow-1",
        stepIndex: 0,
        channel: "email",
        runAt: 1,
        status,
      });
    }
    await store.collection("logs").doc("log-1").set({ error: pii.email });
    await store.collection("webhook_events").doc("order:1").set({ status: "done" });
    await store.collection("lgpd_requests").doc("legacy-request").set({
      payload: pii.payload,
      email: pii.email,
    });
    await store.collection("lgpd_suppressions").doc("suppression-1").set({
      reason: "customers_redact",
    });
    await store.collection("templates").doc("template-1").set({ html: pii.name });
    await store.collection("legacy_data").doc(`legacy:${pii.email}`).set({
      value: pii.payload,
    });
    await store.collection("flows").doc("flow-1").set({
      flowId: "flow-1",
      name: "Cart flow",
      status: "active",
      trigger: { event: "cart_abandoned", match: "all", conditions: [] },
      steps: [{ delay: { value: 1, unit: "minutes" }, action: "email" }],
      stats: { enrolled: 0, sent: 0, failed: 0 },
      createdAt: 1,
    });
  }

  async function storeSnapshot(storeId: string) {
    const root = db.collection("stores").doc(storeId);
    const rootData = (await root.get()).data();
    const data: Record<string, unknown> = { root: rootData };
    for (const collection of await root.listCollections()) {
      const snap = await collection.get();
      data[collection.id] = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }
    return data;
  }

  await seed("store-a");
  await seed("store-b");
  let blockObserved = false;
  const guardedRepository = createFirestoreStoreRedactRepository({
    async afterCommercialBlock(storeId) {
      const store = db.collection("stores").doc(storeId);
      const root = (await store.get()).data();
      const scheduled = (await store.collection("jobs").doc("scheduled-job").get()).data();
      const processing = (await store.collection("jobs").doc("processing-job").get()).data();
      const sent = (await store.collection("jobs").doc("sent-job").get()).data();
      const created = await enrollCartInFlows(
        storeId,
        {
          cartId: "new-cart",
          nsCheckoutId: "new-cart",
          contactId: `email:${pii.email}`,
          total: 1,
          items: [],
          recoveryUrl: null,
          createdAt: 1,
          abandonedAt: 2,
          status: "abandoned",
        },
        {
          contactId: `email:${pii.email}`,
          nsCustomerId: pii.customerId,
          name: pii.name,
          email: pii.email,
          phone: pii.phone,
          tags: [],
          ordersCount: 1,
          totalSpent: 1,
          optOut: false,
          lastOrderAt: null,
        },
      );
      const cartWriteBlocked = await syncAbandonedCheckout(storeId, {
        id: "late-checkout",
        contact_name: "Late Person",
        contact_email: "late@example.com",
        contact_phone: "+55 11 90000-0000",
        total: "1",
        products: [],
        abandoned_checkout_url: "https://fixture.invalid/late",
      }).then(() => false, () => true);
      const originalGetOrder = NuvemshopClient.prototype.getOrder;
      NuvemshopClient.prototype.getOrder = async function () {
        return {
          id: 999,
          customer: {
            id: "late-customer",
            name: "Late Person",
            email: "late@example.com",
            phone: "+55 11 90000-0000",
          },
          total: "1",
          products: [],
        };
      };
      const orderWriteBlocked = await syncOrder(
        storeId,
        "unused-fixture-token",
        "999",
      ).then(() => false, () => true).finally(() => {
        NuvemshopClient.prototype.getOrder = originalGetOrder;
      });
      const lateCart = {
        cartId: "late-cart-once",
        nsCheckoutId: "late-cart-once",
        contactId: `email:${pii.email}`,
        total: 1,
        items: [],
        recoveryUrl: null,
        createdAt: 1,
        abandonedAt: 2,
        status: "abandoned" as const,
      };
      const lateContact = {
        contactId: `email:${pii.email}`,
        nsCustomerId: pii.customerId,
        name: pii.name,
        email: pii.email,
        phone: pii.phone,
        tags: [],
        ordersCount: 1,
        totalSpent: 1,
        optOut: false,
        lastOrderAt: null,
      };
      const cartEnrollmentBlocked = !(await enrollCartOnce(storeId, lateCart, lateContact));
      const webhookClaimBlocked = !(await firestoreEventClaim.claim(storeId, "late-event"));
      const flowWriteBlocked = await saveFlow(storeId, {
        name: "Late flow",
        status: "draft",
        trigger: { event: "order_created", match: "all", conditions: [] },
        steps: [],
      }).then(() => false, () => true);
      blockObserved = root?.status === "redacting"
        && root.accessToken == null
        && root.whatsapp == null
        && scheduled?.status === "cancelled"
        && processing?.status === "cancelled"
        && sent?.status === "sent"
        && created === 0
        && cartWriteBlocked
        && orderWriteBlocked
        && cartEnrollmentBlocked
        && webhookClaimBlocked
        && flowWriteBlocked
        && !(await store.collection("contacts").doc("late-customer").get()).exists
        && !(await store.collection("carts").doc("late-checkout").get()).exists
        && !(await store.collection("orders").doc("999").get()).exists
        && !(await store.collection("webhook_events").doc("late-event").get()).exists;
    },
  });
  const first = await processStoreRedact(guardedRepository, storePayload("store-a"), 10_000);
  check("bloqueio comercial ocorre antes da purga", blockObserved);
  check("primeira execucao completa", !first.deduped);
  const storeRedactSource = readFileSync("lib/lgpd/storeRedact.firestore.ts", "utf8")
    + readFileSync("lib/lgpd/storeRedact.ts", "utf8");
  const cartSignalSource = readFileSync("app/api/storefront/cart-signal/route.ts", "utf8");
  const whatsappWriteSources = [
    readFileSync("app/api/whatsapp/connect/route.ts", "utf8"),
    readFileSync("app/api/cron/refresh-whatsapp-tokens/route.ts", "utf8"),
  ];
  check(
    "nenhum provider importado/executado",
    !/sendEmail|sendWhatsapp|triggerWebhook|dispatchJob|resend|meta/i.test(storeRedactSource),
  );
  check(
    "cart signal revalida store na transacao final",
    cartSignalSource.includes("tx.get(storeRef(storeId))")
      && cartSignalSource.includes("isStoreCommerciallyActive"),
  );
  check(
    "gravacoes tardias de WhatsApp revalidam store ativa",
    whatsappWriteSources.every((source) => source.includes("isStoreCommerciallyActive")
      && source.includes("runTransaction")),
  );

  const storeA = await storeSnapshot("store-a");
  const tombstone = storeA.root as Record<string, unknown>;
  check(
    "tombstone minimo correto",
    JSON.stringify(Object.keys(tombstone).sort())
      === JSON.stringify(["redactedAt", "redactionRequestId", "status", "tombstoneVersion"].sort())
      && tombstone.status === "redacted",
  );
  check(
    "somente lgpd_suppressions sobrevive a purga tenant",
    JSON.stringify(Object.keys(storeA).sort())
      === JSON.stringify(["lgpd_suppressions", "root"].sort()),
  );
  check(
    "tokens/config/dominios/quotas removidos",
    !["accessToken", "whatsapp", "domains", "originalDomain", "quotas", "plan"]
      .some((key) => key in tombstone),
  );
  const storeB = await storeSnapshot("store-b");
  check(
    "store A redact nao toca store B",
    (storeB.root as Record<string, unknown>)?.accessToken === pii.accessToken
      && Object.keys(storeB).length > 1,
  );

  const evidenceId = lgpdRequestId(storePayload("store-a"));
  const evidence = (await db.collection("lgpd_store_redactions").doc(evidenceId).get()).data();
  check(
    "evidencia minima completed sem storeId/payload/PII",
    evidence?.status === "completed"
      && evidence?.leaseId == null
      && evidence?.processingAt == null
      && !JSON.stringify(evidence).includes("store-a")
      && !JSON.stringify(evidence).includes(pii.email),
  );
  const residualA = JSON.stringify({ storeA, evidence });
  check(
    "nenhuma PII/secret/payload residual",
    Object.values(pii).every((value) => !residualA.includes(value)),
  );
  check("nenhum doc id com PII permanece", !residualA.includes(`email:${pii.email}`));

  const duplicate = await processStoreRedact(
    firestoreStoreRedactRepository,
    storePayload("store-a"),
    20_000,
  );
  check("evento duplicado idempotente", duplicate.deduped === true);
  await handleAppUninstalled("store-a", 25_000);
  const afterLateUninstall = (await db.doc("stores/store-a").get()).data();
  check(
    "app/uninstalled tardio preserva tombstone",
    JSON.stringify(Object.keys(afterLateUninstall ?? {}).sort())
      === JSON.stringify(["redactedAt", "redactionRequestId", "status", "tombstoneVersion"].sort())
      && afterLateUninstall?.status === "redacted",
  );

  await seed("store-partial");
  let failOnce = true;
  const partialRepository = createFirestoreStoreRedactRepository({
    async afterCollectionDeleted() {
      if (failOnce) {
        failOnce = false;
        throw new Error("fixture_partial_failure");
      }
    },
  });
  await processStoreRedact(partialRepository, storePayload("store-partial"), 30_000)
    .then(() => check("partial failure e propagada", false), () => check("partial failure e propagada", true));
  const failedEvidenceId = lgpdRequestId(storePayload("store-partial"));
  check(
    "partial failure registra failed e mantem bloqueio",
    (await db.collection("lgpd_store_redactions").doc(failedEvidenceId).get()).data()?.status === "failed"
      && (await db.doc("stores/store-partial").get()).data()?.status === "redacting",
  );
  const retried = await processStoreRedact(
    firestoreStoreRedactRepository,
    storePayload("store-partial"),
    40_000,
  );
  check("retry apos exclusoes parciais completa", !retried.deduped);

  await seed("store-race");
  const race = await Promise.allSettled([
    processStoreRedact(firestoreStoreRedactRepository, storePayload("store-race"), 50_000),
    processStoreRedact(firestoreStoreRedactRepository, storePayload("store-race"), 50_000),
  ]);
  const effective = race.filter((r) => r.status === "fulfilled" && !r.value.deduped);
  const followers = race.filter(
    (r) => r.status === "rejected" || (r.status === "fulfilled" && r.value.deduped),
  );
  check("lease race real permite um processamento", effective.length === 1 && followers.length === 1);

  await seed("store-expired");
  const expiredPayload = storePayload("store-expired");
  const expiredId = lgpdRequestId(expiredPayload);
  await db.collection("lgpd_store_redactions").doc(expiredId).set({
    requestId: expiredId,
    type: "store/redact",
    status: "processing",
    attempts: 1,
    receivedAt: 1,
    updatedAt: 1,
    processingAt: 1,
    leaseId: "expired-lease",
  });
  const expired = await processStoreRedact(
    firestoreStoreRedactRepository,
    expiredPayload,
    10 * 60_000 + 2,
  );
  check("processing lease expirado e recuperado", !expired.deduped);

  await seed("store-coexist");
  await processCustomerRedact(
    firestoreCustomerRedactRepository,
    customerPayload("store-coexist"),
    60_000,
  );
  await processStoreRedact(
    firestoreStoreRedactRepository,
    storePayload("store-coexist"),
    70_000,
  );
  const customerAfterStore = await processCustomerRedact(
    firestoreCustomerRedactRepository,
    customerPayload("store-coexist"),
    80_000,
  );
  check("customers redact antes/depois de store redact e seguro", customerAfterStore.deduped);

  // Fluxo completo dos dois blockers: suppression sobrevive ao store/redact,
  // OAuth recria uma instalacao comercial limpa e syncs futuros continuam
  // impedindo a reintroducao do titular X.
  await seed("store-reinstall");
  await seed("store-reinstall-other");
  await processCustomerRedact(
    firestoreCustomerRedactRepository,
    customerPayload("store-reinstall"),
    90_000,
  );
  const suppressionBefore = await db.doc("stores/store-reinstall").collection("lgpd_suppressions").get();
  check("suppression X existe antes de store redact", suppressionBefore.size > 0);
  await processStoreRedact(
    firestoreStoreRedactRepository,
    storePayload("store-reinstall"),
    100_000,
  );
  const suppressionAfter = await db.doc("stores/store-reinstall").collection("lgpd_suppressions").get();
  check(
    "lgpd_suppressions e preservada pelo store redact",
    suppressionAfter.size === suppressionBefore.size,
  );
  const redactedRoot = await db.doc("stores/store-reinstall").get();
  const installState = { exists: redactedRoot.exists, status: redactedRoot.data()?.status };
  check("tombstone redacted e first install comercial", isFirstCommercialInstall(installState));
  const reinstallAt = 110_000;
  const reinstallData = buildStoreInstallData(
    "store-reinstall",
    { accessToken: "new-oauth-token", scope: "read_orders,write_webhooks" },
    installState,
    reinstallAt,
  );
  await db.doc("stores/store-reinstall").set(reinstallData);
  const reinstalled = (await db.doc("stores/store-reinstall").get()).data();
  check(
    "reinstall recria defaults sem restaurar configuracao antiga",
    reinstalled?.status === "active"
      && reinstalled?.accessToken === "new-oauth-token"
      && reinstalled?.scope === "read_orders,write_webhooks"
      && reinstalled?.plan === "essencial"
      && reinstalled?.installedAt === reinstallAt
      && reinstalled?.quotas?.dispatchesMonthUsed === 0
      && reinstalled?.quotas?.whatsappMonthUsed === 0
      && reinstalled?.whatsapp == null
      && reinstalled?.domains == null
      && reinstalled?.originalDomain == null
      && reinstalled?.webhookRegistration == null
      && reinstalled?.redactedAt == null
      && reinstalled?.redactionRequestId == null,
  );
  const originalGetOrder = NuvemshopClient.prototype.getOrder;
  NuvemshopClient.prototype.getOrder = async function () {
    return {
      id: 1001,
      customer: {
        id: pii.customerId,
        name: pii.name,
        email: pii.email,
        phone: pii.phone,
      },
      total: "1",
      products: [],
    };
  };
  await syncOrder("store-reinstall", "fixture-token", "1001");
  await syncAbandonedCheckout("store-reinstall", {
    id: "checkout-x-after-reinstall",
    contact_name: pii.name,
    contact_email: pii.email,
    contact_phone: pii.phone,
    total: "1",
    products: [],
    abandoned_checkout_url: pii.recoveryUrl,
  });
  const afterSuppressedSync = JSON.stringify(await storeSnapshot("store-reinstall"));
  check(
    "syncOrder e checkout nao reintroduzem PII de X",
    !afterSuppressedSync.includes(pii.name)
      && !afterSuppressedSync.includes(pii.email)
      && !afterSuppressedSync.includes(pii.phone)
      && !afterSuppressedSync.includes(pii.customerId)
      && !afterSuppressedSync.includes(pii.recoveryUrl),
  );
  const customerY = {
    id: "customer-y",
    name: "Customer Y",
    email: "customer-y@example.com",
    phone: "+55 11 97777-0000",
  };
  NuvemshopClient.prototype.getOrder = async function () {
    return { id: 1002, customer: customerY, total: "2", products: [] };
  };
  await syncOrder("store-reinstall", "fixture-token", "1002");
  NuvemshopClient.prototype.getOrder = originalGetOrder;
  const yContacts = await db.doc("stores/store-reinstall").collection("contacts")
    .where("email", "==", customerY.email).get();
  check("cliente Y nao suprimido funciona normalmente", yContacts.size === 1);
  const otherStore = JSON.stringify(await storeSnapshot("store-reinstall-other"));
  check(
    "mesmo email em outra store nao e afetado",
    otherStore.includes(pii.email) && otherStore.includes(pii.name),
  );

  check("fixture cobre todas as colecoes relevantes", collections.length === 15);
  console.log(`\n${passed} testes store/redact no Firestore Emulator passaram`);
}

main().catch((error: unknown) => {
  console.error("LGPD store/redact Emulator test failed", {
    name: error instanceof Error ? error.name : "unknown",
    message: error instanceof Error ? error.message : "unknown",
  });
  process.exitCode = 1;
});
