// Endpoint ADMIN de DIAGNOSTICO: mostra o estado real do numero e da WABA
// segundo a Graph API. Criado para investigar o erro "(#133010) Account not
// registered", que persiste mesmo apos chamar /register.
//
// Responde tres perguntas:
//   1. O WHATSAPP_PHONE_NUMBER_ID existe e o token enxerga esse numero?
//   2. Qual o status de registro/verificacao dele?
//   3. Quais numeros existem de fato na WABA (para achar o ID correto)?
//
// Uso: GET /api/admin/whatsapp-diagnostico?key=<WHATSAPP_WEBHOOK_VERIFY_TOKEN>
// Nao expoe o token: apenas consulta e devolve os metadados.
import { NextRequest, NextResponse } from "next/server";

const GRAPH = "https://graph.facebook.com/v22.0";

async function get(url: string, token: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!key || key !== process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return NextResponse.json({ error: "nao autorizado" }, { status: 403 });
  }

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const wabaId = process.env.WHATSAPP_WABA_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "WHATSAPP_ACCESS_TOKEN ausente" }, { status: 500 });
  }

  const fields =
    "id,display_phone_number,verified_name,status,platform_type," +
    "code_verification_status,quality_rating";

  // 1. O numero configurado no ambiente.
  const numero = phoneNumberId
    ? await get(`${GRAPH}/${phoneNumberId}?fields=${fields}`, token)
    : { status: 0, body: { error: "WHATSAPP_PHONE_NUMBER_ID ausente" } };

  // 2. Todos os numeros da WABA — revela o ID correto se o do ambiente estiver errado.
  const numerosDaWaba = wabaId
    ? await get(`${GRAPH}/${wabaId}/phone_numbers?fields=${fields}`, token)
    : { status: 0, body: { error: "WHATSAPP_WABA_ID ausente" } };

  return NextResponse.json({
    configurado: { phoneNumberId, wabaId },
    numeroConfigurado: numero,
    numerosDaWaba,
  });
}
