// Endpoint ADMIN temporario: registra o NUMERO GLOBAL do Nuvem Rush na Cloud
// API. Sem esse registro a Graph API recusa qualquer envio com o erro
// "(#133010) Account not registered" — foi exatamente o que o botao
// "Enviar mensagem de teste" retornou.
//
// O registro normalmente acontece dentro do Embedded Signup (rota
// /api/whatsapp/connect), mas o numero global nunca passou por la: o Embedded
// Signup nao pode ser usado pelo portfolio que e dono do proprio app.
//
// Uso: GET /api/admin/register-whatsapp-number?key=<WHATSAPP_WEBHOOK_VERIFY_TOKEN>
// Pode (e deve) ser removido depois que o numero estiver registrado.
import { NextRequest, NextResponse } from "next/server";
import { registerPhoneNumber } from "@/lib/whatsapp/embedded";

export async function GET(req: NextRequest) {
  // Aceita ADMIN_API_KEY (variavel dedicada) ou, como alternativa, a
  // WHATSAPP_WEBHOOK_VERIFY_TOKEN. Ver comentario em whatsapp-diagnostico.
  const key = req.nextUrl.searchParams.get("key");
  const expected =
    process.env.ADMIN_API_KEY ?? process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (!expected || !key || key !== expected) {
    return NextResponse.json({ error: "nao autorizado" }, { status: 403 });
  }

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !token) {
    return NextResponse.json(
      { error: "WHATSAPP_PHONE_NUMBER_ID ou WHATSAPP_ACCESS_TOKEN ausentes" },
      { status: 500 },
    );
  }

  try {
    const result = await registerPhoneNumber(phoneNumberId, token);
    return NextResponse.json({
      phoneNumberId,
      ...result,
      hint: result.alreadyRegistered
        ? "numero ja estava registrado — o erro 133010 tem outra causa"
        : "numero registrado; tente o botao 'Enviar mensagem de teste' novamente",
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
