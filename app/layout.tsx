import type { ReactNode } from "react";
import "@nimbus-ds/styles/dist/index.css";

export const metadata = {
  title: "Nuvem Rush — Automacoes Pos-venda",
  description: "Automacoes avancadas de pos-venda para Nuvemshop.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
