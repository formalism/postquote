# アプリケーション概要

起動されると指定された株式の株価を取得し、Discord に通知する。

## 設計

アプリケーションはTypeScriptで記述し、[Bun](https://bun.sh/)で実行する。

```
bun i && bun build index.ts --compile --outfile postquote
```
とすると、postquoteという名前で実行バイナリを作成できる。

### 設定情報

`settings.conf` にテキストファイルとして設定を記入する。

例:

```
CODES=4005,7511,8734
AMOUNTS=100,200,100
DISCORD_WEBHOOK_URL=(discord webhook url)
```

説明:
- CODES: 株式コードをカンマ区切りで列挙する
- AMOUNTS (optional): 存在する場合は、株式数量をカンマ区切りで列挙する。この数値の順番は、CODESで指定した株式コードと対応するものとする。
- DISCORD_WEBHOOK_URL: DiscordのWebhookのURL

### 動作

- 起動すると、上記CODES, AMOUNTS, DISCORD_WEBHOOK_URLをsettings.confから読み込む。
   - CODESで指定した株式コード個数とAMOUNTSで指定した株式数量の個数が一致しない場合はエラーを出力して終了する。
- `DISCORD_WEBHOOK_URL` または `CODES` が設定されていない場合はエラーを出力して終了する。
- CODESのそれぞれについて:
   - https://finance.yahoo.co.jp/quote/{CODE}.T というアドレスをGETして、会社名、現在の株価と前日比(株価の変動額と変動率)を取得する。
- 株価の取得に成功した銘柄のみを通知対象とする。すべての銘柄取得に失敗した場合は Discord へ通知せず終了する。
- Discord への通知は、まず株価一覧を表形式の PNG 画像として Webhook に添付して送信する。
   - Webhook への送信は `multipart/form-data` 形式で行い、`payload_json` に本文、`files[0]` に `stock-table.png` を設定する。
   - 本文は固定で `株価一覧` とする。
- PNG 生成または画像添付による送信に失敗した場合は、テキスト形式の表にフォールバックして Discord へ送信する。
   - テキスト送信時は `application/json` 形式で POST し、JSON の `content` にコードブロック化した表を設定する。
   - `content` は最大 2000 文字のため、超過する場合はコードブロック単位で適切に分割して複数回送信する。
- `AMOUNTS` が指定されている場合は、取得した株価と数量から評価額合計および前日比合計を算出する。
   - 合計行は、全銘柄の株価取得および数値変換に成功した場合のみ通知に含める。
- PNG 生成時は日本語表示のための埋め込みフォントを取得して利用し、`.cache/fonts` 配下へキャッシュする。
- アプリケーションを終了する。
