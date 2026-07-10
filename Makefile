.PHONY: verify goals dev

verify:
	bash guardrails/verify.sh

goals:
	bash guardrails/verify-goals.sh

dev:
	pnpm --filter @pseo/web dev
