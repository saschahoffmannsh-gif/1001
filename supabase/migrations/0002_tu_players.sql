-- 1001: Spielerzahl (2–4) und Endstand aller Spieler je Partie
alter table public.tu_matches add column if not exists players smallint not null default 2 check (players between 2 and 4);
alter table public.tu_matches add column if not exists totals jsonb;
insert into public.tu_schema_migrations (name) values ('0002_tu_players') on conflict do nothing;
