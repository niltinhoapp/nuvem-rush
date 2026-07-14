// TEMPORARIO: so pra depurar o mismatch entre o store_id do OAuth (user_id,
// confirmado 7865512) e o storeId que o token do Nexo estava resolvendo
// (8176369). Decodifica o JWT SEM verificar assinatura, so pra inspecionar
// os claims reais, e grava em stores/_debug/lastSessionToken pra olharmos
// pelo console do Firebase (o iframe e cross-origin, nao da pra ver o
// console/network dele direto do navegador). REMOVER depois de usar.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase/admin";

function b64urlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export async function POST(req: NextRequest) {
  const { token } = await req.json();
  if (typeof token !== "string") {
    return NextResponse.json({ error: "token ausente" }, { status: 400 });
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return NextResponse.json({ error: "token mal formado" }, { status: 400 });
  }

  let header: unknown;
  let payload: unknown;
  try {
    header = JSON.parse(b64urlDecode(parts[0]!).toString("utf8"));
    payload = JSON.parse(b64urlDecode(parts[1]!).toString("utf8"));
  } catch {
    return NextResponse.json({ error: "falha ao decodificar" }, { status: 400 });
  }

  await db.collection("stores").doc("_debug").set(
    { lastSessionToken: { header, payload, capturedAt: Date.now() } },
    { merge: true },
  );

  return NextResponse.json({ ok: true });
}
