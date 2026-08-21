import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db, col, storeRef } from "@/lib/firebase/admin";
import type { Cart, Contact, Enrollment, Job, Order } from "@/types";
import {
  findCustomerContact,
  findCustomerContactByKeyHashes,
} from "./customerLookup.firestore";
import { lgpdRequestId, minimalRequest } from "./model";
import { isStoreCommerciallyActive } from "@/lib/lifecycle/status";
import {
  sanitizeOrderItems,
  type DataRequestCart,
  type DataRequestContact,
  type DataRequestEnrollment,
  type DataRequestEvidence,
  type DataRequestExport,
  type DataRequestDashboardItem,
  type DataRequestOrder,
  type DataRequestRepository,
  type MessagingSummary,
} from "./dataRequest";

const PROCESSING_LEASE_MS = 10 * 60_000;

type DataRequestHooks = {
  afterCompile?: (compiled: DataRequestExport) => Promise<void>;
};

export type DataRequestDeliverySnapshot = {
  storeStatus: unknown;
  evidence: DataRequestEvidence;
};

export type DataRequestDeliveryReceipt = {
  deliveredAt: number;
  accessCount: number;
};

export interface DataRequestDeliveryRepository {
  loadForDelivery(
    storeId: string,
    requestId: string,
  ): Promise<DataRequestDeliverySnapshot | null>;
  compileForDelivery(
    storeId: string,
    evidence: DataRequestEvidence,
    now: number,
  ): Promise<DataRequestExport>;
  markDelivered(
    storeId: string,
    requestId: string,
    now: number,
  ): Promise<DataRequestDeliveryReceipt>;
}

export interface DataRequestDashboardListRepository {
  listForDashboard(
    storeId: string,
    limit: number,
  ): Promise<DataRequestDashboardItem[]>;
}

export type FirestoreDataRequestRepository = DataRequestRepository
  & DataRequestDeliveryRepository
  & DataRequestDashboardListRepository;

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

async function compileExport(
  storeId: string,
  requestId: string,
  contactDoc: FirebaseFirestore.QueryDocumentSnapshot | undefined,
  now: number,
  hooks: DataRequestHooks,
): Promise<DataRequestExport> {
  if (!contactDoc) {
    const empty: DataRequestExport = {
      requestId,
      storeId,
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
    relatedDocs(storeId, "orders", contactId),
    relatedDocs(storeId, "carts", contactId),
    relatedDocs(storeId, "enrollments", contactId),
  ]);
  const compiled: DataRequestExport = {
    requestId,
    storeId,
    generatedAt: now,
    contact: contactExport(contactDoc),
    orders: orders.docs.map(orderExport),
    carts: carts.docs.map(cartExport),
    enrollments: enrollments.docs.map(enrollmentExport),
    messagingSummary: await messagingSummary(storeId, enrollments.docs),
  };
  await hooks.afterCompile?.(compiled);
  return compiled;
}

export function createFirestoreDataRequestRepository(
  hooks: DataRequestHooks = {},
): FirestoreDataRequestRepository {
  return {
    async listForDashboard(storeId, limit) {
      const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 50));
      // `type == ...` usa apenas o indice simples automatico. A ordenacao e
      // feita depois da projecao para nao introduzir um indice composto novo.
      const snapshot = await col(storeId, "lgpd_requests")
        .where("type", "==", "customers/data_request")
        .limit(safeLimit)
        .get();
      return snapshot.docs
        .map((document): DataRequestDashboardItem => {
          const value = document.data() as Partial<DataRequestEvidence>;
          const compileStatus = value.compileStatus === "pending"
              || value.compileStatus === "processing"
              || value.compileStatus === "completed"
              || value.compileStatus === "failed"
            ? value.compileStatus
            : value.status === "pending"
                || value.status === "processing"
                || value.status === "completed"
                || value.status === "failed"
              ? value.status
              : "pending";
          const deliveryStatus = value.deliveryStatus === "delivered"
            ? "delivered"
            : "pending";
          return {
            requestId: document.id,
            receivedAt: Number(value.receivedAt ?? 0),
            compileStatus,
            deliveryStatus,
            ...(typeof value.deliveredAt === "number"
              ? { deliveredAt: value.deliveredAt }
              : {}),
          };
        })
        .sort((left, right) => right.receivedAt - left.receivedAt);
    },

    async begin(payload, now) {
      const requestId = lgpdRequestId(payload);
      const minimal = minimalRequest(payload, now);
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
            compileStatus: "processing",
            customerKeyHashes: minimal.customerKeyHashes ?? [],
            ...(minimal.dataRequestId ? { dataRequestId: minimal.dataRequestId } : {}),
            attempts: (data.attempts ?? 0) + 1,
            processingAt: now,
            leaseId: randomUUID(),
            updatedAt: now,
          };
          tx.set(ref, {
            status: evidence.status,
            compileStatus: evidence.compileStatus,
            customerKeyHashes: evidence.customerKeyHashes,
            ...(evidence.dataRequestId ? { dataRequestId: evidence.dataRequestId } : {}),
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
          compileStatus: "processing",
          deliveryStatus: "pending",
          delivered: false,
          accessCount: 0,
          customerKeyHashes: minimal.customerKeyHashes ?? [],
          ...(minimal.dataRequestId ? { dataRequestId: minimal.dataRequestId } : {}),
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
      return compileExport(payload.store_id, evidence.requestId, contactDoc, now, hooks);
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
          compileStatus: "completed",
          deliveryStatus: "pending",
          delivered: false,
          accessCount: 0,
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
          compileStatus: "failed",
          errorCode,
          updatedAt: now,
          processingAt: FieldValue.delete(),
          leaseId: FieldValue.delete(),
        });
      });
    },

    async loadForDelivery(storeId, requestId) {
      const [store, request] = await Promise.all([
        storeRef(storeId).get(),
        requestRef(storeId, requestId).get(),
      ]);
      if (!store.exists || !request.exists) return null;
      return {
        storeStatus: store.data()?.status,
        evidence: request.data() as DataRequestEvidence,
      };
    },

    async compileForDelivery(storeId, evidence, now) {
      if (
        evidence.type !== "customers/data_request"
        || evidence.status !== "completed"
        || !Array.isArray(evidence.customerKeyHashes)
      ) {
        throw new Error("lgpd_data_request_not_deliverable");
      }
      const contactDoc = await findCustomerContactByKeyHashes(
        storeId,
        evidence.customerKeyHashes,
      );
      return compileExport(storeId, evidence.requestId, contactDoc, now, hooks);
    },

    async markDelivered(storeId, requestId, now) {
      return db.runTransaction(async (tx) => {
        const [store, request] = await Promise.all([
          tx.get(storeRef(storeId)),
          tx.get(requestRef(storeId, requestId)),
        ]);
        if (!store.exists || !isStoreCommerciallyActive(store.data()?.status)) {
          throw new Error("lgpd_data_request_store_unavailable");
        }
        if (
          !request.exists
          || request.data()?.type !== "customers/data_request"
          || request.data()?.status !== "completed"
        ) {
          throw new Error("lgpd_data_request_not_deliverable");
        }
        const current = request.data() as DataRequestEvidence;
        const deliveredAt = typeof current.deliveredAt === "number"
          ? current.deliveredAt
          : now;
        const accessCount = Number(current.accessCount ?? 0) + 1;
        tx.update(request.ref, {
          compileStatus: "completed",
          deliveryStatus: "delivered",
          deliveryMethod: "dashboard",
          delivered: true,
          deliveredAt,
          accessCount,
          updatedAt: now,
        });
        return { deliveredAt, accessCount };
      });
    },
  };
}

export const firestoreDataRequestRepository = createFirestoreDataRequestRepository();
