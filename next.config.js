/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Evita o Turbopack inferir a raiz errada por causa de lockfiles em D:\projetos.
  turbopack: { root: __dirname },
  // firebase-admin usa require dinamico: nao empacotar, rodar nativo.
  serverExternalPackages: ["firebase-admin"],
  async headers() {
    // App incorporado roda em iframe dentro do admin da Nuvemshop:
    // liberar o embedding apenas para os dominios da Nuvemshop.
    const csp = {
      key: "Content-Security-Policy",
      // Dominios onde o admin da Nuvemshop/Tiendanube roda (BR e demais).
      value:
        "frame-ancestors https://*.tiendanube.com https://*.nuvemshop.com.br " +
        "https://*.lojavirtualnuvem.com.br https://*.mitiendanube.com;",
    };
    // Cobre a raiz (Site do aplicativo cadastrado no Partners = URL do embed)
    // e tanto /dashboard quanto /dashboard/...
    return [
      { source: "/", headers: [csp] },
      { source: "/dashboard", headers: [csp] },
      { source: "/dashboard/:path*", headers: [csp] },
    ];
  },
};
module.exports = nextConfig;
