// Landing publica minima. A UI rica de marketing (Tailwind/shadcn) entra depois.
// O app de verdade roda em /dashboard (incorporado no admin da Nuvemshop).
export default function HomePage() {
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
