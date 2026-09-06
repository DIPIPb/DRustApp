-- Run this once against your Vercel Postgres / Neon database.

create table if not exists servers (
  id serial primary key,
  token text unique not null,
  hostname text,
  port int,
  world_size int,
  level text,
  description text,
  version text,
  paired_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create table if not exists pairing_codes (
  code text primary key,
  used boolean not null default false,
  server_id int references servers(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists players (
  id serial primary key,
  server_id int references servers(id) on delete cascade,
  steam_id text not null,
  steam_name text,
  ip text,
  status text,
  ping int,
  is_alive boolean,
  meta jsonb,
  last_seen_at timestamptz not null default now(),
  unique (server_id, steam_id)
);

create table if not exists chat_messages (
  id serial primary key,
  server_id int references servers(id) on delete cascade,
  steam_id text,
  target_steam_id text,
  is_team boolean,
  text text,
  created_at timestamptz not null default now()
);

create table if not exists reports (
  id serial primary key,
  server_id int references servers(id) on delete cascade,
  initiator_steam_id text,
  target_steam_id text,
  sub_targets_steam_ids jsonb,
  reason text,
  message text,
  created_at timestamptz not null default now()
);

create table if not exists bans (
  id serial primary key,
  server_id int references servers(id) on delete cascade,
  target_steam_id text not null,
  reason text,
  global boolean,
  ban_ip boolean,
  duration text,
  comment text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists admin_accounts (
  id serial primary key,
  username text unique not null,
  hash text not null,
  salt text not null,
  role text not null default 'admin',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists admin_sessions (
  token text primary key,
  account_id int references admin_accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists mutes (
  id serial primary key,
  server_id int references servers(id) on delete cascade,
  steam_id text not null,
  reason text,
  active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
