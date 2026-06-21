// Pagina de suporte — exigida para homologacao na Nuvemshop.
export const metadata = { title: "Suporte — Nuvem Rush" };

const wrap: React.CSSProperties = {
  fontFamily: "system-ui", maxWidth: 760, margin: "0 auto", padding: "3rem 1.5rem",
  lineHeight: 1.6, color: "#1a1a1a",
};

export default function SuportePage() {
  return (
    <main style={wrap}>
      <h1>Suporte — Nuvem Rush</h1>
      <p>
        Precisa de ajuda com o Nuvem Rush? Estamos aqui para ajudar com instalação,
        configuração de automações e dúvidas sobre cobrança.
      </p>

      <h2>Canais de atendimento</h2>
      <ul>
        <li>E-mail: <a href="mailto:csinput@gmail.com">csinput@gmail.com</a></li>
        <li>Horário: dias úteis, das 9h às 18h (horário de Brasília).</li>
        <li>Tempo de resposta: até 1 dia útil.</li>
      </ul>

      <h2>Perguntas frequentes</h2>
      <p><strong>Como crio uma automação?</strong> Acesse a aba do Nuvem Rush no
        administrador da sua loja e use o construtor de fluxos "SE → ENTÃO".</p>
      <p><strong>Os disparos têm atraso?</strong> Você define o tempo de cada etapa
        (após X minutos, horas ou dias da compra).</p>
      <p><strong>Como cancelo?</strong> Basta desinstalar o aplicativo pelo painel da
        sua loja; seus dados são removidos conforme nossa
        <a href="/privacidade"> Política de Privacidade</a>.</p>
    </main>
  );
}
