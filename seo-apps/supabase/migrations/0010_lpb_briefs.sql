-- ═══════════════════════════════════════════════════════════════════════════
-- lpb_briefs — the editable content brief that sits between keyword approval
-- and content generation.
--
-- Until now the writer's instructions (the H2 outline, the FAQ set, the meta
-- targets) were computed inside the generate call and never surfaced: the SEO
-- team approved keywords and the next thing they saw was finished copy. The
-- brief makes that step visible and editable, and persisting it is what makes
-- it a REVIEW step rather than a detour — one person can draft and adjust the
-- brief, another can generate from it later, and reopening the page rehydrates
-- what was agreed instead of re-running the billed competitor scrape.
--
-- Shaped exactly like lpb_keywordselections (same tuple_key upsert scheme,
-- same one-row-per-client+service+location rule) so the two read and write
-- the same way.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists lpb_briefs (
  id          text primary key,
  data        jsonb not null,             -- { tuple_key, client_id, service_id,
                                          --   location_id, brief{}, approved,
                                          --   approved_at, source }
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- tuple_key is what store.upsertBy matches on (one brief per
-- client+service+location, mirroring the one-page-per-tuple rule).
create index if not exists lpb_briefs_tuple_idx  on lpb_briefs ((data->>'tuple_key'));
create index if not exists lpb_briefs_client_idx on lpb_briefs ((data->>'client_id'));

alter table lpb_briefs enable row level security;
