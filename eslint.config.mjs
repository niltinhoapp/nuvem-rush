// ESLint flat config (Next 16 removeu o comando `next lint`).
// eslint-config-next@16 exporta flat config nativa — sem FlatCompat.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "public/**",
      "scripts/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
