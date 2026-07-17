// Webhook do WhatsApp (Meta Cloud API).
// A Meta exige um endpoint inscrito para "reconhecer a integracao ativa" da
// WABA — sem isso, o WhatsApp Manager pode ate bloquear a gestao de modelos.
//
// GET  -> verificacao do webhook (handshake com hub.challenge).
// POST -> recebe eventos (status de mensagem, aprovacao/rejeicao de template).
//
// Env: WHATSAPP_WEBHOOK_VERIFY_TOKEN (string que voce mesmo define; precisa
// ser IGUAL a digitada no painel da Meta ao configurar o webhook).
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    // A Meta espera o challenge de volta em texto puro.
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "verificacao invalida" }, { status: 403 });
}

export async function POST(req: NextRequest) {
  // Por enquanto so registramos o evento; statuses de entrega e de template
  // podem alimentar os logs por loja no futuro.
  try {
    const body = await req.json();
    console.log("[whatsapp webhook]", JSON.stringify(body).slice(0, 2000));
  } catch {
    // corpo vazio/invalido — ignora
  }
  // Sempre 200 rapido para a Meta nao reenviar/desativar o webhook.
  return NextResponse.json({ received: true });
}
