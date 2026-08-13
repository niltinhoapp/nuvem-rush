// Ingestão do SINAL de carrinho vindo do módulo NubeSDK (Web Worker, storefront).
//
// SEGURANÇA — o sinal é UNTRUSTED INPUT:
// - CORS restritivo (só origens de storefront legítimas);
// - valida estrutura/tipos/limites (zod .strict);
// - NÃO envia WhatsApp/e-mail, NÃO acessa dado privado, NÃO altera pedido/loja;
// - apenas REGISTRA o sinal. A inscrição real ocorre server-side (cron
//   cart-signals), reconfirmando via API oficial da Nuvemshop.
// Nenhum segredo é exigido/aceito aqui.
import { NextRequest, NextResponse } from "next/server";
import { col } from "@/lib/firebase/admin";
import { corsHeaders, isAllowedOrigin } from "@/lib/storefront/cors";
import { parseCartSignal } from "@/lib/storefront/cartSignal";

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);

  // Origem não permitida: rejeita (defesa em profundidade; o sinal já é untrusted).
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

  const { storeId, cartId, phase, at } = parsed.data;

  // Upsert idempotente por cartId: sinais repetidos colapsam num único doc
  // (limita crescimento; spam do mesmo carrinho não multiplica escrita).
  const ref = col(storeId, "cart_signals").doc(cartId);
  if (phase === "COMPLETED") {
    // Compra concluída -> impede recuperação (autoridade final é o webhook de
    // pedido, mas já marcamos aqui para não inscrever).
    await ref.set({ storeId, cartId, status: "completed", lastEventAt: at, completedAt: at }, { merge: true });
  } else {
    await ref.set({ storeId, cartId, status: "checkout_started", lastEventAt: at }, { merge: true });
  }

  // Resposta mínima — nunca devolve dados do carrinho/cliente.
  return NextResponse.json({ ok: true }, { headers: cors });
}
