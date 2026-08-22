import { db, col, storeRef } from "@/lib/firebase/admin";
import { isStoreCommerciallyActive } from "@/lib/lifecycle/status";
import {
  canClaimWebhookEnvelope,
  webhookInboxRetryPlan,
  WEBHOOK_INBOX_LEASE_MS,
  type DueWebhookEnvelope,
  type WebhookInboxEnvelope,
  type WebhookInboxErrorCode,
  type WebhookInboxRepository,
} from "./inbox";

function inboxRef(storeId: string, key: string) {
  return col(storeId, "webhook_inbox").doc(key);
}

function dueTime(candidate: DueWebhookEnvelope): number {
  if (candidate.envelope.status === "retry") {
    return candidate.envelope.nextAttemptAt ?? Number.MAX_SAFE_INTEGER;
  }
  if (candidate.envelope.status === "processing") {
    return (candidate.envelope.claimedAt ?? Number.MAX_SAFE_INTEGER) + WEBHOOK_INBOX_LEASE_MS;
  }
  return candidate.envelope.receivedAt;
}

function candidateFromSnapshot(
  snapshot: FirebaseFirestore.QueryDocumentSnapshot,
): DueWebhookEnvelope | null {
  const segments = snapshot.ref.path.split("/");
  if (
    segments.length !== 4
    || segments[0] !== "stores"
    || segments[2] !== "webhook_inbox"
  ) return null;
  return {
    storeId: segments[1]!,
    key: segments[3]!,
    envelope: snapshot.data() as WebhookInboxEnvelope,
  };
}

function terminalUpdate(
  status: "completed" | "discarded" | "failed",
  now: number,
  lastError: WebhookInboxErrorCode | null,
) {
  return {
    status,
    nextAttemptAt: null,
    leaseId: null,
    claimedAt: null,
    completedAt: now,
    lastError,
  };
}

export const firestoreWebhookInboxRepository: WebhookInboxRepository = {
  async receive(input) {
    const ref = inboxRef(input.storeId, input.key);
    return db.runTransaction(async (tx) => {
      const [store, current] = await Promise.all([
        tx.get(storeRef(input.storeId)),
        tx.get(ref),
      ]);
      if (current.exists) return "duplicate" as const;
      if (!isStoreCommerciallyActive(store.data()?.status)) return "discarded" as const;

      const envelope: WebhookInboxEnvelope = {
        event: input.event,
        resourceId: input.resourceId,
        receivedAt: input.receivedAt,
        status: "received",
        attempts: 0,
        nextAttemptAt: input.receivedAt,
        leaseId: null,
        claimedAt: null,
        completedAt: null,
        lastError: null,
      };
      tx.create(ref, envelope);
      return "created" as const;
    });
  },

  async listDue(now, limit) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("webhook_inbox_invalid_batch_limit");
    }
    const group = db.collectionGroup("webhook_inbox");
    const leaseCutoff = now - WEBHOOK_INBOX_LEASE_MS;
    const [received, retries, expired] = await Promise.all([
      group.where("status", "==", "received").orderBy("receivedAt", "asc").limit(limit).get(),
      group.where("status", "==", "retry")
        .where("nextAttemptAt", "<=", now)
        .orderBy("nextAttemptAt", "asc")
        .limit(limit)
        .get(),
      group.where("status", "==", "processing")
        .where("claimedAt", "<=", leaseCutoff)
        .orderBy("claimedAt", "asc")
        .limit(limit)
        .get(),
    ]);

    const unique = new Map<string, DueWebhookEnvelope>();
    for (const snapshot of [...received.docs, ...retries.docs, ...expired.docs]) {
      const candidate = candidateFromSnapshot(snapshot);
      if (candidate) unique.set(snapshot.ref.path, candidate);
    }
    return [...unique.values()]
      .sort((a, b) =>
        dueTime(a) - dueTime(b)
        || a.envelope.receivedAt - b.envelope.receivedAt
        || a.storeId.localeCompare(b.storeId)
        || a.key.localeCompare(b.key))
      .slice(0, limit);
  },

  async claim(params) {
    const ref = inboxRef(params.storeId, params.key);
    return db.runTransaction(async (tx) => {
      const [store, current] = await Promise.all([
        tx.get(storeRef(params.storeId)),
        tx.get(ref),
      ]);
      if (!current.exists) return null;
      const envelope = current.data() as WebhookInboxEnvelope;
      if (!canClaimWebhookEnvelope(envelope, params.now)) return null;

      const claimed: WebhookInboxEnvelope = {
        ...envelope,
        status: "processing",
        attempts: envelope.attempts + 1,
        nextAttemptAt: null,
        leaseId: params.leaseId,
        claimedAt: params.now,
        completedAt: null,
      };
      tx.set(ref, claimed);
      return {
        envelope: claimed,
        storeActive: isStoreCommerciallyActive(store.data()?.status),
      };
    });
  },

  async complete(params) {
    const ref = inboxRef(params.storeId, params.key);
    return db.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      if (
        !current.exists
        || current.data()?.status !== "processing"
        || current.data()?.leaseId !== params.leaseId
      ) return false;
      tx.update(ref, terminalUpdate("completed", params.now, null));
      return true;
    });
  },

  async retry(params) {
    const ref = inboxRef(params.storeId, params.key);
    return db.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      if (
        !current.exists
        || current.data()?.status !== "processing"
        || current.data()?.leaseId !== params.leaseId
      ) return { updated: false, status: "retry" as const };

      const envelope = current.data() as WebhookInboxEnvelope;
      const plan = webhookInboxRetryPlan(envelope.attempts, params.now);
      if (plan.status === "failed") {
        tx.update(ref, terminalUpdate("failed", params.now, params.errorCode));
      } else {
        tx.update(ref, {
          status: "retry",
          nextAttemptAt: plan.nextAttemptAt,
          leaseId: null,
          claimedAt: null,
          completedAt: null,
          lastError: params.errorCode,
        });
      }
      return { updated: true, status: plan.status };
    });
  },

  async fail(params) {
    const ref = inboxRef(params.storeId, params.key);
    return db.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      if (
        !current.exists
        || current.data()?.status !== "processing"
        || current.data()?.leaseId !== params.leaseId
      ) return false;
      tx.update(ref, terminalUpdate("failed", params.now, params.errorCode));
      return true;
    });
  },

  async discard(params) {
    const ref = inboxRef(params.storeId, params.key);
    return db.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      if (
        !current.exists
        || current.data()?.status !== "processing"
        || current.data()?.leaseId !== params.leaseId
      ) return false;
      tx.update(ref, terminalUpdate("discarded", params.now, null));
      return true;
    });
  },
};
