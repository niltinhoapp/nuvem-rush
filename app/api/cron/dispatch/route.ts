// Cron da Vercel: roda periodicamente, busca jobs agendados ja vencidos
// (runAt <= agora) e dispara cada um.
// Protegido pelo CRON_SECRET que a Vercel injeta no header Authorization.
//
// Itera as lojas ativas e consulta jobs por loja (equality em status), que usa
// indice automatico. Evita o indice de collection-group. Para escala (milhares
// de lojas), migrar para collectionGroup("jobs") + indice composto status+runAt.
import { NextRequest, NextResponse } from "next/server";
import { db, col } from "@/lib/firebase/admin";
import { dispatchJob } from "@/lib/dispatch";
import type { Job } from "@/types";

export const maxDuration = 60; // segundos

export async function GET(req: NextRequest) {
  // Fail-closed: sem CRON_SECRET configurado, recusa (nao expoe o cron).
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "nao autorizado" }, { status: 401 });
  }

  const now = Date.now();
  const stores = await db.collection("stores").where("status", "==", "active").get();

  let scanned = 0;
  const due: Job[] = [];

  for (const store of stores.docs) {
    const snap = await col(store.id, "jobs")
      .where("status", "==", "scheduled")
      .limit(500)
      .get();
    scanned += snap.size;
    for (const d of snap.docs) {
      const job = d.data() as Job;
      if (job.runAt <= now) due.push(job);
    }
  }

  const results = await Promise.allSettled(
    due.map((j) => dispatchJob(j.storeId, j.jobId)),
  );
  const sent = results.filter(
    (r) => r.status === "fulfilled" && r.value.status === "sent",
  ).length;

  return NextResponse.json({
    ok: true,
    stores: stores.size,
    scanned,
    due: due.length,
    sent,
  });
}
