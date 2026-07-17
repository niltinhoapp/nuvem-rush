"use client";
// Pagina standalone de conexao do WhatsApp (Embedded Signup da Meta).
// Aberta pelo dashboard em NOVA ABA (popups da Meta nao funcionam bem dentro
// do iframe do admin Nuvemshop): /connect-whatsapp?token=<sessionToken>
//
// Fluxo: carrega o SDK JS do Facebook -> FB.login(config_id) abre o popup
// oficial da Meta onde o LOJISTA cria/escolhe a conta WhatsApp Business dele
// -> o popup posta uma mensagem WA_EMBEDDED_SIGNUP com waba_id +
// phone_number_id e o FB.login devolve um `code` -> enviamos tudo ao backend
// (/api/whatsapp/connect) que finaliza a conexao.
//
// Env (frontend): NEXT_PUBLIC_META_APP_ID, NEXT_PUBLIC_WHATSAPP_ES_CONFIG_ID.
import { useCallback, useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    FB?: {
      init: (opts: Record<string, unknown>) => void;
      login: (
        cb: (resp: { authResponse?: { code?: string } }) => void,
        opts: Record<string, unknown>,
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

type Status =
  | "loading"      // carregando SDK / status atual
  | "ready"        // pronto pra conectar
  | "connecting"   // popup aberto / backend processando
  | "connected"    // tudo certo
  | "error";

export default function ConnectWhatsappPage() {
  const [status, setStatus] = useState<Status>("loading");
  const [detail, setDetail] = useState<string>("");
  // waba_id/phone_number_id chegam via postMessage; o code chega no callback
  // do FB.login — juntamos os dois antes de chamar o backend.
  const signupData = useRef<{ wabaId?: string; phoneNumberId?: string }>({});

  const sessionToken =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("token") ?? ""
      : "";

  const finalize = useCallback(
    async (code: string) => {
      const { wabaId, phoneNumberId } = signupData.current;
      if (!wabaId || !phoneNumberId) {
        setStatus("error");
        setDetail("Dados da conta nao recebidos. Feche e tente de novo.");
        return;
      }
      setStatus("connecting");
      setDetail("Finalizando a conexao...");
      const res = await fetch("/api/whatsapp/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({ code, wabaId, phoneNumberId }),
      });
      if (res.ok) {
        setStatus("connected");
        setDetail(
          "WhatsApp conectado! O modelo de mensagem de pos-venda foi enviado " +
            "para aprovacao da Meta (leva de minutos a 24h). Pode fechar esta aba.",
        );
      } else {
        const body = await res.json().catch(() => ({}));
        setStatus("error");
        setDetail(body.error ?? "Falha ao finalizar a conexao. Tente novamente.");
      }
    },
    [sessionToken],
  );

  useEffect(() => {
    // Mensagens do popup do Embedded Signup (waba_id, phone_number_id).
    function onMessage(event: MessageEvent) {
      if (!event.origin.endsWith("facebook.com")) return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === "WA_EMBEDDED_SIGNUP" && data.event === "FINISH") {
          signupData.current = {
            wabaId: data.data?.waba_id,
            phoneNumberId: data.data?.phone_number_id,
          };
        }
      } catch {
        /* mensagens de outros formatos — ignora */
      }
    }
    window.addEventListener("message", onMessage);

    // Carrega o SDK JS do Facebook.
    window.fbAsyncInit = () => {
      window.FB?.init({
        appId: process.env.NEXT_PUBLIC_META_APP_ID,
        autoLogAppEvents: true,
        xfbml: true,
        version: "v22.0",
      });
      setStatus("ready");
    };
    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    document.body.appendChild(script);

    return () => window.removeEventListener("message", onMessage);
  }, []);

  function launchSignup() {
    if (!window.FB) return;
    setStatus("connecting");
    setDetail("Siga os passos na janela da Meta...");
    window.FB.login(
      (resp) => {
        const code = resp.authResponse?.code;
        if (code) void finalize(code);
        else {
          setStatus("ready");
          setDetail("Conexao cancelada. Quando quiser, tente de novo.");
        }
      },
      {
        config_id: process.env.NEXT_PUBLIC_WHATSAPP_ES_CONFIG_ID,
        response_type: "code", // code -> trocado por token no backend
        override_default_response_type: true,
        extras: { setup: {}, sessionInfoVersion: "3" },
      },
    );
  }

  return (
    <main
      style={{
        maxWidth: 480,
        margin: "80px auto",
        padding: 24,
        fontFamily: "system-ui, sans-serif",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Conectar WhatsApp</h1>
      <p style={{ color: "#555", marginBottom: 24 }}>
        Conecte a conta de WhatsApp Business <strong>da sua loja</strong> para
        enviar mensagens de pos-venda pelo seu proprio numero.
      </p>

      {status === "connected" ? (
        <p style={{ color: "#0a7d33", fontWeight: 600 }}>{detail}</p>
      ) : (
        <>
          <button
            onClick={launchSignup}
            disabled={status === "loading" || status === "connecting"}
            style={{
              background: "#25D366",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "12px 28px",
              fontSize: 16,
              fontWeight: 600,
              cursor: "pointer",
              opacity: status === "loading" || status === "connecting" ? 0.6 : 1,
            }}
          >
            {status === "connecting" ? "Conectando..." : "Conectar com a Meta"}
          </button>
          {detail && (
            <p style={{ marginTop: 16, color: status === "error" ? "#c0392b" : "#555" }}>
              {detail}
            </p>
          )}
        </>
      )}
    </main>
  );
}
