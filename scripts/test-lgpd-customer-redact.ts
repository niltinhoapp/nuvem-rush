import { readFileSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import {
  customerKeys,
  lgpdEventSchema,
  minimalRequest,
  type LgpdWebhook,
  type MinimalLgpdRequest,
} from "../lib/lgpd/model";
import {
  processCustomerRedact,
  type CustomerRedactRepository,
  type RedactCounts,
} from "../lib/lgpd/customerRedact";
import { verifyHmac } from "../lib/nuvemshop/webhooks";

let pass = 0;
let fail = 0;
function check(label: string, condition: boolean) {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}`);
  condition ? pass++ : fail++;
}

const original = {
  id: "customer-123",
  email: "Titular@Example.com",
  phone: "+55 11 98888-7777",
  name: "Titular Real",
};

function payload(overrides: Partial<LgpdWebhook> = {}): LgpdWebhook {
  return {
    event: "customers/redact",
    store_id: "store-a",
    customer: { id: original.id, email: original.email, phone: original.phone },
    orders_to_redact: ["order-1"],
    ...overrides,
  };
}

type Fixture = {
  storeExists: boolean;
  contacts: Record<string, Record<string, unknown>>;
  orders: Record<string, Record<string, unknown>>;
  carts: Record<string, Record<string, unknown>>;
  enrollments: Record<string, Record<string, unknown>>;
  jobs: Record<string, Record<string, unknown>>;
  logs: Record<string, Record<string, unknown>>;
  suppressions: Record<string, Record<string, unknown>>;
  requests: Record<string, MinimalLgpdRequest>;
  providerCalls: number;
  quotaUsed: number;
  failOnce?: boolean;
};

function makeRepo(f: Fixture): CustomerRedactRepository {
  return {
    async begin(p, now) {
      if (!f.storeExists) throw new Error("lgpd_store_not_found");
      const initial = minimalRequest(p, now);
      const current = f.requests[initial.requestId];
      if (current?.status === "completed") {
        return { action: "duplicate", request: current };
      }
      if (current?.status === "processing") throw new Error("lgpd_request_in_progress");
      const request = {
        ...(current ?? initial), status: "processing" as const,
        processingAt: now, leaseId: `lease-${now}`,
        attempts: (current?.attempts ?? 0) + 1, updatedAt: now,
      };
      f.requests[request.requestId] = request;
      return { action: "process", request };
    },
    async redact(p, request, now) {
      const anon = request.anonymizedContactId!;
      for (const key of customerKeys(p.store_id, p.customer)) {
        f.suppressions[key] = { anonymizedContactId: anon };
      }
      const entries = Object.entries(f.contacts).filter(([id, contact]) =>
        String(contact.nsCustomerId ?? "") === p.customer?.id
        || id === p.customer?.id
        || String(contact.email ?? "").toLowerCase() === p.customer?.email?.toLowerCase(),
      );
      if (entries.length > 1) throw new Error("lgpd_customer_ambiguous");
      const counts: RedactCounts = {
        contacts: 0, orders: 0, carts: 0, enrollments: 0,
        jobsCancelled: 0, jobsPreserved: 0, logsSanitized: 0,
        suppressions: customerKeys(p.store_id, p.customer).length,
      };
      const entry = entries[0];
      if (!entry) return counts;
      const [oldId, contact] = entry;
      for (const order of Object.values(f.orders)) {
        if (order.contactId === oldId) { order.contactId = anon; counts.orders++; }
      }
      for (const [id, cart] of Object.entries(f.carts)) {
        if (cart.contactId === oldId) { delete f.carts[id]; counts.carts++; }
      }
      for (const [id, enrollment] of Object.entries(f.enrollments)) {
        if (enrollment.contactId !== oldId) continue;
        for (const job of Object.values(f.jobs)) {
          if (job.enrollmentId !== id) continue;
          if (job.status === "scheduled" || job.status === "processing") {
            job.status = "cancelled"; job.cancelReason = "customer_redacted";
            counts.jobsCancelled++;
          } else counts.jobsPreserved++;
          delete job.lastError;
          for (const log of Object.values(f.logs)) {
            if (log.jobId === job.jobId && log.error != null) {
              log.error = "[redacted]"; counts.logsSanitized++;
            }
          }
        }
        delete f.enrollments[id]; counts.enrollments++;
      }
      f.contacts[anon] = {
        contactId: anon, nsCustomerId: null, name: null, email: null, phone: null,
        tags: [], ordersCount: contact.ordersCount ?? 0, totalSpent: contact.totalSpent ?? 0,
        optOut: true, lastOrderAt: contact.lastOrderAt ?? null, redactedAt: now,
      };
      delete f.contacts[oldId]; counts.contacts = 1;
      if (f.failOnce) { f.failOnce = false; throw new Error("fixture_failure"); }
      return counts;
    },
    async complete(request, counts, now) {
      if (f.requests[request.requestId]?.leaseId !== request.leaseId) {
        throw new Error("lgpd_request_lease_lost");
      }
      f.requests[request.requestId] = {
        ...request, status: "completed", completedAt: now, updatedAt: now, affected: counts,
      };
    },
    async fail(request, errorCode, now) {
      if (f.requests[request.requestId]?.leaseId !== request.leaseId) return;
      f.requests[request.requestId] = { ...request, status: "failed", errorCode, updatedAt: now };
    },
  };
}

function fixture(contactId = original.id): Fixture {
  return {
    storeExists: true,
    contacts: { [contactId]: {
      contactId, nsCustomerId: original.id, name: original.name,
      email: original.email, phone: original.phone, tags: ["vip"],
      ordersCount: 2, totalSpent: 100, optOut: false,
    } },
    orders: { "order-1": { orderId: "order-1", contactId } },
    carts: { "cart-1": { cartId: "cart-1", contactId, recoveryUrl: "sensitive" } },
    enrollments: { "enroll-1": { enrollmentId: "enroll-1", contactId, status: "active" } },
    jobs: {
      "job-1": { jobId: "job-1", enrollmentId: "enroll-1", status: "scheduled" },
      "job-2": { jobId: "job-2", enrollmentId: "enroll-1", status: "sent", lastError: original.email },
    },
    logs: { "log-1": { jobId: "job-2", error: original.phone } },
    suppressions: {}, requests: {}, providerCalls: 0, quotaUsed: 0,
  };
}

async function main() {
  const parsed = lgpdEventSchema.safeParse(payload());
  check("payload oficial customers/redact valido", parsed.success);
  check("payload invalido rejeitado", !lgpdEventSchema.safeParse({ event: "customers/redact", store_id: "s" }).success);

  const minimal = minimalRequest(payload(), 1);
  const serializedRequest = JSON.stringify(minimal);
  check("request nao persiste payload bruto", !serializedRequest.includes("payload"));
  check("request nao persiste email/telefone/nome/id bruto", [original.email, original.phone, original.name, original.id].every((v) => !serializedRequest.includes(v)));
  check("request lifecycle inicia pending", minimal.status === "pending");
  const legacySubject = createHash("sha256").update(`id:${original.id}`).digest("hex");
  const legacyRequestId = createHash("sha256")
    .update(`store-a:customers/redact:${legacySubject}`)
    .digest("hex");
  check("requestId existente permanece compativel", minimal.requestId === legacyRequestId);
  check(
    "hash de suppression usa namespace da store",
    customerKeys("store-a", payload().customer)[0] !== customerKeys("store-b", payload().customer)[0],
  );
  check(
    "hash de suppression e estavel dentro da store",
    customerKeys("store-a", payload().customer)[0] === customerKeys("store-a", payload().customer)[0],
  );

  const f = fixture();
  const first = await processCustomerRedact(makeRepo(f), payload(), 10);
  check("customer existente processado", first.ok && !first.deduped);
  check("scheduled cancelado", f.jobs["job-1"]?.status === "cancelled");
  check("sent preservado", f.jobs["job-2"]?.status === "sent");
  check("enrollment removido", Object.keys(f.enrollments).length === 0);
  check("cart removido", Object.keys(f.carts).length === 0);
  check("order anonimizado", !Object.values(f.orders).some((o) => o.contactId === original.id));
  check("contact doc id com PII removido", !f.contacts[original.id]);
  check("novo contact e opaco/suprimido", Object.values(f.contacts).some((c) => c.optOut === true && c.email == null));
  check("logs sanitizados", f.logs["log-1"]?.error === "[redacted]");
  check("nenhuma PII original persistida", [original.email, original.phone, original.name, original.id].every((value) => !JSON.stringify(f).includes(value)));
  check("nenhum provider chamado", f.providerCalls === 0);
  check("nenhuma quota consumida", f.quotaUsed === 0);

  const duplicate = await processCustomerRedact(makeRepo(f), payload(), 20);
  check("evento duplicado idempotente", duplicate.deduped === true);

  const busy = fixture();
  const busyRequest = { ...minimalRequest(payload(), 1), status: "processing" as const, leaseId: "worker-a", processingAt: 1 };
  busy.requests[busyRequest.requestId] = busyRequest;
  await processCustomerRedact(makeRepo(busy), payload(), 2).then(
    () => check("concorrente em processing nao recebe sucesso falso", false),
    () => check("concorrente em processing nao recebe sucesso falso", true),
  );

  const emailDoc = fixture(`email:${original.email}`);
  await processCustomerRedact(makeRepo(emailDoc), payload(), 10);
  check("doc id email removido", !emailDoc.contacts[`email:${original.email}`]);

  const noContact = fixture(); noContact.contacts = {};
  const noContactResult = await processCustomerRedact(makeRepo(noContact), payload(), 10);
  check("customer sem contact completa", noContactResult.ok && Object.values(noContact.requests)[0]?.status === "completed");

  const missing = fixture(); missing.storeExists = false;
  await processCustomerRedact(makeRepo(missing), payload(), 10).then(
    () => check("store desconhecida fail-closed", false),
    () => check("store desconhecida fail-closed", true),
  );

  const retry = fixture(); retry.failOnce = true;
  await processCustomerRedact(makeRepo(retry), payload(), 10).catch(() => undefined);
  check("partial failure fica failed", Object.values(retry.requests)[0]?.status === "failed");
  const retried = await processCustomerRedact(makeRepo(retry), payload(), 20);
  check("partial failure permite retry", retried.ok && Object.values(retry.requests)[0]?.status === "completed");

  const secret = "test-secret";
  process.env.NUVEMSHOP_CLIENT_SECRET = secret;
  const raw = JSON.stringify(payload());
  const validHmac = createHmac("sha256", secret).update(raw).digest("hex");
  check("HMAC valido aceito", verifyHmac(raw, validHmac));
  check("HMAC invalido rejeitado", !verifyHmac(raw, "00".repeat(32)));

  const adapter = readFileSync("lib/lgpd/firestore.ts", "utf8");
  const route = readFileSync("app/api/webhooks/nuvemshop/route.ts", "utf8");
  const sync = readFileSync("lib/nuvemshop/sync.ts", "utf8");
  const carts = readFileSync("lib/nuvemshop/carts.ts", "utf8");
  check("adapter cobre colecoes do data map", ["contacts", "orders", "carts", "enrollments", "jobs", "logs", "lgpd_requests", "lgpd_suppressions"].every((name) => adapter.includes(`\"${name}\"`)));
  check("rota nao persiste payload bruto", !route.includes("type: payload.event, payload"));
  check("rota nao importa providers", !/sendEmail|sendWhatsapp|dispatchJob/.test(route + adapter));
  check("sync futuro respeita supressao", sync.includes("findSuppressedContactId") && carts.includes("findSuppressedContactId"));
  const storeCase = route.indexOf('case "store/redact"');
  const dataRequestCase = route.indexOf('case "customers/data_request"');
  check(
    "store redact possui case explicito sem fallthrough",
    storeCase >= 0
      && dataRequestCase > storeCase
      && route.slice(storeCase, dataRequestCase).includes("return NextResponse.json"),
  );

  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
