-- Spot the Moment — schema, row-level security, and the functions that are the
-- only way to change the room. Safe to commit: it contains no answer key and
-- no passcode. Run this first, then seed-private.sql.
--
-- The rule this file exists to enforce: a participant holds only the anon key,
-- and the anon key must not be able to read another person's sticky before the
-- facilitator opens the stage, nor the answer key before stage 2, nor the
-- passcode ever.

-- ---------------------------------------------------------------- tables ----

create table if not exists public.control (
  id                  int  primary key default 1,
  active_conversation text not null default 'A',
  stage_a             int  not null default 0,
  stage_b             int  not null default 0,
  constraint control_single_row check (id = 1),
  constraint control_active_valid check (active_conversation in ('A','B')),
  constraint control_stage_a_valid check (stage_a between 0 and 2),
  constraint control_stage_b_valid check (stage_b between 0 and 2)
);

insert into public.control (id, active_conversation, stage_a, stage_b)
values (1, 'A', 0, 0)
on conflict (id) do nothing;

create table if not exists public.stickies (
  id           uuid primary key default gen_random_uuid(),
  conversation text not null,
  line_id      text not null,
  "text"       text not null,
  kind         text not null,
  author       uuid not null default auth.uid(),
  created_at   timestamptz not null default now(),
  constraint stickies_conversation_valid check (conversation in ('A','B')),
  constraint stickies_kind_valid         check (kind in ('flag','good')),
  constraint stickies_line_format        check (line_id ~ '^[AB][0-9]{1,3}$'),
  -- the line has to belong to the conversation it claims
  constraint stickies_line_matches_conv  check (left(line_id, 1) = conversation),
  constraint stickies_text_length        check (char_length("text") between 1 and 160)
);

create index if not exists stickies_line_idx   on public.stickies (line_id);
create index if not exists stickies_author_idx on public.stickies (author);

create table if not exists public.votes (
  sticky_id uuid not null references public.stickies (id) on delete cascade,
  voter     uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  -- also the replica identity: a table that publishes deletes must have one,
  -- and it is what makes "one +1 per person per sticky" true in the database.
  constraint votes_one_per_person primary key (sticky_id, voter)
);

create index if not exists votes_sticky_idx on public.votes (sticky_id);

create table if not exists public.answer_key (
  line_id      text primary key,
  conversation text not null,
  note         text not null,
  constraint answer_key_conversation_valid check (conversation in ('A','B'))
);

create table if not exists public.takeaways (
  conversation text primary key,
  "text"       text not null,
  constraint takeaways_conversation_valid check (conversation in ('A','B'))
);

create table if not exists public.facilitator_secret (
  id   int  primary key default 1,
  code text not null,
  constraint facilitator_secret_single_row check (id = 1)
);

-- ------------------------------------------------------------- functions ----
-- SECURITY DEFINER so a policy can read the stage without the caller needing
-- any privilege on control, and so the passcode table stays unreadable.
-- search_path is pinned on every one of these: without it, a caller who can
-- create objects could shadow a name these bodies resolve.

create or replace function public.stage_of(conv text)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
           when conv = 'A' then stage_a
           when conv = 'B' then stage_b
           else 0
         end
  from public.control
  where id = 1
$$;

create or replace function public.sticky_stage(sid uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.stage_of(s.conversation) from public.stickies s where s.id = sid
$$;

-- Internal only. Never granted to anon/authenticated, so the passcode cannot be
-- probed directly — it is reachable only through the functions below, which do
-- something useful and auditable with it.
create or replace function public.assert_facilitator(passcode text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if passcode is null
     or not exists (select 1 from public.facilitator_secret where code = passcode) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
end
$$;

create or replace function public.is_facilitator(passcode text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.facilitator_secret where code = passcode)
$$;

create or replace function public.set_stage(passcode text, conversation text, stage int)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_facilitator(passcode);
  if conversation not in ('A','B') then raise exception 'Unknown conversation'; end if;
  if stage not between 0 and 2     then raise exception 'Unknown stage';        end if;

  if conversation = 'A' then
    update public.control set stage_a = stage where id = 1;
  else
    update public.control set stage_b = stage where id = 1;
  end if;
end
$$;

create or replace function public.set_active(passcode text, conversation text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_facilitator(passcode);
  if conversation not in ('A','B') then raise exception 'Unknown conversation'; end if;
  update public.control set active_conversation = conversation where id = 1;
end
$$;

create or replace function public.clear_all(passcode text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_facilitator(passcode);
  delete from public.votes;
  delete from public.stickies;
  update public.control
     set active_conversation = 'A', stage_a = 0, stage_b = 0
   where id = 1;
end
$$;

-- Stage 0 shows "3 stickies from the room" without the text. Counting has to
-- bypass RLS to do that, so this returns only a line id and a number.
create or replace function public.sticky_counts()
returns table (line_id text, n bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.line_id, count(*)::bigint from public.stickies s group by s.line_id
$$;

-- ------------------------------------------------------------------ RLS -----

alter table public.control            enable row level security;
alter table public.stickies           enable row level security;
alter table public.votes              enable row level security;
alter table public.answer_key         enable row level security;
alter table public.takeaways          enable row level security;
alter table public.facilitator_secret enable row level security;

-- Deliberately NOT "force row level security" here. FORCE would apply RLS to the
-- table owner as well, and the SECURITY DEFINER functions above run as the owner
-- -- so forcing it would lock assert_facilitator out of the passcode and no one
-- could ever be the facilitator. Non-owners are already blocked twice over: RLS
-- with zero policies, and no grant at all.

drop policy if exists control_select            on public.control;
drop policy if exists stickies_select           on public.stickies;
drop policy if exists stickies_insert           on public.stickies;
drop policy if exists stickies_delete           on public.stickies;
drop policy if exists votes_select              on public.votes;
drop policy if exists votes_insert              on public.votes;
drop policy if exists votes_delete              on public.votes;
drop policy if exists answer_key_select         on public.answer_key;
drop policy if exists takeaways_select          on public.takeaways;

-- control: readable by everyone, changeable by no one directly. There is no
-- INSERT/UPDATE/DELETE policy, so those are denied; set_stage/set_active/
-- clear_all are the only paths in.
create policy control_select on public.control
  for select to anon, authenticated
  using (true);

-- stickies: yours always; everyone's once the facilitator opens stage 1.
create policy stickies_select on public.stickies
  for select to authenticated
  using (author = auth.uid() or public.stage_of(conversation) >= 1);

create policy stickies_insert on public.stickies
  for insert to authenticated
  with check (author = auth.uid() and public.stage_of(conversation) < 2);

create policy stickies_delete on public.stickies
  for delete to authenticated
  using (author = auth.uid() and public.stage_of(conversation) < 2);

-- no UPDATE policy: a sticky is immutable once written

-- votes: your own are always visible to you; everyone's from stage 1, which is
-- also the first point at which one can be cast.
create policy votes_select on public.votes
  for select to authenticated
  using (voter = auth.uid() or public.sticky_stage(sticky_id) >= 1);

create policy votes_insert on public.votes
  for insert to authenticated
  with check (
    voter = auth.uid()
    and public.sticky_stage(sticky_id) >= 1
    -- a +1 is for someone else's sticky. Voting only opens at stage 1, by which
    -- point every sticky is readable, so this sees the real author.
    and not exists (
      select 1 from public.stickies s
      where s.id = sticky_id and s.author = auth.uid()
    )
  );

create policy votes_delete on public.votes
  for delete to authenticated
  using (voter = auth.uid());

-- the key and the takeaway do not exist for a participant until stage 2
create policy answer_key_select on public.answer_key
  for select to authenticated
  using (public.stage_of(conversation) >= 2);

create policy takeaways_select on public.takeaways
  for select to authenticated
  using (public.stage_of(conversation) >= 2);

-- facilitator_secret: no policy at all, on purpose. Unreadable from any client.

-- --------------------------------------------------------------- grants -----
-- RLS gates rows; grants gate whole verbs. Both are set explicitly rather than
-- inherited, so a future default-privilege change cannot quietly widen this.

revoke all on public.control            from anon, authenticated;
revoke all on public.stickies           from anon, authenticated;
revoke all on public.votes              from anon, authenticated;
revoke all on public.answer_key         from anon, authenticated;
revoke all on public.takeaways          from anon, authenticated;
revoke all on public.facilitator_secret from anon, authenticated;

grant select                 on public.control    to anon, authenticated;
grant select, insert, delete on public.stickies   to authenticated;
grant select, insert, delete on public.votes      to authenticated;
grant select                 on public.answer_key to authenticated;
grant select                 on public.takeaways  to authenticated;
-- facilitator_secret: no grant to anyone

revoke all on function public.assert_facilitator(text) from public, anon, authenticated;

grant execute on function public.is_facilitator(text)               to anon, authenticated;
grant execute on function public.set_stage(text, text, int)         to anon, authenticated;
grant execute on function public.set_active(text, text)             to anon, authenticated;
grant execute on function public.clear_all(text)                    to anon, authenticated;
grant execute on function public.sticky_counts()                    to anon, authenticated;
grant execute on function public.stage_of(text)                     to anon, authenticated;
grant execute on function public.sticky_stage(uuid)                 to anon, authenticated;

-- ------------------------------------------------------------- realtime -----
-- Replica identity is left at the default (primary key) on purpose. Realtime does
-- not apply RLS to DELETE events, so with REPLICA IDENTITY FULL a delete payload
-- would carry the whole old row -- handing every subscriber the text of a sticky
-- they are not allowed to read at stage 0. At the default, a delete says only
-- which id went away. The app treats every event as "something changed" and
-- refetches through RLS, so it never needs the old row.

do $$
begin
  begin execute 'alter publication supabase_realtime add table public.control';  exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table public.stickies'; exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table public.votes';    exception when duplicate_object then null; end;
end
$$;
