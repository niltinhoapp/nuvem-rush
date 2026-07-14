// Tela inicial do app incorporado (roda dentro do iframe do admin).
// HTML puro para garantir renderizacao + handshake do Nexo (sem risco de API
// de componente). O visual Nimbus refinado entra depois, com API verificada.
"use client";
import { useEffect, useState } from "react";
import { initNexo, sessionToken } from "@/lib/nexo";

export default function DashboardPage() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    initNexo()
      .then(async () => {
        setStatus("ready");
        // TEMPORARIO: captura o session token real pra debugar o mismatch
        // de storeId (ver app/api/debug/session/route.ts). Remover depois.
        try {
          const token = await sessionToken();
          await fetch("/api/debug/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
          });
        } catch (e) {
          console.warn("Debug session token falhou:", e);
        }
      })
      .catch((e) => {
        console.error("Nexo falhou:", e);
        setStatus("error");
      });
  }, []);

  return (
    <main style={{ fontFamily: "system-ui", padding: 24, maxWidth: 720 }}>
      <h1 style={{ marginTop: 0 }}>Nuvem Rush</h1>
      <p style={{ color: status === "ready" ? "#00a650" : "#666" }}>
        {status === "ready"
          ? "Conectado ao admin da Nuvemshop."
          : status === "error"
            ? "Rodando (sem conexao com o admin)."
            : "Conectando ao admin..."}
      </p>

      <div style={{ border: "1px solid #e0e0e0", borderRadius: 12, padding: 20, marginTop: 16 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Seus fluxos de automação</h2>
        <p style={{ color: "#444" }}>
          Crie regras do tipo SE (produto / SKU / categoria / valor) ENTÃO
          (e-mail / WhatsApp após X dias).
        </p>
        <a
          href="/dashboard/flows/new"
          style={{
            display: "inline-block", marginTop: 8, padding: "10px 16px",
            background: "#3483fa", color: "#fff", borderRadius: 8,
            textDecoration: "none", fontWeight: 500,
          }}
        >
          Criar novo fluxo
        </a>
      </div>
    </main>
  );
}
