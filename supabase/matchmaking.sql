-- フィンスト：野良マッチ用のスキーマと関数
-- Supabase の SQL Editor に貼って Run（何度実行しても同じ結果になる）

-- ---- 列を足す ------------------------------------------------------------
alter table rooms add column if not exists mode      text    not null default 'quick';
alter table rooms add column if not exists is_random boolean not null default false;

-- 空き部屋を探す問い合わせ用
create index if not exists rooms_queue_idx
  on rooms (is_random, status, mode, created_at)
  where guest_id is null;

-- ---- 野良マッチ ----------------------------------------------------------
-- 空いている部屋を「1人だけが」掴めるようにする。
-- 同時に押されても FOR UPDATE SKIP LOCKED で取り合いにならない。
-- 掴めなければ自分が待ち側の部屋を作る。部屋と対戦データを同じ処理内で作るので、
-- 「部屋はあるのに対戦データが無い」隙間が生まれない。
create or replace function match_random(
  p_me    uuid,
  p_mode  text,
  p_code  text,      -- 新しく作るときに使う6文字（クライアント生成）
  p_state jsonb      -- 新しく作るときの初期状態
)
returns table(code text, seat int)
language plpgsql
security definer
as $$
declare
  v_code text;
begin
  -- すでに自分が待っている部屋があるなら、それに戻る（二重に並ばない）
  select r.code into v_code
    from rooms r
   where r.is_random
     and r.host_id = p_me
     and r.guest_id is null
     and r.created_at > now() - interval '5 minutes'
   order by r.created_at desc
   limit 1;
  if v_code is not null then
    return query select v_code, 0;
    return;
  end if;

  -- 空いている部屋を1つ掴む。90秒より古いものは、閉じられた可能性が高いので拾わない
  update rooms
     set guest_id = p_me, status = 'playing'
   where rooms.code = (
         select r.code
           from rooms r
          where r.is_random
            and r.status   = 'waiting'
            and r.guest_id is null
            and r.host_id  <> p_me
            and r.mode      = p_mode
            and r.created_at > now() - interval '90 seconds'
          order by r.created_at
            for update skip locked
          limit 1)
   returning rooms.code into v_code;

  if v_code is not null then
    return query select v_code, 1;
    return;
  end if;

  -- 誰も待っていなければ、自分が待つ
  insert into rooms (code, status, host_id, is_random, mode)
       values (p_code, 'waiting', p_me, true, p_mode);
  insert into matches (room_code, state) values (p_code, p_state);
  return query select p_code, 0;
end $$;

grant execute on function match_random(uuid, text, text, jsonb) to anon;

-- ---- 待っているのをやめる -------------------------------------------------
create or replace function leave_queue(p_me uuid)
returns void language sql security definer as $$
  delete from rooms
   where is_random and host_id = p_me and guest_id is null;
$$;

grant execute on function leave_queue(uuid) to anon;

-- ---- いま何人待っているか -------------------------------------------------
create or replace function queue_size(p_mode text)
returns int language sql stable security definer as $$
  select count(*)::int from rooms
   where is_random and status = 'waiting' and guest_id is null
     and mode = p_mode and created_at > now() - interval '90 seconds';
$$;

grant execute on function queue_size(text) to anon;
