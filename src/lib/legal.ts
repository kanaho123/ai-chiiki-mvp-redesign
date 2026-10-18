// 利用規約・プライバシーポリシーの版と、運営者の情報（画面とサーバーで共通）。
// 新規登録時の同意は、クライアントから送られた値ではなく、ここにある版とサーバーの現在時刻で記録する（server/legal.ts）。
// 文書を改訂したら版を上げる。版が "-draft" で終わる間は、画面に「公開前の案」と表示する。
export const TERMS_VERSION = "2026-10-17-draft";
export const PRIVACY_VERSION = "2026-10-17-draft";
export const isDraftVersion = (v: string) => v.endsWith("-draft");

// 運営者の情報。まだ決まっていない項目は【未定：…】のまま表示する（推測で埋めない）。公開前に運営者が記入する
export const OPERATOR = {
  name: "【未定：運営者名】",
  contact: "【未定：お問い合わせ先（メールアドレス等）】",
  effectiveDate: "【未定：施行日】",
  retention: "【未定：保存期間】",
  fees: "【未定：利用料・受渡料金の扱い】",
  jurisdiction: "【未定：管轄裁判所】",
} as const;

/** 運営者の情報に未定の項目が残っているか（公開前の確認用） */
export const hasUndecidedOperatorInfo = () => Object.values(OPERATOR).some((v) => v.startsWith("【未定"));
