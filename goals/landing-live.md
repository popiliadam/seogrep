# goal: landing-live
created: 2026-07-10
kaynak: Faz 1 İş A — canlı site markayı servis ediyor. Deploy öncesi SKIP (PROD_URL set değilken exit 0); ilk prod deploy insan kapısından geçince anlam kazanır.

## predicate
```predicate
[ -z "${PROD_URL:-}" ] && exit 0; curl -sf --max-time 15 "$PROD_URL" | grep -q SeoGrep
```

## on-violation
Şüpheliler: son deploy, DNS/domain değişikliği, Vercel proje ayarları.
Runbook: `curl -sv "$PROD_URL"` ile HTTP durumunu ayırt et (DNS mi, 5xx mi, içerik mi) → Vercel deployment loglarına bak → 5xx ise İNSANI UYANDIR (contract.md). Otomatik düzeltme YOK.
