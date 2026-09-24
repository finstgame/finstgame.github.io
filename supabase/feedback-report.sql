-- フィードバックを読む（SQL Editorで管理者として実行）
-- 未対応のものが新しい順に出る。テスト送信は除く。

select
  to_char(created_at at time zone 'Asia/Tokyo', 'MM/DD HH24:MI')  as 日時,
  message                                                        as 内容,
  context->>'screen'                                             as 画面,
  concat_ws(' / ', context->>'play', context->>'rule', context->>'deck') as 遊び方,
  context->'board'->>'hands'                                     as 盤面,
  context->>'device'                                             as 端末,
  left(visitor_id::text, 8)                                      as 送った人,
  id
from public.feedback
where not is_test and not handled
order by created_at desc
limit 50;

-- 読み終えたら、上の id を入れて対応済みにする（次から出なくなる）
-- update public.feedback set handled = true where id = '...';

-- 送った瞬間の状況を全部見たいとき
-- select jsonb_pretty(context) from public.feedback where id = '...';
