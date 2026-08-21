import { createHmac } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { NextRequest } from "next/server";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST obrigatorio");
}

const projectId = process.env.GCLOUD_PROJECT ?? "demo-nuvem-rush-lgpd";
const sessionSecret = "dashboard-emulator-session-secret";
process.env.NUVEMSHOP_CLIENT_SECRET = sessionSecret;
initializeApp({ projectId });

function sessionToken(storeId: string): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({ storeId, exp: Math.floor(Date.now() / 1000) + 3_600 });
  const signature = createHmac("sha256", sessionSecret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

async function main() {
  const db = getFirestore();
  const { processDataRequest } = await import("../lib/lgpd/dataRequest");
  const { firestoreDataRequestRepository } = await import("../lib/lgpd/dataRequest.firestore");
  const { processCustomerRedact } = await import("../lib/lgpd/customerRedact");
  const { firestoreCustomerRedactRepository } = await import("../lib/lgpd/firestore");
  const { lgpdRequestId } = await import("../lib/lgpd/model");
  const {
    GET,
    createDataRequestGetHandler,
  } = await import("../app/api/dashboard/data-requests/[requestId]/route");
  const { GET: LIST_GET } = await import("../app/api/dashboard/data-requests/route");

  let passed = 0;
  const check = (label: string, condition: boolean) => {
    if (!condition) throw new Error(`FAIL ${label}`);
    console.log(`PASS  ${label}`);
    passed++;
  };

  const subject = {
    id: "customer-dashboard-x",
    email: "dashboard-x@example.com",
    phone: "+55 11 95555-0101",
    identification: "DOC-DASHBOARD-X",
    name: "Dashboard Titular X",
  };
  const foreignSubject = {
    id: "customer-dashboard-y",
    email: "dashboard-y@example.com",
    phone: "+55 11 95555-0202",
    name: "Dashboard Titular Y",
  };
  const forbiddenSecret = "oauth-secret-never-export";

  const payload = (storeId: string, requestName: string) => ({
    event: "customers/data_request" as const,
    store_id: storeId,
    customer: {
      id: subject.id,
      email: subject.email,
      phone: subject.phone,
      identification: subject.identification,
    },
    data_request: { id: requestName },
  });

  async function clear(storeId: string) {
    await db.recursiveDelete(db.doc(`stores/${storeId}`));
  }

  async function seed(storeId: string, marker: string) {
    await clear(storeId);
    const store = db.doc(`stores/${storeId}`);
    await store.set({ status: "active", accessToken: forbiddenSecret });
    await store.collection("contacts").doc("contact-x").set({
      contactId: "contact-x",
      nsCustomerId: subject.id,
      identification: subject.identification,
      name: subject.name,
      email: subject.email,
      phone: subject.phone,
      tags: [marker],
      ordersCount: 1,
      totalSpent: 100,
      optOut: false,
      lastOrderAt: 100,
    });
    await store.collection("contacts").doc("contact-y").set({
      contactId: "contact-y",
      nsCustomerId: foreignSubject.id,
      name: foreignSubject.name,
      email: foreignSubject.email,
      phone: foreignSubject.phone,
      tags: ["foreign-subject"],
      ordersCount: 1,
      totalSpent: 900,
      optOut: false,
      lastOrderAt: 200,
    });
    await store.collection("orders").doc(`order-x-${marker}`).set({
      orderId: `order-x-${marker}`,
      nsOrderId: `ns-order-x-${marker}`,
      contactId: "contact-x",
      total: 100,
      items: [],
      status: "paid",
    });
    await store.collection("orders").doc(`order-y-${marker}`).set({
      orderId: `order-y-${marker}`,
      nsOrderId: `ns-order-y-${marker}`,
      contactId: "contact-y",
      total: 900,
      items: [],
      status: "paid",
    });
    await store.collection("carts").doc(`cart-x-${marker}`).set({
      cartId: `cart-x-${marker}`,
      contactId: "contact-x",
      total: 50,
      items: [],
      status: "abandoned",
      createdAt: 10,
      abandonedAt: 20,
    });
    await store.collection("enrollments").doc(`enrollment-x-${marker}`).set({
      enrollmentId: `enrollment-x-${marker}`,
      flowId: "flow-x",
      contactId: "contact-x",
      status: "active",
      startedAt: 30,
    });
    await store.collection("jobs").doc(`job-x-${marker}`).set({
      jobId: `job-x-${marker}`,
      enrollmentId: `enrollment-x-${marker}`,
      channel: "email",
      status: "sent",
    });
  }

  async function createRequest(storeId: string, requestName: string, now: number) {
    const currentPayload = payload(storeId, requestName);
    await processDataRequest(firestoreDataRequestRepository, currentPayload, now);
    return lgpdRequestId(currentPayload);
  }

  async function call(
    handler: typeof GET,
    storeId: string | null,
    requestId: string,
    extraHeaders: Record<string, string> = {},
  ) {
    const headers = new Headers(extraHeaders);
    if (storeId) headers.set("authorization", `Bearer ${sessionToken(storeId)}`);
    const request = new NextRequest(
      `https://app.test/api/dashboard/data-requests/${requestId}?storeId=store-b`,
      { headers },
    );
    const response = await handler(request, { params: Promise.resolve({ requestId }) });
    return {
      response,
      text: await response.text(),
    };
  }

  async function callList(
    storeId: string | null,
    extraHeaders: Record<string, string> = {},
  ) {
    const headers = new Headers(extraHeaders);
    if (storeId) headers.set("authorization", `Bearer ${sessionToken(storeId)}`);
    const request = new NextRequest(
      "https://app.test/api/dashboard/data-requests?storeId=store-b",
      { headers },
    );
    const response = await LIST_GET(request);
    return { response, text: await response.text() };
  }

  await Promise.all([
    seed("store-a", "A"),
    seed("store-b", "B"),
    seed("store-redacted-subject", "REDACTED-SUBJECT"),
    seed("store-redacting", "REDACTING"),
    seed("store-redacted", "REDACTED"),
    seed("store-race", "RACE"),
    seed("store-concurrent", "CONCURRENT"),
  ]);

  const requestA = await createRequest("store-a", "request-a", 1_000);
  const requestB = await createRequest("store-b", "request-b", 1_100);
  await db.doc("stores/store-a/lgpd_requests/not-a-data-request").set({
    type: "customers/redact",
    receivedAt: 9_999,
    email: subject.email,
  });

  const listWithoutSession = await callList(null, { "x-store-id": "store-a" });
  check("listagem sem sessao rejeita x-store-id e query storeId",
    listWithoutSession.response.status === 401);

  const listA = await callList("store-a");
  const listABody = JSON.parse(listA.text) as Record<string, any>;
  const listedRequests = Array.isArray(listABody.requests) ? listABody.requests : [];
  check("listagem usa store da sessao e retorna somente data requests da store A",
    listA.response.status === 200
      && listedRequests.length === 1
      && listedRequests[0]?.requestId === requestA
      && !listA.text.includes(requestB));
  check("metadata da listagem exclui PII, hashes e campos internos",
    Object.keys(listedRequests[0] ?? {}).sort().join(",")
      === "compileStatus,deliveryStatus,receivedAt,requestId"
      && !listA.text.includes(subject.email)
      && !listA.text.includes("customerKeyHashes")
      && !listA.text.includes("leaseId")
      && !listA.text.includes("errorCode"));
  check("listagem e no-store", listA.response.headers.get("cache-control")
    === "private, no-store, max-age=0");

  const first = await call(GET, "store-a", requestA);
  const firstBody = JSON.parse(first.text) as Record<string, any>;
  check("A sessao valida da store correta recebe export", first.response.status === 200
    && firstBody.data?.contact?.email === subject.email
    && firstBody.data?.orders?.length === 1);

  const noSession = await call(GET, null, requestA, { "x-store-id": "store-a" });
  check("B sem sessao Nexo e rejeitado sem fallback dev", noSession.response.status === 401
    && !noSession.text.includes(subject.email));

  const crossTenant = await call(GET, "store-a", requestB);
  check("C store A nao acessa request da store B", crossTenant.response.status === 404
    && !crossTenant.text.includes(subject.email));

  const missing = await call(GET, "store-a", "f".repeat(64));
  check("D request inexistente responde seguro", missing.response.status === 404
    && !missing.text.includes(subject.email));

  await processCustomerRedact(firestoreCustomerRedactRepository, {
    event: "customers/redact",
    store_id: "store-redacted-subject",
    customer: { id: subject.id, email: subject.email, phone: subject.phone },
  }, 2_000);
  const redactedSubjectRequest = await createRequest(
    "store-redacted-subject",
    "request-redacted-subject",
    2_100,
  );
  const redactedSubject = await call(GET, "store-redacted-subject", redactedSubjectRequest);
  const redactedSubjectBody = JSON.parse(redactedSubject.text) as Record<string, any>;
  check("E titular redacted recebe export vazio sem PII reconstruida",
    redactedSubject.response.status === 200
      && redactedSubjectBody.data?.contact === null
      && redactedSubjectBody.data?.orders?.length === 0
      && !redactedSubject.text.includes(subject.email));

  const redactingRequest = await createRequest("store-redacting", "request-redacting", 3_000);
  await db.doc("stores/store-redacting").update({ status: "redacting" });
  const redacting = await call(GET, "store-redacting", redactingRequest);
  check("F store redacting nao retorna PII", redacting.response.status === 409
    && !redacting.text.includes(subject.email));

  const redactedRequest = await createRequest("store-redacted", "request-redacted", 3_100);
  await db.doc("stores/store-redacted").update({ status: "redacted" });
  const redacted = await call(GET, "store-redacted", redactedRequest);
  check("G store redacted nao retorna PII", redacted.response.status === 409
    && !redacted.text.includes(subject.email));

  const raceRequest = await createRequest("store-race", "request-race", 4_000);
  const racingHandler = createDataRequestGetHandler({
    hooks: {
      async afterCompile() {
        await db.doc("stores/store-race").update({ status: "redacting" });
      },
    },
    now: () => 4_100,
  });
  const race = await call(racingHandler, "store-race", raceRequest);
  const raceEvidence = (await db.doc(`stores/store-race/lgpd_requests/${raceRequest}`).get()).data();
  check("H guarda final bloqueia race antes da resposta com PII",
    race.response.status === 409
      && !race.text.includes(subject.email)
      && Number(raceEvidence?.accessCount ?? 0) === 0
      && raceEvidence?.delivered !== true);

  const evidenceAfterFirst = (await db.doc(`stores/store-a/lgpd_requests/${requestA}`).get()).data();
  check("I primeiro acesso registra delivery dashboard uma vez",
    evidenceAfterFirst?.delivered === true
      && evidenceAfterFirst?.deliveryMethod === "dashboard"
      && evidenceAfterFirst?.deliveryStatus === "delivered"
      && evidenceAfterFirst?.accessCount === 1
      && typeof evidenceAfterFirst?.deliveredAt === "number");
  const firstDeliveredAt = evidenceAfterFirst?.deliveredAt;

  const second = await call(GET, "store-a", requestA);
  const evidenceAfterSecond = (await db.doc(`stores/store-a/lgpd_requests/${requestA}`).get()).data();
  check("J segundo acesso preserva deliveredAt e incrementa accessCount",
    second.response.status === 200
      && evidenceAfterSecond?.deliveredAt === firstDeliveredAt
      && evidenceAfterSecond?.accessCount === 2);

  const concurrentRequest = await createRequest(
    "store-concurrent",
    "request-concurrent",
    5_000,
  );
  const concurrent = await Promise.all([
    call(GET, "store-concurrent", concurrentRequest),
    call(GET, "store-concurrent", concurrentRequest),
  ]);
  const concurrentEvidence = (
    await db.doc(`stores/store-concurrent/lgpd_requests/${concurrentRequest}`).get()
  ).data();
  check("K dois acessos concorrentes convergem transacionalmente",
    concurrent.every((result) => result.response.status === 200)
      && concurrentEvidence?.accessCount === 2
      && typeof concurrentEvidence?.deliveredAt === "number");

  const evidenceJson = JSON.stringify(evidenceAfterSecond);
  const evidenceFields = new Set(Object.keys(evidenceAfterSecond ?? {}));
  check("L evidence persiste zero PII/export/payload/secrets",
    [subject.id, subject.email, subject.phone, subject.name, subject.identification,
      forbiddenSecret].every((value) => !evidenceJson.includes(value))
      && ["contact", "email", "phone", "name", "customerId", "export", "rawPayload",
        "accessToken", "orders", "carts", "enrollments", "secrets"]
        .every((field) => !evidenceFields.has(field)));

  const firstJson = JSON.stringify(firstBody);
  check("M export nao contem outro titular nem outra store",
    [foreignSubject.id, foreignSubject.email, foreignSubject.phone, foreignSubject.name,
      "order-x-B", "cart-x-B", "enrollment-x-B"].every((value) => !firstJson.includes(value)));

  check("lifecycle preserva completed e separa compilacao/entrega",
    evidenceAfterSecond?.status === "completed"
      && evidenceAfterSecond?.compileStatus === "completed"
      && evidenceAfterSecond?.deliveryStatus === "delivered");

  console.log(`\n${passed} testes de delivery dashboard A-M passaram`);
}

main().catch((error: unknown) => {
  console.error("LGPD data request dashboard Emulator test failed", {
    name: error instanceof Error ? error.name : "unknown",
    message: error instanceof Error ? error.message : "unknown",
  });
  process.exitCode = 1;
});
