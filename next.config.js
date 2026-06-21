/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Evita o Turbopack inferir a raiz errada por causa de lockfiles em D:\projetos.
  turbopack: { root: __dirname },
  // Libs Node com require dinamico (gRPC) nao podem ser empacotadas: rodam nativas.
  serverExternalPackages: ["@google-cloud/tasks", "firebase-admin"],
  async headers() {
    // App incorporado roda em iframe dentro do admin da Nuvemshop:
    // liberar o embedding apenas para os dominios da Nuvemshop.
    return [
      {
        source: "/dashboard/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors https://*.tiendanube.com https://*.nuvemshop.com.br;",
          },
        ],
      },
    ];
  },
};
module.exports = nextConfig;
