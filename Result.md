# 実施結果報告書

Spec.mdに基づき、株価取得およびDiscord通知プログラムを実装しました。

## 実装内容

1.  **環境構築**
    - [Bun](https://bun.sh/) を使用した実行環境の構築。
    - `cheerio` ライブラリを使用したHTMLスクレイピングの実装。
2.  **パーサーの実装 (`parser.ts`)**
    - Yahoo!ファイナンスのHTMLから「会社名」「株価」「前日比（金額）」「前日比（率）」を抽出するロジックを実装しました。
3.  **メインプログラムの実装 (`index.ts`)**
    - `settings.conf` から株式コードとDiscord Webhook URLを読み込みます。
    - 各コードに対して非同期でデータを取得・解析します。
    - Discordの2000文字制限を考慮し、適切にメッセージを分割して送信します。

## 検証結果 (株式コード: 4005)

ご指定いただいた株式コード 4005 (住友化学(株)) について、取得データが期待通りであることを確認しました。

| 項目 | 取得値 (期待値) |
| :--- | :--- |
| **会社名** | 住友化学(株) |
| **現在の株価** | 470円 |
| **前日比 (金額)** | +5.5円 |
| **前日比 (率)** | +1.18% |

`confirm_4005.ts` による検証ログ:
```
Parsed Data from yahoo_4005.html:
Name: 住友化学(株)
Price: 470
Change Amount: +5.5
Change Percent: +1.18%

CONFIRMATION SUCCESS: Retrieved values match the user's request.
```

## 作成ファイル一覧

- `parser.ts`: スクレイピング・解析用モジュール
- `index.ts`: メイン実行プログラム
- `settings.conf`: 設定ファイル（株式コード、Webhook URL）
- `verify.ts`: モックデータによるパース検証スクリプト
- `confirm_4005.ts`: 実データ（保存済みHTML）による検証スクリプト

## 実行方法

```bash
bun run index.ts
```
