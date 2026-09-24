-- フィードバックが届いたら、管理者へメールで知らせる。
-- 送信は Resend（https://resend.com 無料枠）。Supabase から直接APIを呼ぶ（pg_net）。
--
-- APIキーと宛先のメールアドレスは、このファイルにもリポジトリにも書かない。
-- Supabase Vault（暗号化された保管庫）に次の名前で入れておく:
--   resend_api_key      … Resend のAPIキー（re_ で始まる）
--   feedback_notify_to  … 通知を受け取るメールアドレス（Resendに登録したアドレス）
-- どちらかが無ければ、何も送らない（フィードバックの保存はそのまま成功する）。
--
-- 通知に失敗しても、フィードバックの保存は止めない（例外は握りつぶす）。
-- pg_net は非同期なので、Resend が遅くても投稿者は待たされない。
-- Apply as project owner.
begin;
create extension if not exists pg_net with schema extensions;

create or replace function public.notify_feedback_email()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key  text;
  v_to   text;
  v_ctx  jsonb := coalesce(new.context, '{}'::jsonb);
  v_head text;
  v_body text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'resend_api_key'     limit 1;
  select decrypted_secret into v_to  from vault.decrypted_secrets where name = 'feedback_notify_to' limit 1;
  if v_key is null or v_to is null then
    return new;                                     -- 未設定なら送らない
  end if;

  v_head := case when new.is_test then '[テスト] ' else '' end
         || 'フィンストにフィードバック: '
         || left(regexp_replace(new.message, '\s+', ' ', 'g'), 40);

  v_body := new.message || E'\n\n'
         || '――――――――――' || E'\n'
         || '日時: ' || to_char(new.created_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI') || E'\n'
         || '画面: ' || coalesce(v_ctx->>'screen', '-') || E'\n'
         || '遊び方: ' || concat_ws(' / ', v_ctx->>'play', v_ctx->>'rule', v_ctx->>'deck') || E'\n'
         || '盤面: ' || coalesce(v_ctx->'board'->>'hands', '（添付なし）') || E'\n'
         || '端末: ' || coalesce(v_ctx->>'device', '-') || E'\n'
         || '送った人: ' || left(new.visitor_id::text, 8) || E'\n'
         || 'ID: ' || new.id::text || E'\n\n'
         || '詳しくは SQL Editor で supabase/feedback-report.sql を実行してください。';

  perform net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key,
                                  'Content-Type',  'application/json'),
    body    := jsonb_build_object('from',    'Finst <onboarding@resend.dev>',
                                  'to',      jsonb_build_array(v_to),
                                  'subject', v_head,
                                  'text',    v_body)
  );
  return new;
exception when others then
  return new;                                       -- 通知の失敗で保存を止めない
end $$;

-- 誰からも直接は呼べない。トリガーからだけ動く
revoke all on function public.notify_feedback_email() from public, anon, authenticated;

drop trigger if exists feedback_email on public.feedback;
create trigger feedback_email
  after insert on public.feedback
  for each row execute function public.notify_feedback_email();
commit;
