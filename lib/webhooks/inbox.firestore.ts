import { db, col, storeRef } from "@/lib/firebase/admin";
import { isStoreCommerciallyActive } from "@/lib/lifecycle/status";
import {
  canClaimWebhookEnvelope,
  webhookInboxRetryPlan,
  type WebhookInboxEnvelope,
  type WebhookInboxErrorCode,
  type WebhookInboxRepository,
} from "./inbox";

function inboxRef(storeId: string, key: string) {
  return col(storeId, "webhook_inbox").doc(key);
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

  async claim(params) {
    const ref = inboxRef(params.storeId, params.key);
    return db.runTransaction(async (tx) => {
      const [store, current] = await Promise.all([
        tx.get(storeRef(params.storeId)),
        tx.get(ref),
      ]);
      if (!isStoreCommerciallyActive(store.data()?.status) || !current.exists) return null;
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
      return claimed;
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
