#!/usr/bin/env bash
# Canlı smoke — vendor'ın BUGÜN ne döndürdüğünü ölçer.
#
# NEDEN VAR. Sevk edilen tool'ların fixture'larının 21/25'i DataForSEO'nun
# DOKÜMANTASYON örnekleri, ölçülmüş yanıt değil (fixture id'leri "…fixture0007"
# diye biter; gerçek yakalamanın DFS uuid'si vardır). Vendor bir alanı yeniden
# adlandırdıysa çağrı PATLAMAZ: port alanı null okur, renderer dürüstçe "n/a"
# basar, HTTP 200 döner, defter dengelenir ve kredi TAM tahsil edilir. Hiçbir
# otomatik kapı bunu göremez, çünkü teknik olarak yanlış bir şey olmuyor.
#
# BU YÜZDEN ADIM ADIM. Her alt komut TEK bir çağrı yapar ve çıktıyı olduğu gibi
# basar; aralarında GÖZLE bakılır. "exit 0" burada bir kanıt değildir.
#
# GÜVENLİK. MCP_SMOKE_URL bir SIR taşır — URL gibi görünür ama yolunda canlı bir
# sg_ anahtarı vardır. Bu script onu asla basmaz, asla log'lamaz; yalnız değişken
# olarak kullanır. Sen de echo'lama.
#
# KULLANIM
#   bash scripts/testing/live-smoke.sh preflight
#   bash scripts/testing/live-smoke.sh serp        # …ve diğerleri, TEK TEK
#   bash scripts/testing/live-smoke.sh list        # ne var ne yok
#
# Tam smoke ~$0,85 vendor maliyeti; günlük tavan $3,00 (fail-closed).
set -uo pipefail

# Env yalnız GERÇEKTEN çağrı yapan alt komutlar için şart — `list` ve `reconcile`
# env'siz okunabilmeli, yoksa operatör kullanımı görmeden duvara çarpar.
need_env() {
  [ -n "${MCP_SMOKE_URL:-}" ] && return 0
  echo "MCP_SMOKE_URL yok. Yükle (şef kabuğu ~/.zshrc source ETMEZ):"
  echo "  eval \"\$(grep -E '^[[:space:]]*export[[:space:]]+MCP_SMOKE_URL=' ~/.zshrc)\""
  exit 1
}

TARGET="${SMOKE_TARGET:-seogrep.com}"
RIVAL="${SMOKE_RIVAL:-ahrefs.com}"

hr() { printf '\n\033[1m── %s\033[0m\n' "$*"; }

# Tek bir tools/call. $1 = params JSON. Yanıtı OLDUĞU GİBİ basar — özet yok,
# çünkü bakılacak şey ham alanlar.
call() {
  curl -sf --max-time 90 -X POST "$MCP_SMOKE_URL" \
    -H 'content-type: application/json' \
    -H 'accept: application/json, text/event-stream' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":$1}" \
    || { echo "!! çağrı başarısız (curl exit $?) — ret ücretsizdir, kredi harcanmadı"; return 1; }
  echo
}

case "${1:-list}" in

preflight)
  need_env
  hr "1a · sunucu ayakta mı"
  curl -sf --max-time 20 https://mcp.seogrep.com/status || echo "!! /status okunamadı"
  echo
  hr "1b · canlı yüzey kaç tool"
  n=$(curl -sf --max-time 25 -X POST "$MCP_SMOKE_URL" \
        -H 'content-type: application/json' \
        -H 'accept: application/json, text/event-stream' \
        -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
      | grep -o '"inputSchema"' | wc -l | tr -d ' ')
  echo "  $n  (beklenen: 36)"
  [ "$n" = "36" ] || echo "  !! 36 değil — son merge'ün tool diff'ine bak"
  hr "1c · DFS_LIVE açık mı"
  echo "  KAPALIYSA her tool 'not enabled' döner: 0 kredi, 0 defter satırı."
  echo "  Yeşil görünür ve HİÇBİR ŞEY ölçmüş olmazsın."
  fly secrets list -a seogrep-mcp 2>/dev/null | grep -i DFS_LIVE || echo "  (fly okunamadı — Supabase'den de bakabilirsin)"
  hr "1d · bugünkü vendor harcaması"
  echo "  Supabase SQL editor'de:"
  echo "    select dfs_spend_today_usd() as bugun_usd, 3.00 - dfs_spend_today_usd() as kalan;"
  ;;

serp)      # 5 + 8/kelime · ~$0,02 · fixture'ı ZATEN saklanabilir satır üretemiyordu
  need_env
  hr "serp_snapshot — BAK: status 'ranked' veya 'absent_from_examined_results' mu (hepsi 'not_measured' ise arıza)"
  call '{"name":"serp_snapshot","arguments":{"target":"'"$TARGET"'","keywords":["seo mcp"]}}'
  hr "keyword_positions — BAK: az önce saklanan satır geri geliyor mu"
  call '{"name":"keyword_positions","arguments":{"target":"'"$TARGET"'"}}'
  ;;

ai)        # 90 + 180 · ~$0,20 · LLM Mentions'tan HİÇ canlı yanıt yakalanmadı
  need_env
  hr "ai_visibility — BAK: metrikler gerçek sayı mı (hepsi n/a ise alan adları kaymış)"
  call '{"name":"ai_visibility","arguments":{"subject":"domain","target":"'"$TARGET"'","platform":"chat_gpt"}}'
  hr "ai_visibility_compare — BAK: İKİ hedef de answered mı (hedef başına 90 → 180 kredi)"
  call '{"name":"ai_visibility_compare","arguments":{"targets":[{"domain":"'"$TARGET"'"},{"domain":"'"$RIVAL"'"}],"platform":"chat_gpt"}}'
  ;;

domain)    # 90 + 70 + 65 · ~$0,25 · üçü de el yazımı fixture
  need_env
  hr "compare_competitors — BAK: her domain için trafik/keyword sayısı dolu mu"
  call '{"name":"compare_competitors","arguments":{"target":"'"$TARGET"'","competitors":["'"$RIVAL"'"]}}'
  hr "analyze_backlinks — BAK: ÜÇ blok da dolu mu (özet · yönlendiren domain · anchor)"
  call '{"name":"analyze_backlinks","arguments":{"target":"'"$TARGET"'"}}'
  hr "ranked_keywords — BAK: position / volume / url gerçek mi (n/a'yı EN ÇOK basan renderer)"
  call '{"name":"ranked_keywords","arguments":{"target":"'"$TARGET"'"}}'
  ;;

discover)  # 40 × 4 · dört mode DÖRT AYRI uca gider, dördü de ayrı fixture
  need_env
  hr "discover_keywords · ideas"
  call '{"name":"discover_keywords","arguments":{"mode":"ideas","seeds":["seo tools"],"language_code":"en"}}'
  hr "discover_keywords · suggestions"
  call '{"name":"discover_keywords","arguments":{"mode":"suggestions","seed":"seo tools","language_code":"en"}}'
  hr "discover_keywords · related"
  call '{"name":"discover_keywords","arguments":{"mode":"related","seed":"seo tools","language_code":"en"}}'
  hr "discover_keywords · for_site — BAK: dördü AYRI AYRI; biri boşsa o uç kaymıştır"
  call '{"name":"discover_keywords","arguments":{"mode":"for_site","target":"'"$TARGET"'","language_code":"en"}}'
  ;;

backlinks) # 40 + 40 + 35 + 35 · disavow karışık, son ikisi GERÇEK yakalama (düşük risk)
  need_env
  hr "disavow_candidates — BAK: spam skorları gerçek mi (tek tük null meşru, HEPSİ null değil)"
  call '{"name":"disavow_candidates","arguments":{"target":"'"$TARGET"'"}}'
  hr "my_pages — BAK: sayfa listesi + organik metrikler (null MEŞRU, kod kasten 0 yapmıyor)"
  call '{"name":"my_pages","arguments":{"target":"'"$TARGET"'"}}'
  hr "backlink_details — fixture'ı GERÇEK yakalama, düşük risk"
  call '{"name":"backlink_details","arguments":{"target":"'"$TARGET"'"}}'
  hr "backlink_changes — fixture'ı GERÇEK yakalama, düşük risk"
  call '{"name":"backlink_changes","arguments":{"target":"'"$TARGET"'"}}'
  ;;

gaps)      # 45 + 45 + 25 + 15 · ~$0,08
  need_env
  hr "keyword_gap — BAK: kesişim listesi boş değil mi"
  call '{"name":"keyword_gap","arguments":{"target":"'"$TARGET"'","competitors":["'"$RIVAL"'"]}}'
  hr "link_gap — BAK: aynı"
  call '{"name":"link_gap","arguments":{"target":"'"$TARGET"'","competitors":["'"$RIVAL"'"]}}'
  hr "research_keywords — BAK: arama hacimleri dolu mu"
  call '{"name":"research_keywords","arguments":{"keywords":["seo mcp","seo tools"]}}'
  hr "audit_speed — BAK: Lighthouse skorları gerçek mi"
  call '{"name":"audit_speed","arguments":{"target":"'"$TARGET"'"}}'
  ;;

reconcile)
  hr "3 · MUTABAKAT — çıktılar iyi görünse bile üç defter birbirini tutmalı"
  cat <<'SQL'
-- Supabase SQL editor'de, sırayla:

-- 3a · vendor harcaması kaydedildi mi
select tool, requests, actual_usd, row_count, created_at
from dfs_spend where created_at > now() - interval '2 hours' order by created_at;

-- 3b · her ücretli çağrı için reserve + commit ÇİFTİ var mı
select kind, delta, tool, created_at
from credit_ledger where created_at > now() - interval '2 hours' order by created_at;

-- 3c · koşu satırları yazıldı mı (panelin okuduğu şey)
select 'domain_lookup' as t, tool, target, created_at from domain_lookup_runs
  where created_at > now() - interval '2 hours'
union all
select 'subject_lookup', tool, subject[1], created_at from subject_lookup_runs
  where created_at > now() - interval '2 hours'
order by created_at;
SQL
  echo
  echo "  DURMA NOKTASI: bir spend_reserve görüp karşılığında commit ya da release"
  echo "  GÖRMEZSEN orada dur. Açık rezervasyon = düşülmüş ama sonuçlanmamış para."
  echo
  echo "  TUZAK: ai_visibility_compare bir çağrıda HEDEF SAYISI KADAR satır yazar."
  echo "  İki hedefle koştuysan subject_lookup_runs'ta İKİ satır, defterde 180 kredi."
  echo
  echo "  Son olarak panel: /app/lookups üç bölüm · /app/rankings serp serisi."
  ;;

list|*)
  cat <<'USAGE'
Canlı smoke — TEK TEK koş, her çıktıya GÖZLE bak.

  preflight   ortam · yüzey 36 · DFS_LIVE · kalan bütçe        (ücretsiz)
  serp        serp_snapshot + keyword_positions                 ~$0,02
  ai          ai_visibility + ai_visibility_compare             ~$0,20   ← en yüksek risk
  domain      compare_competitors + analyze_backlinks + ranked  ~$0,25
  discover    discover_keywords × 4 mode                        ~$0,13
  backlinks   disavow + my_pages + backlink_details/_changes    ~$0,15
  gaps        keyword_gap + link_gap + research + audit_speed    ~$0,08
  reconcile   defter + panel mutabakatı SQL'i                    (ücretsiz)

Hedef değiştirmek için:  SMOKE_TARGET=x.com SMOKE_RIVAL=y.com bash ... 
USAGE
  ;;
esac
