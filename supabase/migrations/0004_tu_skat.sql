-- Card Master: Skat-Ergebnisse. Turnierpunkte einer Serie können größer werden als 1001-Punkte.
alter table public.tu_matches drop constraint if exists tu_matches_human_total_check;
alter table public.tu_matches add constraint tu_matches_human_total_check check (human_total between -50000 and 50000);
alter table public.tu_matches drop constraint if exists tu_matches_computer_total_check;
alter table public.tu_matches add constraint tu_matches_computer_total_check check (computer_total between -50000 and 50000);
comment on column public.tu_game_stats.best_total is '1001: beste Endpunktzahl einer Partie; Skat: aufsummierte Turnierpunkte (Seeger-Fabian) aller Serien';
insert into public.tu_schema_migrations (name) values ('0004_tu_skat') on conflict do nothing;
