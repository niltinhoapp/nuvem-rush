// Pagina de sucesso pos-instalacao (OAuth). Simples, sem Nexo — nao trava
// quando a instalacao acontece fora do iframe do admin.
export const metadata = { title: "Nuvem Rush instalado" };

export default function InstaladoPage() {
  return (
    <main style={{ fontFamily: "system-ui", padding: 40, maxWidth: 560, margin: "0 auto", textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 8 }}>✅</div>
      <h1 style={{ margin: "0 0 8px" }}>Nuvem Rush instalado!</h1>
      <p style={{ color: "#555", lineHeight: 1.6 }}>
        Seu app foi conectado à loja com sucesso. Volte ao painel da sua loja e
        abra a aba <strong>Nuvem Rush</strong> para configurar suas automações.
      </p>
    </main>
  );
}
