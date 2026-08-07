-- ═══════════════════════════════════════════════════════════════════════════
-- Keyword universe — a client-supplied bulk keyword list (e.g. an Ahrefs/
-- SEMrush export scored offline for search volume + topic/geo classification)
-- used to supplement the Location Page Builder's live SERP+SEMrush keyword
-- research, which returns too-generic/off-topic results for niche
-- service+location combinations (see keywordAdapter.js). Typed columns +
-- indexes (not the jsonb blob adapter) since rows are queried/filtered at
-- scale (100k+ rows per client) rather than fetched by id.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists lpb_keyword_universe (
  id              bigint generated always as identity primary key,
  client_id       text not null,
  keyword         text not null,
  keyword_norm    text not null,             -- lowercased+trimmed, for dedupe/lookup
  semrush_sv      integer not null default 0,
  pillar          text,
  cluster         text,
  subtopic        text,
  geo_type        text,
  geo_detected    text,                      -- city name, or '-' when not geo-specific
  geo_detected_norm text not null default '',
  data_confidence text,
  imported_at     timestamptz not null default now()
);

create index if not exists idx_lpb_ku_client_geo    on lpb_keyword_universe (client_id, geo_detected_norm);
create index if not exists idx_lpb_ku_client_cluster on lpb_keyword_universe (client_id, cluster);
create index if not exists idx_lpb_ku_client_pillar  on lpb_keyword_universe (client_id, pillar);
