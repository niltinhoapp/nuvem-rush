import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db, col, storeRef } from "@/lib/firebase/admin";
import type { Cart, Contact, Enrollment, Job, Order } from "@/types";
import { findCustomerContact } from "./customerLookup.firestore";
import { lgpdRequestId } from "./model";
import {
  sanitizeOrderItems,
  type DataRequestCart,
  type DataRequestContact,
  type DataRequestEnrollment,
  type DataRequestEvidence,
  type DataRequestExport,
  type DataRequestOrder,
  type DataRequestRepository,
  type MessagingSummary,
} from "./dataRequest";

const PROCESSING_LEASE_MS = 10 * 60_000;

type DataRequestHooks = {
  afterCompile?: (compiled: DataRequestExport) => Promise<void>;
};

function requestRef(storeId: string, requestId: string) {
  return col(storeId, "lgpd_requests").doc(requestId);
}

function contactExport(doc: FirebaseFirestore.QueryDocumentSnapshot): DataRequestContact {
  const value = doc.data() as Partial<Contact>;
  return {
    contactId: String(value.contactId ?? doc.id),
    nsCustomerId: value.nsCustomerId ?? null,
    name: value.name ?? null,
    email: value.email ?? null,
    phone: value.phone ?? null,
    tags: Array.isArray(value.tags) ? [...value.tags] : [],
    ordersCount: Number(value.ordersCount ?? 0),
    totalSpent: Number(value.totalSpent ?? 0),
    optOut: Boolean(value.optOut),
    lastOrderAt: value.lastOrderAt ?? null,
  };
}

function orderExport(doc: FirebaseFirestore.QueryDocumentSnapshot): DataRequestOrder {
  const value = doc.data() as Partial<Order>;
  return {
    orderId: String(value.orderId ?? doc.id),
    nsOrderId: String(value.nsOrderId ?? doc.id),
    total: Number(value.total ?? 0),
    items: sanitizeOrderItems(value.items),
    status: value.status ?? "open",
    paidAt: value.paidAt ?? null,
    fulfilledAt: value.fulfilledAt ?? null,
    shippingStatus: value.shippingStatus ?? null,
    trackingCode: value.trackingCode ?? null,
    trackingUrl: value.trackingUrl ?? null,
  };
}

function cartExport(doc: FirebaseFirestore.QueryDocumentSnapshot): DataRequestCart {
  const value = doc.data() as Partial<Cart>;
  return {
    cartId: String(value.cartId ?? doc.id),
    total: Number(value.total ?? 0),
    items: sanitizeOrderItems(value.items),
    recoveryUrl: value.recoveryUrl ?? null,
    createdAt: Number(value.createdAt ?? 0),
    abandonedAt: Number(value.abandonedAt ?? 0),
    status: value.status ?? "abandoned",
  };
}

function enrollmentExport(
  doc: FirebaseFirestore.QueryDocumentSnapshot,
): DataRequestEnrollment {
  const value = doc.data() as Partial<Enrollment>;
  return {
    enrollmentId: String(value.enrollmentId ?? doc.id),
    flowId: String(value.flowId ?? ""),
    ...(value.orderId == null ? {} : { orderId: value.orderId }),
    ...(value.cartId == null ? {} : { cartId: value.cartId }),
    status: value.status ?? "cancelled",
    startedAt: Number(value.startedAt ?? 0),
  };
}

async function relatedDocs(storeId: string, collection: string, contactId: string) {
  return col(storeId, collection).where("contactId", "==", contactId).get();
}

async function messagingSummary(
  storeId: string,
  enrollmentDocs: FirebaseFirestore.QueryDocumentSnapshot[],
): Promise<MessagingSummary[]> {
  const counters = new Map<string, MessagingSummary>();
  for (const enrollment of enrollmentDocs) {
    const enrollmentId = String(
      (enrollment.data() as Partial<Enrollment>).enrollmentId ?? enrollment.id,
    );
    const jobs = await col(storeId, "jobs")
      .where("enrollmentId", "==", enrollmentId)
      .get();
    for (const job of jobs.docs) {
      const value = job.data() as Partial<Job>;
      const channel = String(value.channel ?? "unknown");
      const counter = counters.get(channel) ?? {
        channel,
        sent: 0,
        scheduled: 0,
        failed: 0,
        cancelled: 0,
      };
      const status = value.status === "processing" ? "scheduled" : value.status;
      if (status === "sent" || status === "scheduled" || status === "failed" || status === "cancelled") {
        counter[status]++;
      }
      counters.set(channel, counter);
    }
  }
  return [...counters.values()].sort((a, b) => a.channel.localeCompare(b.channel));
}

function affectedCounts(compiled: DataRequestExport): Record<string, number> {
  return {
    contacts: compiled.contact ? 1 : 0,
    orders: compiled.orders.length,
    carts: compiled.carts.length,
    enrollments: compiled.enrollments.length,
    messagingChannels: compiled.messagingSummary.length,
    messagingEvents: compiled.messagingSummary.reduce(
      (total, row) => total + row.sent + row.scheduled + row.failed + row.cancelled,
      0,
    ),
  };
}

export function createFirestoreDataRequestRepository(
  hooks: DataRequestHooks = {},
): DataRequestRepository {
  return {
    async begin(payload, now) {
      const requestId = lgpdRequestId(payload);
      const ref = requestRef(payload.store_id, requestId);
      return db.runTransaction(async (tx) => {
        const [store, current] = await Promise.all([
          tx.get(storeRef(payload.store_id)),
          tx.get(ref),
        ]);
        if (!store.exists) throw new Error("lgpd_store_not_found");
        if (current.exists) {
          const data = current.data() as DataRequestEvidence;
          if (data.status === "completed") {
            return { action: "duplicate" as const, evidence: data };
          }
          if (
            data.status === "processing"
            && typeof data.processingAt === "number"
            && now - data.processingAt < PROCESSING_LEASE_MS
          ) {
            throw new Error("lgpd_data_request_in_progress");
          }
          const evidence: DataRequestEvidence = {
            ...data,
            status: "processing",
            attempts: (data.attempts ?? 0) + 1,
            processingAt: now,
            leaseId: randomUUID(),
            updatedAt: now,
          };
          tx.set(ref, {
            status: evidence.status,
            attempts: evidence.attempts,
            processingAt: evidence.processingAt,
            leaseId: evidence.leaseId,
            updatedAt: now,
            errorCode: FieldValue.delete(),
          }, { merge: true });
          return { action: "process" as const, evidence };
        }

        const evidence: DataRequestEvidence = {
          requestId,
          type: "customers/data_request",
          status: "processing",
          attempts: 1,
          receivedAt: now,
          updatedAt: now,
          processingAt: now,
          leaseId: randomUUID(),
        };
        tx.create(ref, evidence);
        return { action: "process" as const, evidence };
      });
    },

    async compile(payload, evidence, now) {
      const contactDoc = await findCustomerContact(payload.store_id, payload);
      if (!contactDoc) {
        const empty: DataRequestExport = {
          requestId: evidence.requestId,
          storeId: payload.store_id,
          generatedAt: now,
          contact: null,
          orders: [],
          carts: [],
          enrollments: [],
          messagingSummary: [],
        };
        await hooks.afterCompile?.(empty);
        return empty;
      }

      const contactId = String(
        (contactDoc.data() as Partial<Contact>).contactId ?? contactDoc.id,
      );
      const [orders, carts, enrollments] = await Promise.all([
        relatedDocs(payload.store_id, "orders", contactId),
        relatedDocs(payload.store_id, "carts", contactId),
        relatedDocs(payload.store_id, "enrollments", contactId),
      ]);
      const compiled: DataRequestExport = {
        requestId: evidence.requestId,
        storeId: payload.store_id,
        generatedAt: now,
        contact: contactExport(contactDoc),
        orders: orders.docs.map(orderExport),
        carts: carts.docs.map(cartExport),
        enrollments: enrollments.docs.map(enrollmentExport),
        messagingSummary: await messagingSummary(payload.store_id, enrollments.docs),
      };
      await hooks.afterCompile?.(compiled);
      return compiled;
    },

    async complete(payload, evidence, compiled, now) {
      const ref = requestRef(payload.store_id, evidence.requestId);
      await db.runTransaction(async (tx) => {
        const current = await tx.get(ref);
        if (
          !current.exists
          || current.data()?.status !== "processing"
          || current.data()?.leaseId !== evidence.leaseId
        ) {
          throw new Error("lgpd_data_request_lease_lost");
        }
        tx.update(ref, {
          status: "completed",
          generatedAt: compiled.generatedAt,
          completedAt: now,
          updatedAt: now,
          affected: affectedCounts(compiled),
          processingAt: FieldValue.delete(),
          leaseId: FieldValue.delete(),
          errorCode: FieldValue.delete(),
        });
      });
    },

    async fail(payload, evidence, errorCode, now) {
      const ref = requestRef(payload.store_id, evidence.requestId);
      await db.runTransaction(async (tx) => {
        const current = await tx.get(ref);
        if (
          !current.exists
          || current.data()?.status !== "processing"
          || current.data()?.leaseId !== evidence.leaseId
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
}

export const firestoreDataRequestRepository = createFirestoreDataRequestRepository();
