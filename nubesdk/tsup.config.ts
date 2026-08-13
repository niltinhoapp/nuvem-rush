import { defineConfig } from "tsup";

// Empacota o worker NubeSDK num único arquivo minificado dist/main.min.js
// (padrão create-nube-app / tsup). O bundle é servido em localhost:8080 no
// Local Mode e carregado pelo NubeSDK DevTools.
export default defineConfig({
  entry: { main: "src/main.ts" },
  format: ["esm"],
  minify: true,
  clean: true,
  outDir: "dist",
  // Injeta o endpoint público em build-time (sem segredo).
  define: {
    CART_SIGNAL_ENDPOINT: JSON.stringify(
      process.env.CART_SIGNAL_ENDPOINT ?? "https://nuvem-rush.vercel.app/api/storefront/cart-signal",
    ),
  },
  // Gera dist/main.min.js (em vez de dist/main.js).
  outExtension() {
    return { js: ".min.js" };
  },
});
