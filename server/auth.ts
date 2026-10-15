import { createHash, timingSafeEqual } from "node:crypto";
import { json } from "./http.js";

/** 編集用合言葉を受け取るリクエストヘッダー */
export const PASSPHRASE_HEADER = "x-edit-passphrase";

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

/**
 * 出品の登録・変更は、サーバーの環境変数 EDIT_PASSPHRASE と一致する合言葉があるときだけ許可する。
 * 未設定なら編集はすべて拒否する（閲覧・仕入れ案の作成には関係しない）。
 * 許可しない場合は返す Response、許可する場合は null。
 */
export function requireEditPassphrase(request: Request): Response | null {
  const expected = process.env.EDIT_PASSPHRASE;
  if (!expected) return json({ error: "現在、出品の編集はできません（合言葉が設定されていません）" }, 503);
  // 日本語の合言葉も送れるよう、画面側で encodeURIComponent したものを受け取る
  let given: string | null = null;
  try {
    const raw = request.headers.get(PASSPHRASE_HEADER);
    given = raw ? decodeURIComponent(raw) : null;
  } catch {
    given = null;
  }
  // 長さに依存しない比較のため、ハッシュ同士を一定時間で比べる
  if (!given || !timingSafeEqual(digest(given), digest(expected)))
    return json({ error: "編集用の合言葉が違います", code: "passphrase_required" }, 401);
  return null;
}
