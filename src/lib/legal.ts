// 利用規約・プライバシーポリシーの版と、運営者の情報（画面とサーバーで共通）。
// 新規登録時の同意は、クライアントから送られた値ではなく、ここにある版とサーバーの現在時刻で記録する（server/legal.ts）。
// 文書を改訂したら版を上げる。版が "-draft" で終わる間は、画面に「公開前の案」と表示する。
export const TERMS_VERSION = "2026-10-18";
export const PRIVACY_VERSION = "2026-10-22"; // 改定したら、反映する日の版と改定日・改定履歴にする（確認中は末尾に "-draft"）
export const isDraftVersion = (v: string) => v.endsWith("-draft");

// プライバシーポリシーの制定日・最終改定日・改定履歴（利用規約の施行日 OPERATOR.effectiveDate とは別に管理する）。
// 改定のお知らせは、プライバシーポリシーの画面のこの表示で行う（専用のお知らせ機能はない）
export const PRIVACY_DATES = { established: "2026年10月18日", lastRevised: "2026年10月22日" } as const;
export const PRIVACY_HISTORY: readonly { date: string; text: string }[] = [
  { date: "2026年10月19日", text: "生産者の受け渡し場所の取り扱い（第1章〜第3章・第8章）を追記し、改定のお知らせ方法（第9章）を変更しました。" },
  { date: "2026年10月22日", text: "取引のやり取り・取引後の評価・いつもの農家の取り扱い（第1章〜第3章・第8章）、AI に送る情報（写真・食材の候補を含む）と音声入力（第4章・第5章）、受け渡し場所の登録方法（第1章）、端末への保存（第6章）を、現在の機能にあわせて追記・修正しました。" },
];

// 運営者の情報（運営者が確定したもの）。推測で項目を足さない
export const OPERATOR = {
  name: "beyond the past",
  contact: "ka77o@icloud.com",
  effectiveDate: "2026年10月18日",
} as const;

/** 運営者の情報に未定の項目が残っているか（公開前の確認用） */
export const hasUndecidedOperatorInfo = () => Object.values(OPERATOR).some((v) => v.includes("未定"));
