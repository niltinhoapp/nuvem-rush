"use client";
// Landing publica minima. A UI rica de marketing (Tailwind/shadcn) entra depois.
// O app de verdade roda em /dashboard (incorporado no admin da Nuvemshop).
//
// IMPORTANTE: o "Site do aplicativo" cadastrado no Partners e esta mesma URL
// raiz — e essa e a URL que a Nuvemshop carrega dentro do iframe do admin.
// Sem essa deteccao, quem abre o app pelo admin cai nesta landing estatica,
// que nunca dispara o handshake do Nexo, e a Nuvemshop mostra "Ocorreu um
// erro com o aplicativo" por timeout. Se estivermos dentro de um iframe,
// manda direto para /dashboard (que faz o initNexo()).
import { useEffect, useState } from "react";

export default function HomePage() {
  const [embedded, setEmbedded] = useState(false);

  useEffect(() => {
    if (window.self !== window.top) {
      setEmbedded(true);
      window.location.replace(`/dashboard${window.location.search}`);
    }
  }, []);

  if (embedded) return null; // evita piscar a landing antes do redirect

  return (
    <main style={{ fontFamily: "system-ui", padding: "3rem", maxWidth: 720 }}>
      <h1>Nuvem Rush</h1>
      <p>
        Automacoes avancadas de pos-venda para Nuvemshop: regras por produto,
        SKU, categoria, marca ou valor, com disparos agendados de e-mail e WhatsApp.
      </p>
      <p>
        <a href={`https://www.tiendanube.com/apps/${process.env.NEXT_PUBLIC_NUVEMSHOP_APP_ID}/authorize`}>
          Instalar na minha loja
        </a>
      </p>
    </main>
  );
}
