import { describe, expect, it } from "vitest";
import {
  clearSessionCookie, createSessionToken, hashPassword, readCookie, sessionCookie, SESSION_TTL_SEC,
  verifyPassword, verifySessionToken,
} from "./auth.js";

const KEY = "test-secret-0123456789-abcdefghijklmnop";
const NOW = new Date("2026-10-22T12:00:00+09:00");

describe("パスワード（scrypt）", () => {
  it("平文を含まないハッシュを作り、正しいパスワードだけ通す", async () => {
    const h = await hashPassword("テスト用-pass-1");
    expect(h).toMatch(/^scrypt\$/);
    expect(h).not.toContain("テスト用-pass-1");
    expect(await verifyPassword("テスト用-pass-1", h)).toBe(true);
    expect(await verifyPassword("ちがう", h)).toBe(false);
  });

  it("同じパスワードでもソルトが違うのでハッシュは毎回変わる", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("ハッシュが無い・壊れているときは拒否する", async () => {
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", "plain-text")).toBe(false);
  });
});

describe("セッション（署名付き Cookie）", () => {
  const user = { id: "u1", role: "producer" as const };

  it("署名が正しく期限内なら userId・role・期限を返す", () => {
    const t = createSessionToken(user, NOW, KEY);
    expect(verifySessionToken(t, NOW, KEY)).toMatchObject({ uid: "u1", role: "producer" });
  });

  it("中身の書き換え（role を restaurant に変更）・署名の改ざん・別の秘密鍵は拒否する", () => {
    const t = createSessionToken(user, NOW, KEY);
    const [data, sig] = t.split(".");
    const payload = JSON.parse(Buffer.from(data, "base64url").toString());
    const forged = Buffer.from(JSON.stringify({ ...payload, role: "restaurant" })).toString("base64url");
    expect(verifySessionToken(`${forged}.${sig}`, NOW, KEY)).toBeNull();
    expect(verifySessionToken(`${data}.${sig.slice(0, -2)}xx`, NOW, KEY)).toBeNull();
    expect(verifySessionToken(t, NOW, "another-secret-0123456789-abcdefghij")).toBeNull();
    expect(verifySessionToken("garbage", NOW, KEY)).toBeNull();
    expect(verifySessionToken(`${t}.extra`, NOW, KEY)).toBeNull();
  });

  it("期限切れは拒否する", () => {
    const t = createSessionToken(user, NOW, KEY);
    expect(verifySessionToken(t, new Date(NOW.getTime() + SESSION_TTL_SEC * 1000 + 1), KEY)).toBeNull();
  });

  it("Cookie は HttpOnly・SameSite=Lax・Path=/・期限付き。本番では Secure。秘密情報は入れない", () => {
    const c = sessionCookie("tok", {});
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Path=/");
    expect(c).toContain(`Max-Age=${SESSION_TTL_SEC}`);
    expect(c).not.toContain("Secure");
    expect(sessionCookie("tok", { VERCEL_ENV: "production" })).toContain("Secure");
    expect(clearSessionCookie({})).toContain("Max-Age=0");
    const token = createSessionToken(user, NOW, KEY);
    expect(Buffer.from(token.split(".")[0], "base64url").toString()).not.toContain(KEY);
  });

  it("Cookie ヘッダーから指定の名前だけ読む", () => {
    const r = new Request("http://x/", { headers: { cookie: "a=1; aic_session=abc.def; b=2" } });
    expect(readCookie(r, "aic_session")).toBe("abc.def");
    expect(readCookie(r, "none")).toBeNull();
  });
});
