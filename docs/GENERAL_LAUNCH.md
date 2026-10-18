# 一般ユーザー向け公開（general Production）

## 判断ログ

### Gate 3：general Production（2026-10-18）

- 判断：**合格**。一般ユーザー向けの Production（Vercel プロジェクト `ai-chiiki-general`、commit `fe8d255`）は、独立した2回の一周テストに連続で成功した。Deployment Protection は有効のまま。一般公開はまだしない（別途判断する）。
- 理由：本番の環境・DB・AI で、登録から連絡先の開示・マイページ編集・AI 読み取りまでを、テスト用の新しいユーザーで2回とも全項目成功した。P2028・5xx・CSP violation・routing error はいずれも0件。
- 捨てた案：
  - 1回目の失敗後に「再実行したら成功した」で合格とする。
  - テストの都合で本番の CSP を緩める。
- トレードオフ：OpenAI の利用記録は、個々の API request と Dashboard の記録を1対1では対応づけられていない（下の「留意点」）。
- 審査上の意味：一般向けの本番が、demo とは別の DB・別の OpenAI Project・別の秘密値で、一周の流れを再現できることを確認した。

#### 経緯

- 初回の Round 1 は Gate 上「失敗」とした（30項目中6項目が NG）。原因はテストハーネスで、アプリの不具合ではなかった。
  - ハーネスの `waitForFunction` が本番の CSP（`script-src 'self'`）で止まり、待機が効かなかった。
  - AI の判定を表示文字列で行っていた。
  - 画面と DB の保存内容は正しかった。
- 対応：
  - CSP は変えていない。
  - 待機を Playwright の locator + `expect` / `expect.poll` に置き換えた。
  - マイページは、保存完了の表示と再読み込み後の表示で判定するようにした。
  - AI は構造化結果で判定するようにした。
  - 初回 Round 1 のデータは、read-only で Round 1 由来だけであることを確認してから削除した。
  - 修正したハーネスで、新しい2回を取り直した。

#### 検証結果

| 項目 | 結果 |
|---|---|
| deployment | `fe8d255`（Functions 7個・Hobby の上限12個以内）。Production の alias はこの deployment を指す |
| 新 Round 1 | 30/30 成功 |
| 新 Round 2 | 30/30 成功（別の random identifier・再実行ではない） |
| P2028 / 5xx / page error / CSP violation / routing error | すべて 0 |
| AI 抽出 | 両回とも正常（200）。構造化結果は `draft.itemId` = トマトの master ID、`quantityKg` = 5、`originPrefectures` = `["大阪府"]` |
| OpenAI | Project `ai-chiiki-general` に `gpt-6-luna` の利用記録あり。$5 hard limit 有効 |
| DB の保存内容（read-only） | 店舗名・住所、優先3つ、生産者の連絡先（メールのみ）、作物（トマト・なす）、出品、相談（approved） |
| cleanup 後の DB | User / Restaurant / Producer / Supply / ApprovalRequest / Relationship / AuthThrottle すべて 0。master data 維持、migration 6件維持 |
| Deployment Protection | 有効のまま。一時的な automation bypass は削除済み。bypass なしで 302 になることを確認 |

- 各回の30項目は、次の12手順の確認26項目と、page error / CSP violation / 5xx / routing error がないことの確認4項目。
  1. 飲食店の登録
  2. 生産者の登録
  3. onboarding
  4. 出品
  5. 仕入れ案
  6. 確認依頼
  7. 未対応バッジ
  8. 「対応できます」
  9. 飲食店への反映
  10. 承認後だけ連絡先を表示
  11. マイページ編集
  12. AI 読み取り
- テスト用アカウントは `smoke-*@example.invalid`。
- 2回目の前に1回目のデータを削除し、2回目の仕入れ案が1回目の生産者に割り当たらない状態で実行した。どちらも削除前に read-only で、所有関係と件数を確認した。

#### 留意点

- OpenAI Dashboard の記録時刻は 13:17・13:36 JST。smoke test の想定時刻 13:34・13:37 JST と完全には一致しない。そのため、個々の API request と Dashboard の記録の1対1対応までは確認できていない。
- ただし、次の3点を確認できたため、Gate 3 の目的は満たしたと判断する。
  - 本番アプリ上で AI が正常に動作した。
  - general 専用 Project に利用記録がある。
  - 記録のモデル（`gpt-6-luna`）と利用制限（$5 hard limit）を確認した。
- 一般公開（Deployment Protection の解除）と Gate 4（demo Production）は、この記録とは別に判断する。

### Gate 4：demo Production（2026-10-18）

- 判断：**合格**。既存の demo Production（Vercel プロジェクト `ai-chiiki-mvp-redesign`）を、共通コード（commit / tree `c853920`）へ更新した。demo 専用の挙動と既存のデモストーリーは維持した。
- 理由：
  - 本番でデモストーリーを 22/22 項目すべて成功した。
  - P2028・5xx・CSP violation・routing error・runtime error はいずれも0件。
  - general と demo は、別の DB・別のモード（`APP_MODE`）のまま動いている。
- 捨てた案：
  - migration を down して元に戻す。
  - `demo-day-final` tag を新しい版へ動かす。
- トレードオフ：DB には追加の migration（`general_user_foundation`）が残る。コードは `195204a` の deployment へ戻せる状態を保つ。
- 審査上の意味：デモデイの「在庫条件が変わると、複数農家を組み合わせた仕入れ案も再計算される」という価値を壊さずに、一般向けの版への導線を足した。

#### 検証結果

| 項目 | 結果 |
|---|---|
| deployment | commit / tree `c853920`（Functions 7個）。canonical URL `https://ai-chiiki-mvp-redesign.vercel.app` はこの deployment を指す |
| demo Production DB の migration | `prisma migrate deploy` で `general_user_foundation` だけを適用した。6件すべて適用済み、rolled back なし、schema の差分なし |
| 旧版 `195204a` | migration 後の DB に対して動作確認済み（demo-r・demo-a のログイン、`/api/me`、A10 の仕入れ案） |
| 環境変数 | `APP_MODE=demo` と `VITE_GENERAL_APP_URL=https://ai-chiiki-general.vercel.app` を追加した。既存の DB・SESSION_SECRET・OpenAI・DEMO_NOW は変更していない |
| deploy 直後の確認（非破壊） | `appMode=demo`、固定日時（2026-10-22 12:00 JST）、demo account のログイン、一般向け API（登録・onboarding・profile）は demo で利用不可（404）、API rewrite・7 Functions 正常 |
| デモストーリー | 22/22 成功（下の流れ） |
| P2028 / 5xx / CSP violation / routing error / runtime error | すべて 0 |
| 一般向けへの導線 | デモの「一般向けのサービスへ」は `https://ai-chiiki-general.vercel.app/` を指す |
| final reset 後の DB | A10 / B5 / C0 / D10、ApprovalRequest 0、demo user 維持、架空の連絡先は初期値、migration 6件 |
| `demo-day-final` | `195204a` のまま維持（ロールバックの基準） |

デモストーリーの流れ：
1. 飲食店がトマト 10kg を要求する → A10 で揃う（¥6,800）。
2. A農園が 5kg に変える → 案が無効になり、計算し直すと A5 ＋ B5（¥6,550）。
3. 生産者に確認を依頼する。返事の前は連絡先を見られない（API も拒否する）。
4. A農園が「対応できます」と返事する。この時点では B の連絡先は拒否される。
5. B農園が「対応できます」と返事する → 飲食店に双方の状態が反映される。承認しても在庫は変わらない。
6. 対応できる農家だけ連絡先を表示する。
7. A農園が連絡先を編集する → 飲食店の表示に反映される。
8. B農園が 4kg に変える → 計算し直すと「あと1kg 足りません」・9kgまで（¥6,000）。

#### 留意点

- migration 前の demo Production DB は D15・ApprovalRequest 2件で、完全な初期状態ではなかった。最後の変更は 2026-10-17 22:42 JST。
- 約15時間変更がなく、利用中ではないことを確認してから migration した。migration の前に、全テーブルを read-only でリポジトリ外へ退避した。
- 最終的に reset-demo でデモ開始状態へ戻した。
