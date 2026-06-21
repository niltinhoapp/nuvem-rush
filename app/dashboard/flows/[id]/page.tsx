"use client";
// Pagina do construtor de fluxos. /dashboard/flows/new ou /dashboard/flows/{id}
// Embarcado: identidade vem do session token do Nexo.
// Dev: passe ?storeId=... para usar o atalho x-store-id.
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { sessionToken } from "@/lib/nexo";
import type { Flow } from "@/types";

const FlowBuilder = dynamic(() => import("@/components/flow-builder/FlowBuilder"), {
  ssr: false,
});

export default function FlowPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const isNew = params.id === "new";
  const devStoreId = search.get("storeId") ?? undefined;

  const [flow, setFlow] = useState<Flow | undefined>(undefined);
  const [loading, setLoading] = useState(!isNew);

  useEffect(() => {
    if (isNew) return;
    (async () => {
      const headers: Record<string, string> = devStoreId
        ? { "x-store-id": devStoreId }
        : { Authorization: `Bearer ${await sessionToken()}` };
      const r = await fetch(`/api/flows/${params.id}`, { headers });
      const d = await r.json();
      setFlow(d.flow);
      setLoading(false);
    })().catch(() => setLoading(false));
  }, [isNew, params.id, devStoreId]);

  if (loading) return <main style={{ padding: 32 }}>Carregando fluxo...</main>;

  return (
    <main style={{ padding: 16 }}>
      <FlowBuilder devStoreId={devStoreId} initialFlow={flow} />
    </main>
  );
}
