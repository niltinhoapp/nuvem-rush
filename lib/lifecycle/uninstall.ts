import { db, col, storeRef } from "@/lib/firebase/admin";
import { cancelJobAndReleaseQuota } from "@/lib/dispatch/cancel";

const CANCELLABLE_JOB_STATUSES = ["scheduled", "processing"] as const;

export async function handleAppUninstalled(
  storeId: string,
  now: number = Date.now(),
): Promise<{ alreadyUninstalled: boolean; cancelledJobs: number }> {
  const ref = storeRef(storeId);
  const alreadyUninstalled = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (["uninstalled", "redacting", "redacted"].includes(snap.data()?.status)) return true;
    tx.set(ref, { status: "uninstalled", uninstalledAt: now }, { merge: true });
    return false;
  });

  let cancelledJobs = 0;
  for (const status of CANCELLABLE_JOB_STATUSES) {
    while (true) {
      const snap = await col(storeId, "jobs").where("status", "==", status).limit(400).get();
      if (snap.empty) break;
      for (const job of snap.docs) {
        const cancelled = await cancelJobAndReleaseQuota({
          storeId,
          jobRef: job.ref,
          reason: "store_uninstalled",
          now,
          expectedStatus: status,
        });
        if (cancelled) cancelledJobs++;
      }
    }
  }

  return { alreadyUninstalled, cancelledJobs };
}
