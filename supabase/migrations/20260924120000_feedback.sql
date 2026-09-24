-- フィードバック（遊んでいる人からの声）。画面を3回タップすると送れる。
-- 公開キー（anon）は追加だけできて、読めない・消せない・書き換えられない。読むのは管理者だけ。
-- Apply as project owner. Never put service-role credentials in the website.
begin;
create table if not exists public.feedback (
  id          uuid primary key,
  visitor_id  uuid not null,                       -- 既存の匿名ID finst_id。名前は持たない
  message     text not null check (char_length(btrim(message)) between 1 and 2000),
  -- 送った瞬間の状況（画面・モード・盤面など）。部屋コードは入れない。
  context     jsonb not null default '{}'::jsonb check (pg_column_size(context) <= 24000),
  is_test     boolean not null default false,      -- 本番以外から送ったもの
  created_at  timestamptz not null default now(),
  handled     boolean not null default false       -- 読んだ・対応したの印（管理者が付ける）
);

alter table public.feedback enable row level security;
revoke all on public.feedback from public, anon, authenticated;
-- 送る側は、中身を入れることしかできない（読めない・消せない・書き換えられない）
grant insert (id, visitor_id, message, context, is_test) on public.feedback to anon;
grant select, insert, update, delete on public.feedback to service_role;

drop policy if exists feedback_insert_only on public.feedback;
create policy feedback_insert_only on public.feedback for insert to anon
  with check (handled = false);

create index if not exists feedback_created_idx on public.feedback (created_at desc);
create index if not exists feedback_open_idx on public.feedback (created_at desc) where not handled;
commit;
