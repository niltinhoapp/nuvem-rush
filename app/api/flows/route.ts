// GET  /api/flows        -> lista fluxos da loja
// POST /api/flows        -> cria/atualiza fluxo (body: name, status, trigger, steps, flowId?)
import { NextRequest, NextResponse } from "next/server";
import { resolveStoreId } from "@/lib/auth/session";
import { listFlows, saveFlow } from "@/lib/flows/repo";

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

  const flow = await saveFlow(storeId, {
    flowId: body.flowId,
    name: body.name,
    status: body.status ?? "draft",
    trigger: body.trigger,
    steps: body.steps,
  });
  return NextResponse.json({ flow });
}
