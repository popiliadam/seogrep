import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/.next/**", "**/node_modules/**", "**/.turbo/**", "**/next-env.d.ts"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }]
    }
  }
);
