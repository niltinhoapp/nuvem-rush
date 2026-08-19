import { db, col, storeRef } from "@/lib/firebase/admin";

const CANCELLABLE_JOB_STATUSES = ["scheduled", "processing"] as const;

export async function handleAppUninstalled(
  storeId: string,
  now: number = Date.now(),
): Promise<{ alreadyUninstalled: boolean; cancelledJobs: number }> {
  const ref = storeRef(storeId);
  const alreadyUninstalled = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.data()?.status === "uninstalled") return true;
    tx.set(ref, { status: "uninstalled", uninstalledAt: now }, { merge: true });
    return false;
  });

  let cancelledJobs = 0;
  for (const status of CANCELLABLE_JOB_STATUSES) {
    while (true) {
      const snap = await col(storeId, "jobs").where("status", "==", status).limit(400).get();
      if (snap.empty) break;
      for (const job of snap.docs) {
        const cancelled = await db.runTransaction(async (tx) => {
          const current = await tx.get(job.ref);
          if (!current.exists || current.data()?.status !== status) return false;
          tx.update(job.ref, {
            status: "cancelled",
            cancelledAt: now,
            cancelReason: "store_uninstalled",
          });
          return true;
        });
        if (cancelled) cancelledJobs++;
      }
    }
  }

  return { alreadyUninstalled, cancelledJobs };
}
