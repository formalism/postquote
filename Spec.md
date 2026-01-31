# アプリケーション概要

起動されると指定された株式の株価を取得し、Discordのチャネルに株価をポストする。

## 設計

アプリケーションはTypeScriptで記述し、[Bun](https://bun.sh/)で実行する。

### 設定情報

settings.confにテキストファイルとして設定を記入する

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
- CODESのそれぞれについて:
   - https://finance.yahoo.co.jp/quote/{CODE}.T というアドレスをGETして、会社名、現在の株価と前日比(株価の変動額と変動率)を取得する。
- 取得した会社名、株式コード、株価、前日比の一覧をDISCORD_WEBHOOK_URLのアドレスにapplication/json形式にてPOSTする。JSONは、contentというキーを持ち、その値として、取得した情報を設定する。ただしcontentは最大2000文字なので、それを超えないように適切に分割する。
   - 上記データ出力の最後に、指定されている場合は全株式の評価額合計値と合計値の前日比を表示する。
- アプリケーションを終了する。
