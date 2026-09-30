-- Tables only. No answer key and no passcode — those come from seed-private.sql,
-- which is gitignored.

create table if not exists control (
  id     integer primary key,
  active text    not null default 'A',
  stage_a integer not null default 0,
  stage_b integer not null default 0
);

insert or ignore into control (id, active, stage_a, stage_b) values (1, 'A', 0, 0);

create table if not exists stickies (
  id           text primary key,
  conversation text not null,
  line_id      text not null,
  body         text not null,
  kind         text not null,
  author       text not null,
  created_at   integer not null
);

create index if not exists stickies_line_idx on stickies (line_id);

create table if not exists votes (
  sticky_id text not null,
  voter     text not null,
  primary key (sticky_id, voter)
);

create table if not exists answer_key (
  line_id      text primary key,
  conversation text not null,
  note         text not null
);

create table if not exists takeaways (
  conversation text primary key,
  body         text not null
);

create table if not exists facilitator (
  id   integer primary key,
  code text not null
);
