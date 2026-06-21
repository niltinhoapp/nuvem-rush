// Inicializacao do Nexo — ponte de comunicacao com o admin da Nuvemshop.
// Usado no frontend do app incorporado (dentro do iframe).
"use client";
import { create, connect, iAmReady, getSessionToken } from "@tiendanube/nexo";

let instance: ReturnType<typeof create> | null = null;

export function getNexo() {
  if (!instance) {
    instance = create({
      // clientId do Nexo = App ID da Nuvemshop (34663).
      clientId: process.env.NEXT_PUBLIC_NUVEMSHOP_APP_ID ?? "",
      log: process.env.NODE_ENV !== "production",
    });
  }
  return instance;
}

// Conecta ao admin e sinaliza que o app esta pronto para exibicao.
export async function initNexo() {
  const n = getNexo();
  await connect(n);
  iAmReady(n);
  return n;
}

// Pega o session token (JWT) que identifica a loja logada.
export async function sessionToken(): Promise<string> {
  return getSessionToken(getNexo());
}

// fetch autenticado: anexa o session token do Nexo no Authorization.
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = await sessionToken();
  return fetch(input, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });
}
