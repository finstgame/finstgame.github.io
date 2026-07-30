-- フィンスト Phase 3：Supabase スキーマ
-- Supabase ダッシュボードの SQL Editor にそのまま貼って実行する。
--
-- 前提（仕様書 §5 の「注意」）:
--   静的サイトなのでサーバー側の審判が存在せず、クライアントが state を書き込む。
--   よって RLS は「ルームコードを知っている人なら誰でも読み書きできる」までしか絞れない。
--   理屈上チートは可能。友達内なら許容範囲という判断で進めている。
--   必要になったら判定ロジックを Edge Functions に移し、書き込みをサービスロールに限定する。

create table if not exists rooms (
  code        text primary key,                -- 6文字のルームコード
  status      text not null default 'waiting',  -- waiting | playing | finished
  host_id     uuid not null,                    -- 作成したクライアントの匿名ID
  guest_id    uuid,                             -- 合流したクライアントの匿名ID
  created_at  timestamptz not null default now()
);

create table if not exists matches (
  room_code   text primary key references rooms(code) on delete cascade,
  state       jsonb not null,
  -- 応答フェーズの締切。両クライアントは「表示するだけ」で、ここを唯一の基準にする（§4）
  deadline    timestamptz,
  updated_at  timestamptz not null default now()
);

create index if not exists rooms_created_at_idx on rooms (created_at desc);

-- updated_at を自動更新して、Realtime の順序判定に使えるようにする
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists matches_touch on matches;
create trigger matches_touch before update on matches
  for each row execute function touch_updated_at();

-- Realtime（Postgres の行変更の購読）を有効にする
-- 既に入っていると alter publication はエラーになるので、入っていない時だけ追加する
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'matches') then
    alter publication supabase_realtime add table matches;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rooms') then
    alter publication supabase_realtime add table rooms;
  end if;
end $$;

-- ---- RLS ----------------------------------------------------------------
-- anon キーだけで遊べるようにするため、匿名ユーザーに読み書きを許可する。
-- ルームコードが事実上の合言葉。上の「前提」を承知の上での設定。
alter table rooms   enable row level security;
alter table matches enable row level security;

drop policy if exists rooms_anon_all on rooms;
create policy rooms_anon_all on rooms
  for all to anon using (true) with check (true);

drop policy if exists matches_anon_all on matches;
create policy matches_anon_all on matches
  for all to anon using (true) with check (true);

-- ---- 後片付け ------------------------------------------------------------
-- 無料枠を圧迫しないよう、古い部屋を落とす。
-- Supabase の Cron（pg_cron）から1日1回呼ぶ想定。
create or replace function purge_old_rooms()
returns void language sql as $$
  delete from rooms where created_at < now() - interval '2 days';
$$;
