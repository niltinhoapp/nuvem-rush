import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db, col, storeRef } from "@/lib/firebase/admin";
import { lgpdRequestId, minimalRequest } from "./model";
import type { StoreRedactEvidence, StoreRedactRepository } from "./storeRedact";

const PROCESSING_LEASE_MS = 10 * 60_000;
const EVIDENCE_COLLECTION = "lgpd_store_redactions";

type StoreRedactHooks = {
  afterCommercialBlock?: (storeId: string) => Promise<void>;
  afterCollectionDeleted?: (collectionId: string) => Promise<void>;
};

function evidenceRef(requestId: string) {
  return db.collection(EVIDENCE_COLLECTION).doc(requestId);
}

function redactingTombstone(requestId: string, now: number) {
  return {
    status: "redacting",
    redactionRequestId: requestId,
    redactionStartedAt: now,
    tombstoneVersion: 1,
  };
}

function completedTombstone(requestId: string, now: number) {
  return {
    status: "redacted",
    redactionRequestId: requestId,
    redactedAt: now,
    tombstoneVersion: 1,
  };
}

async function cancelCommercialJobs(storeId: string, now: number): Promise<number> {
  let cancelled = 0;
  for (const status of ["scheduled", "processing"] as const) {
    while (true) {
      const jobs = await col(storeId, "jobs").where("status", "==", status).limit(400).get();
      if (jobs.empty) break;
      for (const job of jobs.docs) {
        const changed = await db.runTransaction(async (tx) => {
          const current = await tx.get(job.ref);
          if (!current.exists || current.data()?.status !== status) return false;
          tx.update(job.ref, {
            status: "cancelled",
            cancelledAt: now,
            cancelReason: "store_redacted",
          });
          return true;
        });
        if (changed) cancelled++;
      }
    }
  }
  return cancelled;
}

export function createFirestoreStoreRedactRepository(
  hooks: StoreRedactHooks = {},
): StoreRedactRepository {
  return {
    async begin(payload, now) {
      const requestId = lgpdRequestId(payload);
      const ref = evidenceRef(requestId);
      return db.runTransaction(async (tx) => {
        const [store, current] = await Promise.all([
          tx.get(storeRef(payload.store_id)),
          tx.get(ref),
        ]);
        if (current.exists) {
          const data = current.data() as StoreRedactEvidence;
          if (data.status === "completed") {
            return { action: "duplicate" as const, evidence: data };
          }
          if (
            data.status === "processing"
            && typeof data.processingAt === "number"
            && now - data.processingAt < PROCESSING_LEASE_MS
          ) {
            throw new Error("lgpd_store_redact_in_progress");
          }
          const evidence: StoreRedactEvidence = {
            ...data,
            status: "processing",
            processingAt: now,
            leaseId: randomUUID(),
            attempts: (data.attempts ?? 0) + 1,
            updatedAt: now,
          };
          tx.set(ref, {
            ...evidence,
            errorCode: FieldValue.delete(),
            completedAt: FieldValue.delete(),
          }, { merge: true });
          tx.set(storeRef(payload.store_id), redactingTombstone(requestId, now));
          return { action: "process" as const, evidence };
        }

        if (!store.exists) throw new Error("lgpd_store_not_found");
        const minimal = minimalRequest(payload, now);
        const evidence: StoreRedactEvidence = {
          requestId,
          type: "store/redact",
          status: "processing",
          attempts: 1,
          receivedAt: minimal.receivedAt,
          updatedAt: now,
          processingAt: now,
          leaseId: randomUUID(),
        };
        tx.create(ref, evidence);
        // Overwrite intencional: remove imediatamente tokens, domínio, WhatsApp,
        // plano, cotas e qualquer outro dado reutilizável antes da purga.
        tx.set(storeRef(payload.store_id), redactingTombstone(requestId, now));
        return { action: "process" as const, evidence };
      });
    },

    async purge(payload, _evidence, now) {
      const affected: Record<string, number> = {
        jobsCancelled: await cancelCommercialJobs(payload.store_id, now),
        tenantCollectionsDeleted: 0,
        topLevelDocumentsObserved: 0,
      };
      await hooks.afterCommercialBlock?.(payload.store_id);

      // Descoberta dinâmica: não depende de uma lista que possa ficar obsoleta.
      const collections = await storeRef(payload.store_id).listCollections();
      for (const collection of collections.sort((a, b) => a.id.localeCompare(b.id))) {
        const count = await collection.count().get();
        affected.topLevelDocumentsObserved += count.data().count;
        await db.recursiveDelete(collection);
        affected.tenantCollectionsDeleted++;
        await hooks.afterCollectionDeleted?.(collection.id);
      }
      return affected;
    },

    async complete(payload, evidence, affected, now) {
      const ref = evidenceRef(evidence.requestId);
      await db.runTransaction(async (tx) => {
        const current = await tx.get(ref);
        if (
          !current.exists
          || current.data()?.status !== "processing"
          || current.data()?.leaseId !== evidence.leaseId
        ) {
          throw new Error("lgpd_store_redact_lease_lost");
        }
        tx.update(ref, {
          status: "completed",
          completedAt: now,
          updatedAt: now,
          affected,
          processingAt: FieldValue.delete(),
          leaseId: FieldValue.delete(),
          errorCode: FieldValue.delete(),
        });
        tx.set(
          storeRef(payload.store_id),
          completedTombstone(evidence.requestId, now),
        );
      });
    },

    async fail(evidence, errorCode, now) {
      const ref = evidenceRef(evidence.requestId);
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

export const firestoreStoreRedactRepository = createFirestoreStoreRedactRepository();
