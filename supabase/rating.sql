-- フィンスト：レートとランク分け
-- Supabase の SQL Editor に貼って Run（何度実行しても同じ結果になる）
-- schema.sql → matchmaking.sql → このファイル の順に実行する。
--
-- 方針:
--   レートの計算はぜんぶこの中（サーバー側）でやる。クライアントは
--   「この部屋で自分が勝った／負けた」としか言えず、点数そのものは書けない。
--   1部屋につき1回しか記録しないので、同じ試合を何度報告しても増えない。
--   ただし静的サイトなので審判は居ない。嘘の勝敗報告はまだ防げていない
--   （対策する時は、勝敗判定を Edge Functions に移して書き込みを service_role に限る）。
--   レートが付くのは野良マッチだけ。友達との部屋は付かないので、
--   身内で回して盛ることはできない。

-- ---- プレイヤー ----------------------------------------------------------
create table if not exists players (
  id         uuid primary key,               -- 端末の匿名ID（localStorage）
  rating     int  not null default 1200,
  games      int  not null default 0,
  wins       int  not null default 0,
  losses     int  not null default 0,
  best       int  not null default 1200,     -- 自己最高レート
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---- 試合結果（1部屋1行。これが二重計上のふた）--------------------------
create table if not exists results (
  room_code    text primary key references rooms(code) on delete cascade,
  winner_id    uuid not null,
  loser_id     uuid not null,
  winner_delta int  not null,
  loser_delta  int  not null,
  winner_after int  not null,
  loser_after  int  not null,
  created_at   timestamptz not null default now()
);

create index if not exists players_rating_idx on players (rating desc);
create index if not exists results_created_idx on results (created_at desc);

-- 待ち部屋にレートを持たせる（近い人から順に当てるため）
alter table rooms add column if not exists rating int;

drop index if exists rooms_queue_idx;
create index if not exists rooms_queue_idx
  on rooms (is_random, status, mode, rating)
  where guest_id is null;

-- ---- RLS -----------------------------------------------------------------
-- 読むのは誰でも可（ランキング表示のため）。書き込みは下の関数だけが行う。
alter table players enable row level security;
alter table results enable row level security;

drop policy if exists players_read on players;
create policy players_read on players for select to anon using (true);

drop policy if exists results_read on results;
create policy results_read on results for select to anon using (true);

-- ---- 自分のレートを取る（無ければ作る）-----------------------------------
create or replace function get_or_create_player(p_id uuid)
returns table(rating int, games int, wins int, losses int, best int, rank_no int)
language plpgsql security definer as $$
begin
  insert into players (id) values (p_id) on conflict (id) do nothing;
  return query
    select p.rating, p.games, p.wins, p.losses, p.best,
           (select count(*)::int + 1 from players q where q.rating > p.rating and q.games > 0)
      from players p where p.id = p_id;
end $$;

grant execute on function get_or_create_player(uuid) to anon;

-- ---- 試合結果を記録してレートを動かす -------------------------------------
-- 呼ぶのは「自分が勝ったか」だけ。相手が誰かは部屋から引くので詐称できない。
-- K値は試合数と実力で変える。始めたばかりの人は大きく動いて早く実力の位置に着き、
-- 上の方は動きにくくして安定させる（Eloの標準的なやり方）。
-- 戻り値の名前に注意。plpgsql では OUT の名前と列名が同じだと
-- update players set rating = rating + ... がどちらを指すのか決まらず実行時に落ちる。
-- だから new_rating / new_games という名前にしてある。
create or replace function report_result(p_room text, p_me uuid, p_won boolean)
returns table(new_rating int, delta int, opp_rating int, new_games int)
language plpgsql security definer as $$
declare
  v_host uuid; v_guest uuid; v_random boolean;
  v_win uuid; v_lose uuid;
  v_wr int; v_lr int; v_wg int; v_lg int;
  v_kw int; v_kl int;
  v_exp numeric; v_wd int; v_ld int;
  v_existing results%rowtype;
begin
  select r.host_id, r.guest_id, r.is_random
    into v_host, v_guest, v_random
    from rooms r where r.code = p_room;

  if v_host is null or v_guest is null then
    raise exception '部屋が見つからないか、対戦相手がいません';
  end if;
  if not v_random then
    raise exception 'レートが付くのは野良マッチだけです';
  end if;
  if p_me <> v_host and p_me <> v_guest then
    raise exception 'この部屋の対戦者ではありません';
  end if;

  -- すでに記録済みなら、計算し直さずその時の数字を返す（二重計上のふた）
  select * into v_existing from results where room_code = p_room;
  if found then
    return query
      select p.rating,
             case when v_existing.winner_id = p_me then v_existing.winner_delta
                  else v_existing.loser_delta end,
             (select q.rating from players q
               where q.id = case when v_existing.winner_id = p_me
                                 then v_existing.loser_id else v_existing.winner_id end),
             p.games
        from players p where p.id = p_me;
    return;
  end if;

  if p_won then
    v_win := p_me;  v_lose := case when p_me = v_host then v_guest else v_host end;
  else
    v_lose := p_me; v_win  := case when p_me = v_host then v_guest else v_host end;
  end if;

  insert into players (id) values (v_win)  on conflict (id) do nothing;
  insert into players (id) values (v_lose) on conflict (id) do nothing;

  -- 二人ぶんを順番を決めて掴む（同時に走っても行き違わないように）
  perform 1 from players where id in (v_win, v_lose) order by id for update;

  select p.rating, p.games into v_wr, v_wg from players p where p.id = v_win;
  select p.rating, p.games into v_lr, v_lg from players p where p.id = v_lose;

  v_kw := case when v_wg < 10 then 40 when v_wr < 1800 then 24 else 16 end;
  v_kl := case when v_lg < 10 then 40 when v_lr < 1800 then 24 else 16 end;

  -- 勝つ見込み。格上に勝つほど大きく増え、格下に負けるほど大きく減る
  v_exp := 1.0 / (1.0 + power(10.0, (v_lr - v_wr) / 400.0));
  v_wd  := round(v_kw * (1.0 - v_exp));
  v_ld  := -round(v_kl * (1.0 - v_exp));
  if v_wd < 1 then v_wd := 1; end if;          -- 勝ったのに増えないのは気持ちが悪い

  -- 100を下限にする（負け続けても0にはしない）
  if v_lr + v_ld < 100 then v_ld := 100 - v_lr; end if;

  update players set rating = rating + v_wd, games = games + 1, wins = wins + 1,
                     best = greatest(best, rating + v_wd), updated_at = now()
   where id = v_win;
  update players set rating = rating + v_ld, games = games + 1, losses = losses + 1,
                     updated_at = now()
   where id = v_lose;

  insert into results (room_code, winner_id, loser_id, winner_delta, loser_delta,
                       winner_after, loser_after)
       values (p_room, v_win, v_lose, v_wd, v_ld, v_wr + v_wd, v_lr + v_ld)
  on conflict (room_code) do nothing;

  update rooms set status = 'finished' where code = p_room;

  return query
    select p.rating,
           case when v_win = p_me then v_wd else v_ld end,
           (select q.rating from players q where q.id = case when v_win = p_me then v_lose else v_win end),
           p.games
      from players p where p.id = p_me;
end $$;

grant execute on function report_result(text, uuid, boolean) to anon;

-- ---- レートの近い人と当てる野良マッチ -------------------------------------
-- 引数が増えたので、古い4引数版は落としてから作り直す（呼び分けが曖昧になるため）
drop function if exists match_random(uuid, text, text, jsonb);

create or replace function match_random(
  p_me     uuid,
  p_mode   text,
  p_code   text,      -- 新しく待つときに使う6文字（クライアント生成）
  p_state  jsonb,     -- 新しく待つときの初期状態
  p_rating int default 1200,
  p_band   int default 150   -- 許すレート差。待つほどクライアントが広げてくる
)
returns table(code text, seat int, opp_rating int)
language plpgsql security definer as $$
declare
  v_code text; v_opp int; v_guest uuid;
begin
  -- 1. 自分の部屋にもう相手が入っていたら、それを返す
  select r.code, r.guest_id into v_code, v_guest
    from rooms r
   where r.is_random and r.host_id = p_me and r.guest_id is not null
     and r.created_at > now() - interval '10 minutes'
   order by r.created_at desc limit 1;
  if v_code is not null then
    return query select v_code, 0,
      (select p.rating from players p where p.id = v_guest);
    return;
  end if;

  -- 2. 待っている自分の部屋はいったん畳む。
  --    掴みに行く間に自分が掴まれると、二人が別々の部屋で待つことになる。
  delete from rooms r where r.is_random and r.host_id = p_me and r.guest_id is null;

  -- 3. レート差が p_band 以内の相手を、近い順に1つ掴む
  update rooms
     set guest_id = p_me, status = 'playing'
   where rooms.code = (
         select r.code from rooms r
          where r.is_random
            and r.status = 'waiting'
            and r.guest_id is null
            and r.host_id <> p_me
            and r.mode = p_mode
            and r.created_at > now() - interval '90 seconds'
            and abs(coalesce(r.rating, 1200) - p_rating) <= p_band
          order by abs(coalesce(r.rating, 1200) - p_rating), r.created_at
            for update skip locked
          limit 1)
   returning rooms.code, rooms.rating into v_code, v_opp;

  if v_code is not null then
    return query select v_code, 1, v_opp;
    return;
  end if;

  -- 4. 誰も居なければ自分が待つ
  insert into rooms (code, status, host_id, is_random, mode, rating)
       values (p_code, 'waiting', p_me, true, p_mode, p_rating);
  insert into matches (room_code, state) values (p_code, p_state);
  return query select p_code, 0, null::int;
end $$;

grant execute on function match_random(uuid, text, text, jsonb, int, int) to anon;

-- ---- 近いレート帯に何人待っているか ---------------------------------------
create or replace function queue_size(p_mode text)
returns int language sql stable security definer as $$
  select count(*)::int from rooms
   where is_random and status = 'waiting' and guest_id is null
     and mode = p_mode and created_at > now() - interval '90 seconds';
$$;

grant execute on function queue_size(text) to anon;

-- ---- 上位のランキング -----------------------------------------------------
create or replace function top_players(p_limit int default 20)
returns table(rating int, games int, wins int, losses int)
language sql stable security definer as $$
  select p.rating, p.games, p.wins, p.losses
    from players p
   where p.games > 0
   order by p.rating desc, p.wins desc
   limit least(coalesce(p_limit, 20), 100);
$$;

grant execute on function top_players(int) to anon;
