.PHONY: verify verify-db goals dev

verify:
	bash guardrails/verify.sh

# The DB-integration lane. Kept out of `verify` (that gate stays DB-less and fast), but a
# make target so it is as easy to reach as the others — a gate nobody can invoke is a gate
# nobody runs. Needs Docker + the pinned supabase CLI.
verify-db:
	bash guardrails/verify-db.sh

goals:
	bash guardrails/verify-goals.sh

dev:
	pnpm --filter @pseo/web dev
