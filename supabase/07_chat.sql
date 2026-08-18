-- ============================================================================
--  League chat.
--
--  A draft between friends is a social event, and the banter currently happens
--  in a group chat somewhere else while the draft happens here. This puts it in
--  the room.
--
--  Deliberately minimal: no threads, no edits, no reactions, no read receipts.
--  A line of text, who said it, and when.
--
--  Safe to run more than once.
-- ============================================================================

create table if not exists messages (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid not null references leagues(id) on delete cascade,
  member_id  uuid not null references league_members(id) on delete cascade,
  body       text not null check (length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists messages_league_idx on messages(league_id, created_at desc);

alter table messages enable row level security;

-- Readable by the league, exactly like every other league-scoped table.
drop policy if exists messages_read on messages;
create policy messages_read on messages for select to authenticated
  using (is_league_member(league_id));

-- No insert policy: posting goes through the function below, which is what
-- stamps the author. Otherwise a client could write any member_id it liked.
create or replace function post_message(p_league uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid; msg_id uuid;
begin
  me := assert_member(p_league);

  if length(btrim(p_body)) = 0 then
    raise exception 'Say something.';
  end if;
  if length(p_body) > 500 then
    raise exception 'Keep it under 500 characters.';
  end if;

  -- A crude flood guard. Friends spamming each other is fine; a runaway client
  -- filling the table is not.
  if (select count(*) from messages
       where member_id = me and created_at > now() - interval '10 seconds') >= 10 then
    raise exception 'Slow down a moment.';
  end if;

  insert into messages (league_id, member_id, body)
  values (p_league, me, btrim(p_body))
  returning id into msg_id;

  return msg_id;
end $$;

grant execute on function post_message(uuid,text) to authenticated;

-- The author can take back what they said; the commissioner can remove
-- anything. Same shape as every other correction in this app.
create or replace function delete_message(p_message uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m messages%rowtype; me uuid;
begin
  select * into m from messages where id = p_message;
  if not found then return; end if;

  me := assert_member(m.league_id);
  if m.member_id <> me
     and not exists (select 1 from leagues where id = m.league_id and commissioner_id = auth.uid())
  then
    raise exception 'You can only delete your own messages.';
  end if;

  delete from messages where id = p_message;
end $$;

grant execute on function delete_message(uuid) to authenticated;

-- Chat is the one thing here that genuinely has to arrive without a refetch.
do $$ begin
  execute 'alter publication supabase_realtime add table messages';
exception when duplicate_object then null; end $$;
