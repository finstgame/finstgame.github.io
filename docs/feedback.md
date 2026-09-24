# フィードバック

## 使い方（遊ぶ人）

画面の**何も無い所を、同じあたりで素早く3回タップ**すると「開発者に送る」が開く。気づいたこと・バグ・要望を書いて「送る」。

- 数えるのは「0.6秒以内・半径40px以内の3回」だけ。ボタン・手・カード・3D盤のクリスタルの上のタップは数えない（対戦の操作が誤爆しないように）。
- 「いまの画面の状態も一緒に送る」を付けると、盤面（両手の本数・上限・手札・使った札・毒や封印・直前の8手）が添付される。言葉だけでは再現できないバグの手がかりになる。
- 名前と部屋コードは送らない。送れなかった時は書いた文章を残し、もう一度押せる。

## 保存先と権限

既存のSupabaseプロジェクト `cxdooucxduldzvpyvnwt` の `feedback` テーブル。anon（公開キー）は**追加のみ**（読めない・消せない・書き換えられない）。読むのは管理者（service_role / SQL Editor）だけ。service_roleキーをWebに埋め込まない。

| 列 | 中身 |
| --- | --- |
| message | 本文（1〜2000字） |
| context | 送った瞬間の状況。画面・遊び方（CPU/オンライン/1台、ルール、種類）・配信日時・画面サイズ・UA、同意時は盤面 |
| visitor_id | 既存の匿名ID `finst_id`。同じ端末からの続報を束ねるためだけに使う |
| is_test | 本番（finstgame.github.io）以外から送ったもの。`?feedback_test=1` でも立つ |
| handled | 読んだ・対応したの印。管理者が付ける |

公開クライアントから送るため、中身の偽造やいたずら投稿は防げない。本文長と添付の大きさだけDBで制限している。

## 本番の有効化

1. 管理アカウントで [Supabase](https://supabase.com/dashboard/project/cxdooucxduldzvpyvnwt) の SQL Editor を開く。
2. `supabase/migrations/20260924120000_feedback.sql` を一度実行する（テーブル追加のみ。既存のゲームテーブルは変更しない）。
3. 実行前に送られたものは「受付の準備中です」と表示され、保存されない。

## メール通知

届くたびに管理者へメールが飛ぶ（`supabase/migrations/20260924130000_feedback_email.sql`）。送信は Resend の無料枠を使い、Supabase から直接呼ぶ（pg_net）。

**APIキーと宛先はリポジトリに書かない**（このリポジトリは公開）。Supabase Vault に入れる。これは管理者が自分で行う。

ダッシュボードの **Integrations → Vault → Secrets →「Add new secret」** で、次の2つを登録する。

| Name | Secret |
| --- | --- |
| `resend_api_key` | Resend のAPIキー（`re_` で始まる） |
| `feedback_notify_to` | Resend に登録したメールアドレス |

SQL Editor で `vault.create_secret(...)` を打つ方法もあるが、**エディタは自動保存されるので、キーが平文のままクエリ履歴に残る**。Vault の画面から入れる。

- 送信元は `onboarding@resend.dev`。独自ドメインを認証するまでは、**Resendに登録したアドレス宛てにしか送れない**。宛先はそのアドレスにする。
- どちらかが未設定なら送らない。通知に失敗してもフィードバックの保存は成功する。
- ローカル等から送った `is_test` のものは件名に `[テスト]` が付く。
- 送れたかどうかは SQL Editor で確かめる:

```sql
select created, status_code, left(content::text, 200) as 応答
from net._http_response order by created desc limit 5;
```

`200` なら送信済み。`403` はキー違い・宛先がResend登録アドレスと違う、`401` はキーの誤り。

キーを替えるときは `update vault.secrets set secret = '新しいキー' where name = 'resend_api_key';`。

## 読む

SQL Editor で `supabase/feedback-report.sql` を実行する。未対応のものが新しい順に50件出る。読み終えたら同ファイル末尾の `update ... set handled = true` で対応済みにする。

## 開発時の確認

- `node --test tests/*.test.mjs`：3回タップの判定（遅い・散らばる・ボタン上・3D盤のクリスタル上では開かない）、本文の整形、部屋コードを送らないこと、大きすぎる盤面を落として本文は届けること、失敗時に例外を出さないこと。
- ローカルから送った分は `is_test=true` になり、`feedback-report.sql` には出ない。
