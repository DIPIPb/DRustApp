-- Выполни это ОДИН раз в Query-редакторе (по одной команде за раз,
-- чтобы не словить "cannot insert multiple commands into a prepared statement").

alter table players add column if not exists pos_x double precision;

alter table players add column if not exists pos_z double precision;

alter table players add column if not exists coords text;

alter table players add column if not exists can_build boolean;

alter table players add column if not exists is_raiding boolean;
