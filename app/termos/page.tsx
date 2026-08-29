export const metadata = { title: "Termos de Uso - Nuvem Rush" };

const wrap: React.CSSProperties = {
  fontFamily: "system-ui", maxWidth: 760, margin: "0 auto", padding: "3rem 1.5rem",
  lineHeight: 1.6, color: "#1a1a1a",
};

// HUMAN_CONTENT_REQUIRED: confirmar a identificação jurídica completa do
// fornecedor antes da publicação, caso ela seja exigida no cadastro oficial.
export default function TermosPage() {
  return (
    <main style={wrap}>
      <h1>Termos de Uso - Nuvem Rush</h1>
      <p><em>Última atualização: 20 de agosto de 2026.</em></p>

      <p>
        Estes Termos de Uso regulam o acesso e o uso do Nuvem Rush, aplicativo
        integrado à Nuvemshop para configuração e execução de automações de
        relacionamento e pós-venda.
      </p>

      <h2>1. Finalidade do serviço</h2>
      <p>
        O Nuvem Rush permite ao lojista criar fluxos automatizados a partir de
        eventos e dados autorizados da loja, incluindo comunicações por canais
        configurados pelo próprio lojista.
      </p>

      <h2>2. Uso do serviço e responsabilidades do lojista</h2>
      <p>
        O lojista é responsável pelas automações que configurar, pelo conteúdo
        das mensagens, pela escolha dos destinatários e pelo uso do aplicativo em
        conformidade com a legislação, com as regras da Nuvemshop e com as
        políticas dos provedores integrados. Também deve manter suas configurações
        e credenciais de integração corretas e atualizadas.
      </p>

      <h2>3. Integrações de terceiros</h2>
      <p>
        O funcionamento pode depender de serviços da Nuvemshop e de provedores de
        infraestrutura, armazenamento, e-mail e mensagens. A disponibilidade e as
        regras desses serviços são definidas pelos respectivos fornecedores.
      </p>

      <h2>4. Automações e mensagens</h2>
      <p>
        As automações são executadas de acordo com os fluxos ativos e as
        configurações mantidas pelo lojista. O lojista deve possuir base legal e
        autorização adequadas para as comunicações realizadas e respeitar pedidos
        de oposição, bloqueio ou exclusão aplicáveis.
      </p>

      <h2>5. Disponibilidade e alterações</h2>
      <p>
        O serviço pode passar por manutenção, correções e alterações necessárias à
        segurança, à compatibilidade ou à evolução do produto. Não é garantida
        disponibilidade ininterrupta, especialmente quando houver dependência de
        serviços de terceiros.
      </p>

      <h2>6. Privacidade e proteção de dados</h2>
      <p>
        O tratamento de dados pessoais segue a nossa <a href="/privacidade">Política
        de Privacidade</a> e os processos aplicáveis de proteção de dados e LGPD.
        O lojista continua responsável pelas decisões de tratamento realizadas no
        contexto de sua operação.
      </p>

      <h2>7. Propriedade intelectual</h2>
      <p>
        O software, a identidade visual e os materiais do Nuvem Rush são protegidos
        pela legislação aplicável. O uso do serviço não transfere ao lojista direitos
        sobre o código, marcas ou outros ativos do aplicativo.
      </p>

      <h2>8. Limitações razoáveis</h2>
      <p>
        O Nuvem Rush não se responsabiliza por falhas causadas por configuração
        incorreta do lojista, indisponibilidade de terceiros, bloqueios impostos por
        provedores ou uso contrário à legislação e às políticas aplicáveis.
      </p>

      <h2>9. Suspensão e encerramento</h2>
      <p>
        O acesso pode ser suspenso em caso de uso indevido, risco de segurança ou
        descumprimento destes Termos. O lojista pode encerrar o uso desinstalando o
        aplicativo; a interrupção do processamento e o tratamento posterior dos
        dados seguem a Política de Privacidade e os processos aplicáveis.
      </p>

      <h2>10. Suporte</h2>
      <p>
        Dúvidas sobre estes Termos ou sobre o serviço podem ser encaminhadas pelos
        canais da página de <a href="/suporte">Suporte</a>.
      </p>
    </main>
  );
}
