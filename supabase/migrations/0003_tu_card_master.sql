-- Card Master: Ergebnisse je Spiel + Gesamtrangliste.
-- Erweitert das tu_-Schema; bestehende Profile und Partien bleiben unverändert.

alter table public.tu_matches
  add column if not exists game text not null default '1001';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tu_matches_game_chk') then
    alter table public.tu_matches add constraint tu_matches_game_chk check (game ~ '^[a-z0-9]{2,12}$');
  end if;
end $$;
create index if not exists tu_matches_game_created_idx on public.tu_matches (game, created_at desc);

create table if not exists public.tu_game_stats (
  profile_id     uuid        not null references public.tu_profiles(id) on delete cascade,
  game           text        not null check (game ~ '^[a-z0-9]{2,12}$'),
  matches_played integer     not null default 0 check (matches_played >= 0),
  wins           integer     not null default 0 check (wins >= 0),
  losses         integer     not null default 0 check (losses >= 0),
  deals_played   integer     not null default 0 check (deals_played >= 0),
  best_total     integer     not null default 0,
  last_played_at timestamptz,
  primary key (profile_id, game)
);
create index if not exists tu_game_stats_game_rank_idx on public.tu_game_stats (game, wins desc, best_total desc);

alter table public.tu_game_stats enable row level security;
revoke all on table public.tu_game_stats from anon, authenticated;

-- Übernahme der bisherigen 1001-Zähler
insert into public.tu_game_stats (profile_id, game, matches_played, wins, losses, deals_played, best_total, last_played_at)
select p.id, '1001', p.matches_played, p.wins, p.losses, p.deals_played, p.best_total,
       (select max(m.created_at) from public.tu_matches m where m.profile_id = p.id)
from public.tu_profiles p
where p.matches_played > 0
on conflict (profile_id, game) do nothing;

insert into public.tu_schema_migrations (name) values ('0003_tu_card_master') on conflict do nothing;
