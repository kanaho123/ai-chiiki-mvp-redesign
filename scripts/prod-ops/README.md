# 一般向けのデモデータ（架空）の運用ツール

一般向けの DB に、デモデイ用の架空のデモデータを入れる・確かめる・消すためのツールです。アプリの本体や Vercel の Functions からは使いません（型チェックとデプロイの対象外）。

- `general-demo-data.mts`：3農家デモ（デモ A〜D農園（架空）のトマト・10/27 9:00〜11:00・確認用の店「デモ 食堂（架空）」）
- `general-demo-kale.mts`：AI の代替候補の補足デモ用「ケール」（デモ A農園（架空）・3kg・同じ回）と、その取引（相談・やり取り）

## 安全のための決まり

- どのコマンドにも `--target dev` か `--target production` を付けます。付けなければ動きません。
- 接続情報（`DATABASE_URL` など）は、リポジトリ直下の `.env.general.local`（dev）／`.env.general.production.local`（本番）からだけ読みます。これらは Git に入れません。スクリプトにも書きません。
- 接続先の DB の endpoint が `--target` の値と一致しなければ止まります。ほかの環境（demo Production など）の DB なら止まります。
- 書き込み（insert・delete）には、確認の合言葉（`--confirm …`）が必要です。
- ID・ログイン情報の記録は、リポジトリの外に保存します（既定は `~/.ai-chiiki-ops/demo-data`、環境変数 `AIC_OPS_DATA_DIR` で変更可）。`*.restaurant-login.local` にはパスワードが入るので、Git やチャットに出さないでください。
- 消すのは、ID の記録ファイルから辿れる架空のデモの行だけです（名前では探しません）。本物の利用者のデータが関わっていれば、何も消さずに止まります。2回実行しても壊れません。

## よく使うコマンド（リポジトリ直下で）

`<data>` は記録の保存先（既定 `~/.ai-chiiki-ops/demo-data`）です。

```
# 確かめる（読み取りだけ）
npx tsx scripts/prod-ops/general-demo-data.mts inspect --target production --ids <data>/<日時>.ids.json
npx tsx scripts/prod-ops/general-demo-kale.mts inspect --target production --kale <data>/<日時>.kale.json --ids <data>/<日時>.ids.json

# ケールを足す前の確認と、比較用の記録（読み取りだけ）／足したあとの比較（読み取りだけ）
npx tsx scripts/prod-ops/general-demo-kale.mts precheck --target production --ids <data>/<日時>.ids.json --snap <data>/kale-before.snap.json
npx tsx scripts/prod-ops/general-demo-kale.mts verify --target production --ids <data>/<日時>.ids.json --snap <data>/kale-before.snap.json [--kale <data>/<日時>.kale.json]
```

## デモのあとの片付け（順番が大事）

1. **ケールを先に消す。** やり取り → 相談 → ケールの出品 → ケール用の品種 → 品目（このツールが作り、ほかから使われていないときだけ）を、1つのトランザクションで消します。デモの店とデモ A農園以外の相談・やり取り、同じ仕入れ案のほかの出品があれば、何も消さずに止まります。
   ```
   npx tsx scripts/prod-ops/general-demo-kale.mts inspect --target production --kale <data>/<日時>.kale.json --ids <data>/<日時>.ids.json
   npx tsx scripts/prod-ops/general-demo-kale.mts delete --target production --kale <data>/<日時>.kale.json --ids <data>/<日時>.ids.json --confirm GENERAL_PRODUCTION_DEMO_KALE_DELETE
   npx tsx scripts/prod-ops/general-demo-kale.mts verify --target production --ids <data>/<日時>.ids.json --snap <data>/kale-before.snap.json
   ```
2. **そのあと、トマトの A〜D のデモデータを消す。** デモの相談のやり取り → 相談 → 出品 → 回・参加 → 場所 → 生産者 → 飲食店 → ユーザーの順に消します。本物の利用者のデータがデモの行を参照していれば、何も消さずに止まります。
   ```
   npx tsx scripts/prod-ops/general-demo-data.mts inspect --target production --ids <data>/<日時>.ids.json
   npx tsx scripts/prod-ops/general-demo-data.mts delete --target production --ids <data>/<日時>.ids.json --confirm GENERAL_PRODUCTION_DEMO_DATA_DELETE
   ```

トマトのデモデータを先に消すと、ケールの出品は一緒に消えますが、品目「ケール」が残ります。そのときは、ケールの delete をあとから実行すると品目だけを片付けます。

本番の件数の比較には、本物の利用者の操作による増減が混ざることがあります。ケールに関係する行（品目・品種・出品・相談・やり取り）を見て判断してください。
