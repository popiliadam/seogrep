# Legacy vendor fixtures

Response shapes from DataForSEO endpoints this codebase **no longer calls**. Nothing imports
them; they are kept as a record of what the vendor returned when we did.

Why keep them rather than delete: this repo treats a fixture as "the real response shape"
(see the header of `dfs/client.ts`). When an endpoint is swapped out, the old shape is the
only evidence of what the previous behaviour was measured against — useful when a switch has
to be reasoned about after the fact, or reversed.

Why move them out of `fixtures/` rather than leave them: an unreferenced fixture sitting
beside live ones reads as if something still uses it. That is the same class of confusion
this directory exists to prevent.

| file | endpoint | retired |
|---|---|---|
| `search-volume.json` | `keywords_data/google_ads/search_volume/live` | 2026-08-17 — `research_keywords` moved to DataForSEO Labs `keyword_overview` (PR #122). The Labs endpoint returns the same `search_volume` (measured: identical on 4 of 4 keywords that had data) at ~3.75x lower vendor cost, plus keyword difficulty, search intent and a 12-month trend. The tradeoff measured at the time: Labs CPC differed by up to 53% and its monthly series ran one month behind, so the tool now prints the CPC's `last_updated_time` alongside it. |
