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
