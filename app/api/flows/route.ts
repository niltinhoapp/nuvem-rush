// GET  /api/flows        -> lista fluxos da loja
// POST /api/flows        -> cria/atualiza fluxo (body: name, status, trigger, steps, flowId?)
import { NextRequest, NextResponse } from "next/server";
import { resolveStoreId } from "@/lib/auth/session";
import { listFlows, saveFlow } from "@/lib/flows/repo";
import { getStoreCommercialCache } from "@/lib/billing/sync.firestore";
import { isCommercialAccessGranted, resolveStoreCommercialState } from "@/lib/billing/policy";

export async function GET(req: NextRequest) {
  const storeId = resolveStoreId(req);
  if (!storeId) return NextResponse.json({ error: "loja nao identificada" }, { status: 401 });
  return NextResponse.json({ flows: await listFlows(storeId) });
}

export async function POST(req: NextRequest) {
  const storeId = resolveStoreId(req);
  if (!storeId) return NextResponse.json({ error: "loja nao identificada" }, { status: 401 });

  const body = await req.json();
  if (!body?.name || !body?.trigger || !Array.isArray(body?.steps)) {
    return NextResponse.json({ error: "payload invalido" }, { status: 400 });
  }

  // Gate comercial (Billing V1): so ATIVAR um fluxo (o que passa a gerar
  // jobs/custo) exige trial ainda valido ou assinatura ativa. Rascunho
  // continua sempre permitido — nao ha custo em salvar sem ativar. Isso e
  // defesa em profundidade: o dispatch tambem revalida no envio (o guard
  // real), este bloqueio so evita ativar algo que ja se sabe bloqueado.
  if ((body.status ?? "draft") === "active") {
    const commercialCache = await getStoreCommercialCache(storeId);
    const commercial = commercialCache ? resolveStoreCommercialState(commercialCache, Date.now()) : "billing_unknown";
    if (!isCommercialAccessGranted(commercial)) {
      return NextResponse.json(
        { error: "periodo gratis encerrado ou assinatura inativa", commercial },
        { status: 402 },
      );
    }
  }

  const flow = await saveFlow(storeId, {
    flowId: body.flowId,
    name: body.name,
    status: body.status ?? "draft",
    trigger: body.trigger,
    steps: body.steps,
  });
  return NextResponse.json({ flow });
}
