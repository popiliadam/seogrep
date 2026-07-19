# goal: dfs-budget-guard
created: 2026-07-19
kaynak: Faz 3 T11 done_when + NEVER #5 — DataForSEO dev-smoke günlük bütçesi <= $3/gün; canlı çağrılar guardrails/.dfs-spend'e yazılır, bu kapı günün toplamını eşiğe karşı korur.

## predicate
```predicate
bash guardrails/dfs-budget.sh
```

## on-violation
Şüpheliler: guardrails/.dfs-spend/<bugün>.jsonl'de birikmiş canlı DFS harcaması (dev smoke), apps/mcp/src/dfs/budget.ts recordSpend maliyet çıkarımı, canlı client'ın çağrı sayısı.
Runbook: <bugün>.jsonl dökümünü incele → $3 eşiği DEV smoke'ta aşıldıysa DUR ve insanı uyandır (contract uyandırma sınıfı: para / dış dünya) → canlı akışı kapat (DFS_LIVE unset) ve harcama kaynağını doğrula. Otomatik düzeltme YOK — rapor et. Test/CI'da gerçek çağrı=0 olduğundan bu dosya normalde yoktur (dosya yoksa exit 0).
