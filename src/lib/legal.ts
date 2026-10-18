// 利用規約・プライバシーポリシーの版と、運営者の情報（画面とサーバーで共通）。
// 新規登録時の同意は、クライアントから送られた値ではなく、ここにある版とサーバーの現在時刻で記録する（server/legal.ts）。
// 文書を改訂したら版を上げる。版が "-draft" で終わる間は、画面に「公開前の案」と表示する。
export const TERMS_VERSION = "2026-10-18";
export const PRIVACY_VERSION = "2026-10-18";
export const isDraftVersion = (v: string) => v.endsWith("-draft");

// 運営者の情報（運営者が確定したもの）。推測で項目を足さない
export const OPERATOR = {
  name: "beyond the past",
  contact: "ka77o@icloud.com",
  effectiveDate: "2026年10月18日",
} as const;

/** 運営者の情報に未定の項目が残っているか（公開前の確認用） */
export const hasUndecidedOperatorInfo = () => Object.values(OPERATOR).some((v) => v.includes("未定"));
