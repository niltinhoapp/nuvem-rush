import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST obrigatorio");
}

const projectId = process.env.GCLOUD_PROJECT ?? "demo-nuvem-rush-lgpd";
initializeApp({ projectId });

async function main() {
const { firestoreCustomerRedactRepository } = await import("../lib/lgpd/firestore");
const { customerKeys } = await import("../lib/lgpd/model");
const { processCustomerRedact } = await import("../lib/lgpd/customerRedact");
const { syncAbandonedCheckout } = await import("../lib/nuvemshop/carts");
const { syncOrder } = await import("../lib/nuvemshop/sync");
const { NuvemshopClient } = await import("../lib/nuvemshop/client");

const db = getFirestore();
let passed = 0;

function check(label: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL ${label}`);
  console.log(`PASS  ${label}`);
  passed++;
}

const identity = {
  id: "customer-fixture-123",
  email: "Titular.Firestore@Example.com",
  phone: "+55 11 97777-6655",
  name: "Titular Firestore",
};

function redactPayload(storeId: string) {
  return {
    event: "customers/redact" as const,
    store_id: storeId,
    customer: { id: identity.id, email: identity.email, phone: identity.phone },
    orders_to_redact: ["order-1"],
  };
}

async function seedStore(storeId: string, contactId = `email:${identity.email}`) {
  const store = db.collection("stores").doc(storeId);
  await store.set({ status: "active" });
  await store.collection("contacts").doc(contactId).set({
    contactId,
    nsCustomerId: identity.id,
    name: identity.name,
    email: identity.email,
    phone: identity.phone,
    tags: ["fixture"],
    ordersCount: 1,
    totalSpent: 25,
    optOut: false,
    lastOrderAt: null,
  });
  await store.collection("orders").doc("order-1").set({
    orderId: "order-1",
    nsOrderId: "order-1",
    contactId,
    status: "paid",
    total: 25,
    items: [],
  });
  await store.collection("carts").doc("cart-1").set({
    cartId: "cart-1",
    nsCheckoutId: "cart-1",
    contactId,
    status: "abandoned",
    recoveryUrl: "https://fixture.invalid/recovery",
    items: [],
    total: 25,
  });
  await store.collection("enrollments").doc("enroll-1").set({
    enrollmentId: "enroll-1",
    contactId,
    flowId: "flow-1",
    status: "active",
  });
  await store.collection("jobs").doc("scheduled-job").set({
    jobId: "scheduled-job",
    enrollmentId: "enroll-1",
    status: "scheduled",
  });
  await store.collection("jobs").doc("sent-job").set({
    jobId: "sent-job",
    enrollmentId: "enroll-1",
    status: "sent",
  });
  await store.collection("jobs").doc("processing-job").set({
    jobId: "processing-job",
    enrollmentId: "enroll-1",
    status: "processing",
  });
}

async function allStoreData(storeId: string): Promise<string> {
  const store = db.collection("stores").doc(storeId);
  const result: Record<string, unknown[]> = {};
  for (const name of [
    "contacts", "orders", "carts", "enrollments", "jobs", "logs",
    "lgpd_requests", "lgpd_suppressions",
  ]) {
    const snapshot = await store.collection(name).get();
    result[name] = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }
  return JSON.stringify(result);
}

async function runScenarios() {
  await db.recursiveDelete(db.collection("stores").doc("store-a"));
  await db.recursiveDelete(db.collection("stores").doc("store-b"));
  await db.recursiveDelete(db.collection("stores").doc("store-race"));

  await seedStore("store-a");
  await seedStore("store-b");

  const keysA = customerKeys("store-a", redactPayload("store-a").customer);
  const keysB = customerKeys("store-b", redactPayload("store-b").customer);
  check("mesma identidade gera hashes diferentes entre stores", keysA.every((key) => !keysB.includes(key)));

  await processCustomerRedact(firestoreCustomerRedactRepository, redactPayload("store-a"), 1_000);
  check(
    "redact em A cria somente suppressions namespaced em A",
    (await db.collection("stores/store-a/lgpd_suppressions").get()).size === keysA.length
      && (await db.collection("stores/store-b/lgpd_suppressions").get()).empty,
  );
  const storeBContact = await db.doc(`stores/store-b/contacts/email:${identity.email}`).get();
  check("redact em A nao toca store B", storeBContact.exists && storeBContact.data()?.email === identity.email);
  check(
    "doc id email removido pelo repository real",
    !(await db.doc(`stores/store-a/contacts/email:${identity.email}`).get()).exists,
  );
  check(
    "jobs scheduled/processing cancelados e job sent preservado",
    (await db.doc("stores/store-a/jobs/scheduled-job").get()).data()?.status === "cancelled"
      && (await db.doc("stores/store-a/jobs/processing-job").get()).data()?.status === "cancelled"
      && (await db.doc("stores/store-a/jobs/sent-job").get()).data()?.status === "sent",
  );

  await seedStore("store-race", identity.id);
  const race = await Promise.allSettled([
    processCustomerRedact(firestoreCustomerRedactRepository, redactPayload("store-race"), 2_000),
    processCustomerRedact(firestoreCustomerRedactRepository, redactPayload("store-race"), 2_000),
  ]);
  const effectiveWorkers = race.filter(
    (result) => result.status === "fulfilled" && result.value.deduped === false,
  );
  const safeFollowers = race.filter(
    (result) => result.status === "rejected"
      || (result.status === "fulfilled" && result.value.deduped === true),
  );
  check(
    "lease race real permite somente um worker",
    effectiveWorkers.length === 1 && safeFollowers.length === 1,
  );
  const raceRequests = await db.collection("stores/store-race/lgpd_requests").get();
  check("lease race converge para request completed", raceRequests.size === 1 && raceRequests.docs[0]?.data().status === "completed");

  await syncAbandonedCheckout("store-a", {
    id: "cart-reintroduced",
    contact_name: identity.name,
    contact_email: identity.email,
    contact_phone: identity.phone,
    total: "25",
    products: [],
    abandoned_checkout_url: "https://fixture.invalid/reintroduced",
  });
  check(
    "carts real nao recria carrinho/PII suprimidos",
    !(await db.doc("stores/store-a/carts/cart-reintroduced").get()).exists,
  );

  const originalGetOrder = NuvemshopClient.prototype.getOrder;
  NuvemshopClient.prototype.getOrder = async function () {
    return {
      id: 999,
      customer: {
        id: identity.id,
        name: identity.name,
        email: identity.email,
        phone: identity.phone,
      },
      contact_name: identity.name,
      contact_email: identity.email,
      contact_phone: identity.phone,
      total: "25",
      products: [],
    };
  };
  try {
    const synced = await syncOrder("store-a", "fixture-token-never-used", "999", "paid");
    check(
      "sync real reutiliza contato opaco sem PII",
      synced.contact.optOut === true
        && synced.contact.name == null
        && synced.contact.email == null
        && synced.contact.phone == null
        && synced.contact.nsCustomerId == null,
    );
  } finally {
    NuvemshopClient.prototype.getOrder = originalGetOrder;
  }

  const residual = await allStoreData("store-a");
  check(
    "busca residual nao encontra PII nem customer id original",
    [identity.email, identity.phone, identity.name, identity.id].every((value) => !residual.includes(value)),
  );
  const request = (await db.collection("stores/store-a/lgpd_requests").get()).docs[0]?.data();
  check("lgpd_requests permanece sem payload bruto/PII", request != null && !JSON.stringify(request).includes(identity.email));

  console.log(`\n${passed} testes Firestore Emulator passaram`);
}

await runScenarios();
}

main().catch((error: unknown) => {
  console.error("LGPD Firestore Emulator test failed", {
    name: error instanceof Error ? error.name : "unknown",
    message: error instanceof Error ? error.message : "unknown",
  });
  process.exitCode = 1;
});
