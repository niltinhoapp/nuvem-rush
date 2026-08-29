import { db, storeRef } from "@/lib/firebase/admin";
import type { Job, Store } from "@/types";
import { buildQuotaRelease, clearQuotaReservation } from "./quotaReservation";

export async function cancelJobAndReleaseQuota(params: {
  storeId: string;
  jobRef: FirebaseFirestore.DocumentReference;
  reason: string;
  now: number;
  expectedStatus?: "scheduled" | "processing";
}): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const [storeSnap, jobSnap] = await Promise.all([
      tx.get(storeRef(params.storeId)),
      tx.get(params.jobRef),
    ]);
    if (!jobSnap.exists) return false;
    const job = jobSnap.data() as Job;
    if (job.status !== "scheduled" && job.status !== "processing") return false;
    if (params.expectedStatus && job.status !== params.expectedStatus) return false;

    const store = storeSnap.data() as Store | undefined;
    const release = store ? buildQuotaRelease(store, job) : {};
    // Uma reserva malformada nunca pode debitar o contador do periodo atual.
    // Mantemos o job processing para recuperacao manual em vez de fingir que a
    // liberacao aconteceu. Esse caso nao e criado pelo fluxo normal.
    if (release === null) return false;

    if (Object.keys(release).length > 0) tx.update(storeRef(params.storeId), release);
    tx.update(params.jobRef, {
      status: "cancelled",
      cancelledAt: params.now,
      cancelReason: params.reason,
      ...clearQuotaReservation(),
    });
    return true;
  });
}
