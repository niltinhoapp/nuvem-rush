// Politica de privacidade (LGPD) — exigida para homologacao na Nuvemshop.
export const metadata = { title: "Política de Privacidade — Nuvem Rush" };

const wrap: React.CSSProperties = {
  fontFamily: "system-ui", maxWidth: 760, margin: "0 auto", padding: "3rem 1.5rem",
  lineHeight: 1.6, color: "#1a1a1a",
};

export default function PrivacidadePage() {
  return (
    <main style={wrap}>
      <h1>Política de Privacidade — Nuvem Rush</h1>
      <p><em>Última atualização: 21 de junho de 2026.</em></p>

      <p>
        O Nuvem Rush (&quot;aplicativo&quot;) é uma ferramenta de automação de pós-venda
        integrada à Nuvemshop. Esta política descreve como tratamos os dados das
        lojas e de seus clientes, em conformidade com a Lei Geral de Proteção de
        Dados (LGPD, Lei nº 13.709/2018).
      </p>

      <h2>1. Dados que coletamos</h2>
      <p>Ao instalar o aplicativo, e mediante as permissões concedidas, acessamos:</p>
      <ul>
        <li><strong>Pedidos</strong>: itens, SKU, categoria, marca, valores e quantidades.</li>
        <li><strong>Produtos</strong>: nome, categoria e marca, para classificar os pedidos.</li>
        <li><strong>Clientes</strong>: nome, e-mail e telefone, para envio das comunicações.</li>
      </ul>

      <h2>2. Como usamos os dados</h2>
      <p>
        Os dados são usados exclusivamente para executar as automações de pós-venda
        configuradas pela loja (envio de e-mails, mensagens e tarefas em datas
        programadas). Não vendemos nem compartilhamos dados com terceiros para fins
        de marketing.
      </p>

      <h2>3. Compartilhamento com operadores</h2>
      <p>
        Utilizamos provedores que atuam como operadores de dados: Google Firebase
        (armazenamento), Vercel (hospedagem) e provedores de envio (e-mail/mensagem)
        configurados pela loja. Cada um trata os dados apenas para viabilizar o serviço.
      </p>

      <h2>4. Retenção e exclusão</h2>
      <p>
        Os dados são mantidos enquanto o aplicativo estiver instalado. Ao desinstalar,
        ou mediante solicitação via os webhooks de LGPD (<code>store/redact</code>,
        <code>customers/redact</code>), os dados pessoais são removidos ou anonimizados.
        Solicitações de acesso (<code>customers/data_request</code>) são atendidas
        conforme a lei.
      </p>

      <h2>5. Direitos do titular</h2>
      <p>
        O titular pode solicitar acesso, correção ou exclusão dos seus dados pela loja
        onde realizou a compra, ou diretamente pelo nosso suporte.
      </p>

      <h2>6. Contato</h2>
      <p>
        Dúvidas sobre privacidade: <a href="mailto:csinput@gmail.com">csinput@gmail.com</a>.
      </p>
    </main>
  );
}
