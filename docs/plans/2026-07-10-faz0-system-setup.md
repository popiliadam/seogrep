# Faz 0: Sistem Kurulumu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Çalışan verify kapısına sahip Turborepo monorepo iskeleti + anayasa/contract/goals/CI — henüz hiçbir feature yok.

**Architecture:** pnpm workspaces + Turborepo; apps/web (Next.js 15), apps/mcp (plain Node HTTP health servisi — MCP SDK Faz 3'te), packages/core, packages/db. Deterministik kapı `guardrails/verify.sh`; kalıcı hedefler `goals/*.md` içindeki ```predicate blokları.

**Tech Stack:** Node 22 · pnpm 11.9.0 · Turborepo ^2.5 · TypeScript ^5.7 · Next.js ^15.3 · React ^19 · Vitest ^3 · ESLint 9 (flat) + typescript-eslint · gitleaks (yerel kurulu: 8.30.1)

## Global Constraints

- Proje kökü: `/Users/apple/dev/pseo web saas` — **yol boşluk içeriyor**; script'lerde her yol `"çift tırnaklı"` olacak.
- `~/Documents/platinum-seo-engine` SALT OKUNUR — hiçbir task oraya yazamaz.
- Secret yok: `.env` gitignored; `.env.example` yalnız anahtar ADLARI, değerler boş.
- Commit formatı: `<type>: <description>` (feat/fix/refactor/docs/test/chore) + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` satırı.
- CLAUDE.md <150 satır; global `~/.claude/rules/*` içeriği TEKRAR edilmez.
- Tüm paketlerde aynı script isimleri: `typecheck`, `lint`, `test`, `build`.
- Paket adları: `@pseo/web`, `@pseo/mcp`, `@pseo/core`, `@pseo/db`. Kod adı `pseo-saas` (marka sonra rename).
- Yeni bağımlılık eklerken lisans MIT/Apache-2/ISC/BSD olmalı.

---

### Task 1: Kök iskelet (git + pnpm + turbo)

**Files:**
- Create: `.gitignore`, `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `eslint.config.mjs`, `.env.example`, `README.md`

**Interfaces:**
- Produces: kök `pnpm turbo run typecheck lint test build` komut zinciri; `tsconfig.base.json` (paketler `"extends": "../../tsconfig.base.json"` ile kullanır); kök flat ESLint config (paketler `export { default } from "../../eslint.config.mjs"` ile re-export eder).

- [ ] **Step 1: Dosyaları yaz**

`.gitignore`:
```
node_modules/
.next/
dist/
.turbo/
.env
.env.local
*.log
.DS_Store
coverage/
```

`package.json`:
```json
{
  "name": "pseo-saas",
  "private": true,
  "packageManager": "pnpm@11.9.0",
  "engines": { "node": ">=20" },
  "scripts": {
    "typecheck": "turbo run typecheck",
    "lint": "turbo run lint",
    "test": "turbo run test",
    "build": "turbo run build",
    "verify": "bash guardrails/verify.sh"
  },
  "devDependencies": {
    "turbo": "^2.5.0",
    "typescript": "^5.7.0",
    "eslint": "^9.20.0",
    "typescript-eslint": "^8.20.0"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`turbo.json`:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": [".next/**", "!.next/cache/**", "dist/**"] },
    "typecheck": { "dependsOn": ["^build"] },
    "lint": {},
    "test": { "dependsOn": ["^build"] }
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true,
    "resolveJsonModule": true
  }
}
```

`eslint.config.mjs`:
```js
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
```

`.env.example`:
```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=
REDIS_URL=
PADDLE_API_KEY=
PADDLE_WEBHOOK_SECRET=
DATAFORSEO_LOGIN=
DATAFORSEO_PASSWORD=
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
TOKEN_ENCRYPTION_KEY=
RESEND_API_KEY=
NEXT_PUBLIC_POSTHOG_KEY=
MCP_BASE_URL=
WEB_BASE_URL=
```

`README.md`:
```markdown
# pseo-saas (kod adı — marka Faz 0'da netleşecek)

Platinum SEO Engine'in hosted MCP SaaS'ı. Master spec: `docs/specs/2026-07-pseo-saas-design.md`.
Kurallar: `CLAUDE.md` · Sınırlar: `contract.md` · Kapı: `guardrails/verify.sh` · Durum: `PLAN.md`
```

- [ ] **Step 2: Install çalıştır ve doğrula**

Run: `cd "/Users/apple/dev/pseo web saas" && pnpm install`
Expected: exit 0, `pnpm-lock.yaml` oluşur.

Run: `pnpm turbo run typecheck lint test build`
Expected: exit 0 ("no tasks were executed" kabul — henüz paket yok).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: monorepo kök iskeleti (pnpm+turbo+eslint+tsconfig)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: packages/core + packages/db iskeleti

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/eslint.config.mjs`, `packages/core/vitest.config.ts`, `packages/core/src/index.ts`, `packages/core/src/index.test.ts`
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/eslint.config.mjs`, `packages/db/vitest.config.ts`, `packages/db/src/index.ts`, `packages/db/src/index.test.ts`

**Interfaces:**
- Consumes: Task 1'in `tsconfig.base.json` ve kök eslint config'i.
- Produces: `@pseo/core` → `CREDIT_BASE_USD: number` export'u; `@pseo/db` → `SCHEMA_VERSION: number` export'u. Her ikisi `dist/` üretir (`tsc`).

- [ ] **Step 1: core paketini yaz**

`packages/core/package.json`:
```json
{
  "name": "@pseo/core",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint src",
    "test": "vitest run",
    "build": "tsc -p tsconfig.json --noEmit false --declaration --outDir dist"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "eslint": "^9.20.0",
    "typescript-eslint": "^8.20.0"
  }
}
```

`packages/core/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "noEmit": true },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

`packages/core/eslint.config.mjs`:
```js
export { default } from "../../eslint.config.mjs";
```

`packages/core/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node" } });
```

`packages/core/src/index.ts`:
```ts
/** 1 kredinin taban USD karşılığı (spec §3). Fiyat değişikliği = insan onayı. */
export const CREDIT_BASE_USD = 0.01;
```

`packages/core/src/index.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { CREDIT_BASE_USD } from "./index.js";

describe("@pseo/core", () => {
  it("kredi taban değeri spec §3 ile aynı", () => {
    expect(CREDIT_BASE_USD).toBe(0.01);
  });
});
```

- [ ] **Step 2: db paketini yaz** (aynı yapı, farklı içerik)

`packages/db/package.json`: core'unkiyle birebir aynı, yalnız `"name": "@pseo/db"`.
`packages/db/tsconfig.json`, `packages/db/eslint.config.mjs`, `packages/db/vitest.config.ts`: core'daki dosyalarla birebir aynı içerik.

`packages/db/src/index.ts`:
```ts
/** Migration şeması Faz 2'de başlar; 0 = henüz şema yok. */
export const SCHEMA_VERSION = 0;
```

`packages/db/src/index.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "./index.js";

describe("@pseo/db", () => {
  it("şema sürümü Faz 2 öncesi 0", () => {
    expect(SCHEMA_VERSION).toBe(0);
  });
});
```

- [ ] **Step 3: Testlerin önce çalıştığını doğrula**

Run: `cd "/Users/apple/dev/pseo web saas" && pnpm install && pnpm turbo run typecheck lint test build --filter=@pseo/core --filter=@pseo/db`
Expected: exit 0; her iki pakette 1'er test PASS; `packages/*/dist/index.js` oluşur.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: @pseo/core ve @pseo/db paket iskeletleri

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: apps/web iskeleti (Next.js 15)

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.ts`, `apps/web/next-env.d.ts`, `apps/web/eslint.config.mjs`, `apps/web/vitest.config.ts`, `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`, `apps/web/app/page.test.tsx`

**Interfaces:**
- Consumes: Task 1 kök config'leri.
- Produces: `@pseo/web` — `next build` çıktısı; ana sayfada `<h1>` içinde "pseo-saas" metni (goals/landing-live Faz 1'de bunu gerçek markayla değiştirecek).

- [ ] **Step 1: Dosyaları yaz**

`apps/web/package.json`:
```json
{
  "name": "@pseo/web",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "lint": "eslint app",
    "test": "vitest run"
  },
  "dependencies": {
    "next": "^15.3.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@testing-library/react": "^16.2.0",
    "jsdom": "^26.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "eslint": "^9.20.0",
    "typescript-eslint": "^8.20.0"
  }
}
```

`apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "jsx": "preserve",
    "noEmit": true,
    "incremental": true,
    "allowJs": true,
    "isolatedModules": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules", ".next"]
}
```

`apps/web/next.config.ts`:
```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
```

`apps/web/next-env.d.ts`:
```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />
```

`apps/web/eslint.config.mjs`:
```js
export { default } from "../../eslint.config.mjs";
```

`apps/web/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "jsdom", include: ["app/**/*.test.tsx"] },
  esbuild: { jsx: "automatic" }
});
```

`apps/web/app/layout.tsx`:
```tsx
import type { ReactNode } from "react";

export const metadata = { title: "pseo-saas", description: "Hosted SEO MCP — coming soon" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

`apps/web/app/page.tsx`:
```tsx
export default function Home() {
  return (
    <main>
      <h1>pseo-saas</h1>
      <p>Hosted SEO MCP — coming soon.</p>
    </main>
  );
}
```

`apps/web/app/page.test.tsx`:
```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import Home from "./page";

describe("Home", () => {
  it("h1 kod adını gösteriyor", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("pseo-saas");
  });
});
```

- [ ] **Step 2: Doğrula**

Run: `cd "/Users/apple/dev/pseo web saas" && pnpm install && pnpm turbo run typecheck lint test build --filter=@pseo/web`
Expected: exit 0; 1 test PASS; `.next/` build çıktısı oluşur.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: apps/web Next.js 15 iskeleti (coming-soon sayfası + test)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: apps/mcp iskeleti (health servisi)

**Files:**
- Create: `apps/mcp/package.json`, `apps/mcp/tsconfig.json`, `apps/mcp/eslint.config.mjs`, `apps/mcp/vitest.config.ts`, `apps/mcp/src/server.ts`, `apps/mcp/src/server.test.ts`, `apps/mcp/src/index.ts`

**Interfaces:**
- Consumes: Task 1 kök config'leri.
- Produces: `createHealthServer(): http.Server` — `GET /health` → `200 {"status":"ok","service":"pseo-mcp"}`. Faz 3'te MCP SDK bu servise eklenecek.

- [ ] **Step 1: Failing test yaz**

`apps/mcp/src/server.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createHealthServer } from "./server.js";

describe("health server", () => {
  const server = createHealthServer();

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  });

  it("GET /health 200 döner", async () => {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", service: "pseo-mcp" });
  });

  it("bilinmeyen yol 404 döner", async () => {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/nope`);
    expect(res.status).toBe(404);
  });
});
```

Diğer dosyalar:

`apps/mcp/package.json`:
```json
{
  "name": "@pseo/mcp",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "scripts": {
    "dev": "node --watch --experimental-strip-types src/index.ts",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src",
    "test": "vitest run",
    "build": "tsc -p tsconfig.json --noEmit false --outDir dist"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "eslint": "^9.20.0",
    "typescript-eslint": "^8.20.0"
  }
}
```

`apps/mcp/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "noEmit": true, "types": ["node"] },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

`apps/mcp/eslint.config.mjs`:
```js
export { default } from "../../eslint.config.mjs";
```

`apps/mcp/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node" } });
```

- [ ] **Step 2: Testin FAIL ettiğini gör**

Run: `cd "/Users/apple/dev/pseo web saas/apps/mcp" && pnpm vitest run`
Expected: FAIL — `Cannot find module './server.js'`

- [ ] **Step 3: Implementasyon**

`apps/mcp/src/server.ts`:
```ts
import { createServer, type Server } from "node:http";

export function createHealthServer(): Server {
  return createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "pseo-mcp" }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });
}
```

`apps/mcp/src/index.ts`:
```ts
import { createHealthServer } from "./server.js";

const port = Number(process.env.PORT ?? 8787);
createHealthServer().listen(port, () => {
  console.warn(`pseo-mcp health listening on :${port}`);
});
```

- [ ] **Step 4: PASS doğrula**

Run: `cd "/Users/apple/dev/pseo web saas" && pnpm install && pnpm turbo run typecheck lint test build --filter=@pseo/mcp`
Expected: exit 0; 2 test PASS; `apps/mcp/dist/` oluşur.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: apps/mcp health servisi iskeleti (TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Guardrails + goals + Makefile

**Files:**
- Create: `guardrails/verify.sh`, `guardrails/verify-goals.sh`, `goals/repo-clean.md`, `goals/no-secrets.md`, `Makefile`

**Interfaces:**
- Consumes: kök `pnpm turbo run ...` zinciri (Task 1).
- Produces: `bash guardrails/verify.sh` (exit 0 = kapı yeşil) ve `bash guardrails/verify-goals.sh` (tüm goals predicate'leri). Sonraki TÜM fazlar bu iki komuta yaslanır.

- [ ] **Step 1: Script ve dosyaları yaz**

`guardrails/verify.sh`:
```bash
#!/usr/bin/env bash
# Deterministik kapı — son söz burada. Temiz repo'da exit 0.
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm install --frozen-lockfile
pnpm turbo run typecheck lint test build
echo "VERIFY: PASS"
```

`guardrails/verify-goals.sh`:
```bash
#!/usr/bin/env bash
# goals/*.md içindeki ```predicate bloklarını çalıştırır. exit 0 = tüm hedefler ayakta.
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
for f in goals/*.md; do
  [ -e "$f" ] || continue
  pred="$(awk '/^```predicate$/{flag=1;next}/^```$/{flag=0}flag' "$f")"
  if [ -z "$pred" ]; then
    echo "SKIP (predicate yok): $f"
    continue
  fi
  if bash -c "$pred" >/dev/null 2>&1; then
    echo "PASS: $f"
  else
    echo "FAIL: $f"
    fail=1
    awk '/^## on-violation$/{flag=1;next}/^## /{flag=0}flag' "$f"
  fi
done
exit "$fail"
```

`goals/repo-clean.md`:
````markdown
# goal: repo-clean
created: 2026-07-10
kaynak: Faz 0 kickoff — kapı her zaman yeşil kalır.

## predicate
```predicate
bash guardrails/verify.sh
```

## on-violation
Şüpheliler: son 5 commit (`git log --oneline -5`), bağımlılık güncellemeleri, node sürümü.
Runbook: hangi turbo task'ının kırıldığını bul → ilgili paket dizininde tek başına çalıştır → düzeltmeyi ayrı commit'le. Otomatik düzeltme YOK — rapor et.
````

`goals/no-secrets.md`:
````markdown
# goal: no-secrets
created: 2026-07-10
kaynak: Faz 0 kickoff — repo'da hiçbir zaman secret bulunmaz.

## predicate
```predicate
gitleaks detect --source . --no-banner
```

## on-violation
Şüpheliler: yeni eklenen config/env dosyaları, test fixture'ları.
Runbook: gitleaks çıktısındaki dosya+satırı incele → gerçek secret ise DERHAL insanı uyandır (rotate gerekir) → false positive ise .gitleaksignore'a gerekçeli satır ekle. Otomatik düzeltme YOK.
````

`Makefile`:
```makefile
.PHONY: verify goals dev

verify:
	bash guardrails/verify.sh

goals:
	bash guardrails/verify-goals.sh

dev:
	pnpm --filter @pseo/web dev
```

- [ ] **Step 2: Çalıştırılabilir yap ve doğrula**

Run: `cd "/Users/apple/dev/pseo web saas" && chmod +x guardrails/*.sh && bash guardrails/verify.sh && bash guardrails/verify-goals.sh`
Expected: her ikisi exit 0; çıktıda `VERIFY: PASS` ve `PASS: goals/repo-clean.md`, `PASS: goals/no-secrets.md`.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: verify kapısı + kalıcı hedefler (repo-clean, no-secrets) + Makefile

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Governance — CLAUDE.md + contract.md + verify-change skill + PLAN.md

**Files:**
- Create: `CLAUDE.md`, `contract.md`, `.claude/skills/verify-change/SKILL.md`, `PLAN.md`

**Interfaces:**
- Consumes: spec `docs/specs/2026-07-pseo-saas-design.md` §7 (metinlerin kaynağı).
- Produces: proje anayasası — sonraki tüm oturum ve subagent'ların okuyacağı yasalar.

- [ ] **Step 1: CLAUDE.md yaz** (tam içerik, <150 satır)

````markdown
# pseo-saas Anayasası

> Hosted SEO MCP SaaS. Master spec: `docs/specs/2026-07-pseo-saas-design.md` · Durum: `PLAN.md`
> Global kurallar (`~/.claude/rules/*`) aynen geçerlidir ve burada TEKRAR edilmez.

## DISPATCH — model seçim yasası

| Rol | Model | Ne zaman |
|---|---|---|
| Şef | Fable 5 (ana oturum) | İş seçimi, iş emri yazımı, faz kararları — kararların %100'ü |
| İşçi (varsayılan) | Opus 4.8 | Kolay olmayan her iş: feature, mimari kod, migration, MCP tool, entegrasyon |
| İşçi (kolay) | Sonnet 5 | Yalnız mekanik/dar işler: copy, fixture/mock, config, tekil küçük component, docs sayfası |
| Hakem | Taze Opus 4.8; ledger/webhook/auth/RLS diff'inde taze Fable 5 | Yalnız iş emri + diff görür; PASS/FAIL |
| Kapı | `guardrails/verify.sh` | Deterministik son söz — kimse kendi ödevine not vermez |

İşçi subagent yalnız kendi iş emrini görür (JSON: task, done_when, files_in_scope, forbidden).
Global `performance.md`'nin "model omit" kuralı bu projede kullanıcı talimatıyla override edildi (2026-07-10).

## NEVER

1. `~/Documents/platinum-seo-engine` SALT OKUNUR; yazma ihtiyacı = dur, insana sor.
2. `credit_ledger` append-only: UPDATE/DELETE asla; bakiye yalnız ledger toplamından türer.
3. Paddle webhook'u imza doğrulaması + `event_id` idempotency olmadan işlenmez.
4. Tenant filtresiz DB sorgusu yazılmaz; RLS hiçbir tabloda kapatılmaz.
5. Test/CI'da paralı API'ye gerçek çağrı = 0; dış API'ler `packages/core`'da mock/fixture arkasında. Dev smoke DFS bütçesi ≤$3/gün (`guardrails/dfs-budget.sh`, Faz 3).
6. Fiyat, kredi maliyeti, paket rakamları insan onayı olmadan değişmez (kod + docs + pricing).
7. Vitrine uydurma metrik/müşteri yorumu/logo konmaz.
8. Testi geçirmek için testi değiştirmek/silmek = otomatik FAIL.
9. Secret/endpoint/konvansiyon uydurma — dur ve sor.
10. Tek commit >200 satır → böl; bölünemiyorsa hakem Fable. Task toplam diff >400 satır → hakem her durumda Fable.

## WORDS

- "done" = done_when predicate'i geçti (kendi değerlendirmen değil).
- "small" = <50 satır. "cleanup" = davranış aynı + verify.sh önce/sonra yeşil.
- "tool DONE" = zod şema + handler + test + kredi maliyet satırı + docs sayfası — 5/5.

## DONE mekaniği

Her iş makine-kontrollü done_when ile başlar. İşi yapan DEĞİL, taze bağlamlı hakem subagent
iş emri + diff üzerinden doğrular (global qa-loop: ≤3 deneme, sonra eskalasyon).
Son söz `guardrails/verify.sh`. Biten işin done_when'i `goals/`a kalıcı hedef yazılır.

## Sınırlar

`contract.md`'ye bak. Özet: kod otonom; para + dış dünya insanda; uyandırma tetikleri orada.

## Ders döngüsü

Tekrarlayabilecek bir hata düzeltildiğinde ders buraya veya ilgili skill'e işlenir.
Haftalık compost: haftanın FAIL'lerinden ≤3 kural önerisi; insan imzalamadan kural olmaz.

## Komutlar

`make verify` (kapı) · `make goals` (kalıcı hedefler) · `make dev` (web dev server)
````

- [ ] **Step 2: contract.md yaz** (tam içerik)

```markdown
# contract.md — Sınırlar

## Otonom yapar (QA döngüsü + hakem + kapı korumasıyla)
- TÜM kod: auth, migrations, webhooks dahil.
- Branch'te UI/docs/marketing taslağı, test, mock/fixture, refactor.
- Yeni bağımlılık — hakem onayı + lisans kontrolü (MIT/Apache-2/ISC/BSD) şartıyla.

## İnsana kuyruğa atar (işi hazırlar, onay bekler)
- Prod'a İLK deploy · DNS/domain işlemleri · Paddle live mode'a geçiş.
- Fiyat/kredi/paket rakamı değişikliği · gerçek para harcaması (yeni servis/abonelik).
- Marka kararı · beta davetleri · launch yayınları (PH/HN/X).

## İnsanı uyandırır (işi DURDURUR, rapor eder)
- Aynı işte 2× FAIL (qa-loop eskalasyonu sonrası).
- Ledger invariant ihlali (balance != SUM(ledger)).
- Secret talebi / secret sızıntısı şüphesi.
- `~/Documents/platinum-seo-engine`e yazma ihtiyacı.
- Prod'da 5xx · günlük DFS bütçe limiti (≤$3) aşımı.
```

- [ ] **Step 3: verify-change skill'ini yaz**

`.claude/skills/verify-change/SKILL.md`:
```markdown
---
name: verify-change
description: Use when claiming any UI or behavioral change is complete — requires driving the real dev server and capturing evidence before any "done" claim.
---

# Verify Change

Bir değişikliğe "tamamlandı" demeden önce:

1. `make dev` ile gerçek dev server'ı başlat (apps/web) veya ilgili servisi çalıştır (apps/mcp).
2. Değişen akışı GERÇEKTEN kullan: sayfayı aç, tıkla, formu gönder (Claude Browser `preview_*` araçları).
3. Konsolda 0 hata şartı: `preview_console_logs` level=error boş dönmeli.
4. Kanıt topla: screenshot (`preview_screenshot`) veya log çıktısı — rapora ekle.
5. `bash guardrails/verify.sh` yeşil.

Kanıtsız "tamamlandı" iddiası YASAK. Kanıt yoksa iş bitmemiştir.
```

- [ ] **Step 4: PLAN.md yaz** (ilk durum)

```markdown
# PLAN.md — Canlı Durum

> Şef her oturuma buradan başlar. Format: faz · biten · sıradaki 3 iş · blokajlar · insan kuyruğu.

## Faz: 0 — Sistem kurulumu (devam ediyor)

## Biten
- (Task'lar bittikçe şef işler)

## Sıradaki 3 iş
1. Faz 0 task'larını bitir (plan: docs/plans/2026-07-10-faz0-system-setup.md)
2. Marka shortlist → insan seçimi
3. Faz 1 planı (landing + docs + waitlist)

## Blokajlar
- (yok)

## İnsan kuyruğu
- Marka seçimi (shortlist hazırlanıyor)
- Domain satın alma (marka sonrası)
```

- [ ] **Step 5: Satır sayısı kontrolü + commit**

Run: `wc -l CLAUDE.md`
Expected: < 150

```bash
git add -A && git commit -m "docs: anayasa (CLAUDE.md), contract, verify-change skill, PLAN.md

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: CI (GitHub Actions)

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `guardrails/verify.sh` (Task 5).
- Produces: push/PR'da kapıyı koşan CI. (Repo'yu şef açar — Task 8; bu task yalnız dosyayı hazırlar.)

- [ ] **Step 1: Workflow yaz**

`.github/workflows/ci.yml`:
```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: bash guardrails/verify.sh

  gitleaks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 2: YAML doğrula ve commit**

Run: `cd "/Users/apple/dev/pseo web saas" && node -e "const yaml=require('js-yaml')" 2>/dev/null || python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('YAML OK')"`
Expected: `YAML OK`

```bash
git add -A && git commit -m "ci: verify kapısı + gitleaks workflow

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Şef kapanışı (repo + kanıt + PLAN güncelleme)

> Bu task'ı şef (ana oturum) yürütür — subagent'a verilmez (gh auth + insan raporu içerir).

- [ ] **Step 1:** `gh repo create pseo-saas --private --source "/Users/apple/dev/pseo web saas" --push` (ad insana bildirilir; marka sonrası rename).
- [ ] **Step 2:** `bash guardrails/verify.sh && bash guardrails/verify-goals.sh` — çıktılar rapora ham haliyle girer.
- [ ] **Step 3:** PLAN.md güncelle: Faz 0 → tamamlandı; Faz 1'in ilk 3 işi done_when'leriyle.
- [ ] **Step 4:** Commit + push; insana rapor: kurulan dosya listesi, kanıt çıktıları, marka shortlist, Faz 1 önerisi.
