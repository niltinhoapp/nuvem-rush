// Ingestão do SINAL de carrinho vindo do módulo NubeSDK (Web Worker, storefront).
//
// SEGURANÇA — o sinal é UNTRUSTED INPUT:
// - CORS restritivo; valida estrutura/tipos/limites (zod .strict);
// - NÃO seleciona a loja pelo storeId do cliente: o sinal é gravado numa coleção
//   GLOBAL por cartId; a loja dona é resolvida SERVER-SIDE pela API oficial
//   (cron cart-signals). storeId do payload é só telemetria (bloqueador 1);
// - usa o RELÓGIO DO SERVIDOR (receivedAt); ignora o timestamp do cliente
//   (bloqueador 4);
// - COMPLETED do browser é só HINT; nunca encerra (bloqueador 2);
// - status "terminal" (setado server-side) NUNCA regride (bloqueador 3, atômico);
// - NÃO envia mensagem, NÃO acessa dado privado, NÃO altera pedido/loja.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase/admin";
import { corsHeaders, isAllowedOrigin } from "@/lib/storefront/cors";
import { parseCartSignal } from "@/lib/storefront/cartSignal";
import { reduceSignalDoc, type SignalDoc } from "@/lib/storefront/signalDoc";

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);

  if (!isAllowedOrigin(origin)) {
    return NextResponse.json({ error: "origem nao permitida" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "json invalido" }, { status: 400, headers: cors });
  }

  const parsed = parseCartSignal(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: "payload invalido", detail: parsed.error }, { status: 400, headers: cors });
  }

  const { cartId, phase, storeId } = parsed.data;
  const receivedAt = Date.now(); // relógio do servidor = autoridade

  // Coleção GLOBAL por cartId (a loja é resolvida server-side, não pelo cliente).
  const ref = db.collection("cart_signals").doc(cartId);

  // Transação: terminal não regride; atividade renovada com tempo do servidor.
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists ? (snap.data() as SignalDoc) : null;
    const nextDoc = reduceSignalDoc(existing, { cartId, phase, receivedAt, storeId });
    tx.set(ref, nextDoc); // no-op efetivo se já terminal (mesmo objeto)
  });

  return NextResponse.json({ ok: true }, { headers: cors });
}
