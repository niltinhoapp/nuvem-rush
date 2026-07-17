// Endpoint ADMIN temporario: cria o template "pos_venda_agradecimento" na
// WABA via Graph API, usando o WHATSAPP_ACCESS_TOKEN do ambiente (o token
// nunca sai do servidor). Existe porque a interface do WhatsApp Manager
// esta bloqueando "gerenciar modelos" mesmo com o backend em conformidade.
//
// Uso: GET /api/admin/create-whatsapp-template?key=<WHATSAPP_WEBHOOK_VERIFY_TOKEN>
// Pode (e deve) ser removido depois que o template for criado/aprovado.
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!key || key !== process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return NextResponse.json({ error: "nao autorizado" }, { status: 403 });
  }

  const wabaId = process.env.WHATSAPP_WABA_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!wabaId || !token) {
    return NextResponse.json(
      { error: "WHATSAPP_WABA_ID ou WHATSAPP_ACCESS_TOKEN ausentes" },
      { status: 500 },
    );
  }

  const res = await fetch(
    `https://graph.facebook.com/v22.0/${wabaId}/message_templates`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "pos_venda_agradecimento",
        language: "pt_BR",
        category: "MARKETING",
        components: [
          {
            type: "BODY",
            text:
              "Ola {{1}}! Muito obrigado pela sua compra. Qualquer duvida " +
              "sobre o pedido, e so responder por aqui. Para nao receber " +
              "mais mensagens promocionais, responda SAIR.",
            example: { body_text: [["Maria"]] },
          },
        ],
      }),
    },
  );

  const body = await res.json().catch(() => ({}));
  return NextResponse.json({ status: res.status, body });
}
