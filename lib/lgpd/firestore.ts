import { randomUUID } from "node:crypto";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { db, col, storeRef } from "@/lib/firebase/admin";
import type { Contact, Job } from "@/types";
import type { CustomerRedactRepository, RedactCounts } from "./customerRedact";
import {
  customerKeys,
  minimalRequest,
  normalizeEmail,
  normalizePhone,
  type LgpdWebhook,
  type MinimalLgpdRequest,
} from "./model";

const PROCESSING_LEASE_MS = 10 * 60_000;

function requestRef(storeId: string, requestId: string) {
  return col(storeId, "lgpd_requests").doc(requestId);
}

async function allContacts(storeId: string) {
  const docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  while (true) {
    let query = col(storeId, "contacts").orderBy(FieldPath.documentId()).limit(400);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    docs.push(...page.docs);
    if (page.size < 400) return docs;
    cursor = page.docs.at(-1);
  }
}

async function findContact(storeId: string, payload: LgpdWebhook) {
  const customer = payload.customer;
  if (!customer || customerKeys(storeId, customer).length === 0) {
    throw new Error("lgpd_customer_identifier_missing");
  }

  const contacts = await allContacts(storeId);
  const byId = customer.id
    ? contacts.filter((doc) => {
        const data = doc.data() as Partial<Contact>;
        return String(data.nsCustomerId ?? "") === customer.id || doc.id === customer.id;
      })
    : [];
  const email = normalizeEmail(customer.email);
  const phone = normalizePhone(customer.phone);
  const matches = byId.length > 0
    ? byId
    : contacts.filter((doc) => {
        const data = doc.data() as Partial<Contact>;
        return Boolean(
          (email && normalizeEmail(data.email ?? undefined) === email)
          || (phone && normalizePhone(data.phone ?? undefined) === phone),
        );
      });
  const unique = [...new Map(matches.map((doc) => [doc.id, doc])).values()];
  if (unique.length > 1) throw new Error("lgpd_customer_ambiguous");
  return unique[0];
}

async function redactRelatedData(
  storeId: string,
  oldContactId: string,
  anonymizedContactId: string,
  now: number,
): Promise<Omit<RedactCounts, "contacts" | "suppressions">> {
  const counts = {
    orders: 0,
    carts: 0,
    enrollments: 0,
    jobsCancelled: 0,
    jobsPreserved: 0,
    logsSanitized: 0,
  };

  // Primeiro bloqueia trabalho comercial. A transacao evita sobrescrever um
  // job que tenha virado sent/failed/cancelled concorrentemente.
  const enrollments = await col(storeId, "enrollments")
    .where("contactId", "==", oldContactId)
    .get();
  for (const enrollment of enrollments.docs) {
    const jobs = await col(storeId, "jobs")
      .where("enrollmentId", "==", enrollment.id)
      .get();
    for (const job of jobs.docs) {
      const outcome = await db.runTransaction(async (tx) => {
        const current = await tx.get(job.ref);
        if (!current.exists) return "missing" as const;
        const data = current.data() as Job;
        const commercial = data.status === "scheduled" || data.status === "processing";
        tx.update(job.ref, {
          ...(commercial
            ? { status: "cancelled", cancelledAt: now, cancelReason: "customer_redacted" }
            : {}),
          lastError: FieldValue.delete(),
        });
        return commercial ? "cancelled" as const : "preserved" as const;
      });
      if (outcome === "cancelled") counts.jobsCancelled++;
      if (outcome === "preserved") counts.jobsPreserved++;

      const logs = await col(storeId, "logs").where("jobId", "==", job.id).get();
      for (const log of logs.docs) {
        if (log.data().error != null) {
          await log.ref.update({ error: "[redacted]" });
          counts.logsSanitized++;
        }
      }
    }
    await enrollment.ref.delete();
    counts.enrollments++;
  }

  const orders = await col(storeId, "orders").where("contactId", "==", oldContactId).get();
  for (const order of orders.docs) {
    await order.ref.update({ contactId: anonymizedContactId });
    counts.orders++;
  }

  const carts = await col(storeId, "carts").where("contactId", "==", oldContactId).get();
  for (const cart of carts.docs) {
    await cart.ref.delete();
    counts.carts++;
  }
  return counts;
}

export const firestoreCustomerRedactRepository: CustomerRedactRepository = {
  async begin(payload, now) {
    const initial = minimalRequest(payload, now);
    const ref = requestRef(payload.store_id, initial.requestId);
    return db.runTransaction(async (tx) => {
      const store = await tx.get(storeRef(payload.store_id));
      if (!store.exists) throw new Error("lgpd_store_not_found");
      const current = await tx.get(ref);
      if (current.exists) {
        const data = current.data() as MinimalLgpdRequest;
        if (data.status === "completed") return { action: "duplicate" as const, request: data };
        if (
          data.status === "processing"
          && typeof data.processingAt === "number"
          && now - data.processingAt < PROCESSING_LEASE_MS
        ) {
          throw new Error("lgpd_request_in_progress");
        }
        const leaseId = randomUUID();
        const { errorCode: _previousError, ...retryable } = data;
        void _previousError;
        const request = {
          ...retryable,
          status: "processing" as const,
          processingAt: now,
          leaseId,
          updatedAt: now,
          attempts: (data.attempts ?? 0) + 1,
        };
        tx.set(ref, {
          status: request.status,
          processingAt: now,
          leaseId,
          updatedAt: now,
          attempts: request.attempts,
          errorCode: FieldValue.delete(),
        }, { merge: true });
        return { action: "process" as const, request };
      }

      const request = {
        ...initial,
        status: "processing" as const,
        processingAt: now,
        leaseId: randomUUID(),
        attempts: 1,
      };
      tx.create(ref, request);
      return { action: "process" as const, request };
    });
  },

  async redact(payload, request, now) {
    const anonymizedContactId = request.anonymizedContactId;
    if (!anonymizedContactId) throw new Error("lgpd_customer_identifier_missing");

    const keys = customerKeys(payload.store_id, payload.customer);
    for (const key of keys) {
      await col(payload.store_id, "lgpd_suppressions").doc(key).set({
        anonymizedContactId,
        createdAt: now,
        reason: "customers_redact",
      }, { merge: true });
    }

    const contactDoc = await findContact(payload.store_id, payload);
    if (!contactDoc) {
      return {
        contacts: 0, orders: 0, carts: 0, enrollments: 0,
        jobsCancelled: 0, jobsPreserved: 0, logsSanitized: 0,
        suppressions: keys.length,
      };
    }

    const contact = contactDoc.data() as Contact;
    const related = await redactRelatedData(
      payload.store_id,
      contactDoc.id,
      anonymizedContactId,
      now,
    );
    await col(payload.store_id, "contacts").doc(anonymizedContactId).set({
      contactId: anonymizedContactId,
      nsCustomerId: null,
      name: null,
      email: null,
      phone: null,
      tags: [],
      ordersCount: contact.ordersCount ?? 0,
      totalSpent: contact.totalSpent ?? 0,
      optOut: true,
      lastOrderAt: contact.lastOrderAt ?? null,
      redactedAt: now,
    }, { merge: true });
    if (contactDoc.id !== anonymizedContactId) await contactDoc.ref.delete();

    return { ...related, contacts: 1, suppressions: keys.length };
  },

  async complete(request, counts, now) {
    const ref = requestRef(request.storeId, request.requestId);
    await db.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      if (
        !current.exists
        || current.data()?.status !== "processing"
        || current.data()?.leaseId !== request.leaseId
      ) {
        throw new Error("lgpd_request_lease_lost");
      }
      tx.update(ref, {
        status: "completed",
        completedAt: now,
        updatedAt: now,
        affected: counts,
        processingAt: FieldValue.delete(),
        leaseId: FieldValue.delete(),
        errorCode: FieldValue.delete(),
      });
    });
  },

  async fail(request, errorCode, now) {
    const ref = requestRef(request.storeId, request.requestId);
    await db.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      if (
        !current.exists
        || current.data()?.status !== "processing"
        || current.data()?.leaseId !== request.leaseId
      ) return;
      tx.update(ref, {
        status: "failed",
        errorCode,
        updatedAt: now,
        processingAt: FieldValue.delete(),
        leaseId: FieldValue.delete(),
      });
    });
  },
};

export async function registerMinimalLgpdRequest(payload: LgpdWebhook, now = Date.now()) {
  const request = minimalRequest(payload, now);
  const store = await storeRef(payload.store_id).get();
  if (!store.exists) throw new Error("lgpd_store_not_found");
  const ref = requestRef(payload.store_id, request.requestId);
  try {
    await ref.create(request);
    return { deduped: false, requestId: request.requestId };
  } catch (error) {
    const code = (error as { code?: number | string })?.code;
    if (code === 6 || code === "already-exists") return { deduped: true, requestId: request.requestId };
    throw error;
  }
}

export async function findSuppressedContactId(
  storeId: string,
  customer: { id?: string | number; email?: string | null; phone?: string | null },
): Promise<string | null> {
  const payloadCustomer = {
    ...(customer.id != null ? { id: String(customer.id) } : {}),
    ...(customer.email ? { email: customer.email } : {}),
    ...(customer.phone ? { phone: customer.phone } : {}),
  };
  for (const key of customerKeys(storeId, payloadCustomer)) {
    const snap = await col(storeId, "lgpd_suppressions").doc(key).get();
    const anonymizedContactId = snap.data()?.anonymizedContactId;
    if (typeof anonymizedContactId === "string") return anonymizedContactId;
  }
  return null;
}
