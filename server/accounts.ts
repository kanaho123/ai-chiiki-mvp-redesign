import { randomBytes } from "node:crypto";
import { hashPassword } from "./auth.js";
import { PRIVACY_VERSION, TERMS_VERSION } from "./legal.js";
import type { Role } from "./repo.js";

// 一般ユーザーの新規登録とログイン名の扱い（DB アクセスは呼び出し側から渡す。権限・重複のテストで差し替える）。

/** メールアドレスは登録・ログイン・重複判定のすべてで、サーバー側でこの形にそろえる */
export const normalizeEmail = (raw: string) => raw.trim().toLowerCase();

const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export type SignupField = "email" | "password" | "passwordConfirm" | "role" | "legal";
export type SignupInput = { email: string; password: string; role: Role };
export type SignupParse = { ok: true; value: SignupInput } | { ok: false; field: SignupField; error: string };

/** 入力の確認。誤りは該当欄の近くに出せるよう、欄の名前と具体的な文言を返す */
export function parseSignup(body: unknown): SignupParse {
  if (!body || typeof body !== "object") return { ok: false, field: "email", error: "メールアドレスを入力してください" };
  const b = body as Record<string, unknown>;
  const email = typeof b.email === "string" ? normalizeEmail(b.email) : "";
  const password = typeof b.password === "string" ? b.password : "";
  const confirm = typeof b.passwordConfirm === "string" ? b.passwordConfirm : "";
  if (!email) return { ok: false, field: "email", error: "メールアドレスを入力してください" };
  if (email.length > 254 || !EMAIL_RE.test(email)) return { ok: false, field: "email", error: "メールアドレスの形式を確認してください（例：name@example.com）" };
  if (password.length < PASSWORD_MIN) return { ok: false, field: "password", error: `パスワードは${PASSWORD_MIN}文字以上にしてください` };
  if (password.length > PASSWORD_MAX) return { ok: false, field: "password", error: `パスワードは${PASSWORD_MAX}文字以内にしてください` };
  if (normalizeEmail(password) === email) return { ok: false, field: "password", error: "メールアドレスと同じパスワードは使えません" };
  if (confirm !== password) return { ok: false, field: "passwordConfirm", error: "確認用のパスワードが一致しません" };
  if (b.role !== "restaurant" && b.role !== "producer") return { ok: false, field: "role", error: "飲食店か生産者を選んでください" };
  if (b.legalAccepted !== true) return { ok: false, field: "legal", error: "利用規約とプライバシーポリシーへの同意が必要です" };
  return { ok: true, value: { email, password, role: b.role } };
}

/** 一般ユーザーの内部用ログインID（画面には出さない）。十分長いランダム値で、デモ用の demo- では始まらない */
export function generateLoginId(): string {
  return `u-${randomBytes(24).toString("base64url")}`; // 192bit・32文字
}

type CreateResult = { ok: true; id: string } | { ok: false; conflict: "email" | "loginId" };
export type SignupDeps = {
  createGeneralUser: (data: {
    email: string; loginId: string; passwordHash: string; role: Role;
    legalAcceptedAt: Date; termsVersion: string; privacyVersion: string;
  }) => Promise<CreateResult>;
};
export type SignupResult = { ok: true; id: string } | { ok: false; reason: "duplicate-email" | "loginId-exhausted" };

/** 新規作成。同意の版と日時はサーバーで決める。内部用ログインIDが衝突したら作り直す（最大5回） */
export async function createAccount(input: SignupInput, now: Date, deps: SignupDeps): Promise<SignupResult> {
  const passwordHash = await hashPassword(input.password);
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await deps.createGeneralUser({
      email: input.email, loginId: generateLoginId(), passwordHash, role: input.role,
      legalAcceptedAt: now, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION,
    });
    if (r.ok) return { ok: true, id: r.id };
    if (r.conflict === "email") return { ok: false, reason: "duplicate-email" };
  }
  return { ok: false, reason: "loginId-exhausted" };
}
