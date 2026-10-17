import { afterEach, describe, expect, it, vi } from "vitest";
import { appEnvironmentProblems, appMode, AppEnvironmentError, DEMO_DB_ENDPOINTS, ORIGINAL_DB_ENDPOINTS } from "./app-mode";
import { assertGeneralDevDatabase } from "./db-safety";

const url = (ep: string, pooler = false) =>
  `postgresql://user:secret@${ep}${pooler ? "-pooler" : ""}.c-13.us-east-1.aws.neon.tech/neondb?sslmode=require`;
const GENERAL_EP = "ep-general-dev-test";
const generalDb = { DATABASE_URL: url(GENERAL_EP, true), DATABASE_URL_UNPOOLED: url(GENERAL_EP), GENERAL_DB_ENDPOINT: GENERAL_EP };

describe("実行環境（APP_MODE）と接続先の組み合わせ", () => {
  it("APP_MODE が無い・不正なら止める", () => {
    expect(appEnvironmentProblems({})).toHaveLength(1);
    expect(appEnvironmentProblems({ APP_MODE: "production" })).toHaveLength(1);
    expect(() => appMode({})).toThrow(AppEnvironmentError);
  });
  it("general mode：一般向けDBなら動き、デモ用DB・元アプリDB・DEMO_NOW は拒否する", () => {
    expect(appMode({ APP_MODE: "general", ...generalDb })).toBe("general");
    for (const ep of DEMO_DB_ENDPOINTS) {
      expect(appEnvironmentProblems({ APP_MODE: "general", DATABASE_URL: url(ep, true), DATABASE_URL_UNPOOLED: url(ep) }).length).toBeGreaterThan(0);
      // 片方だけデモ用でも止める
      expect(appEnvironmentProblems({ APP_MODE: "general", ...generalDb, DATABASE_URL_UNPOOLED: url(ep) }).length).toBeGreaterThan(0);
    }
    for (const ep of ORIGINAL_DB_ENDPOINTS) {
      expect(appEnvironmentProblems({ APP_MODE: "general", DATABASE_URL: url(ep, true) }).length).toBeGreaterThan(0);
    }
    expect(appEnvironmentProblems({ APP_MODE: "general", ...generalDb, DEMO_NOW: "2026-10-22T09:00:00+09:00" }).length).toBeGreaterThan(0);
  });
  it("demo mode：デモ用DBだけ動き、一般向けDB・元アプリDBは拒否する", () => {
    for (const ep of DEMO_DB_ENDPOINTS) {
      expect(appMode({ APP_MODE: "demo", DATABASE_URL: url(ep, true), DATABASE_URL_UNPOOLED: url(ep), DEMO_NOW: "2026-10-22T09:00:00+09:00" })).toBe("demo");
    }
    expect(appEnvironmentProblems({ APP_MODE: "demo", ...generalDb }).length).toBeGreaterThan(0);
    expect(appEnvironmentProblems({ APP_MODE: "demo", DATABASE_URL: url(ORIGINAL_DB_ENDPOINTS[0], true) }).length).toBeGreaterThan(0);
  });
  it("読めない接続先は止め、問題の文言に接続情報を含めない", () => {
    const problems = appEnvironmentProblems({ APP_MODE: "general", DATABASE_URL: "postgresql://user:secret@" });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join()).not.toContain("secret");
  });
});

describe("一般ユーザー向けの開発DBの確認（migration・seed 用）", () => {
  it("GENERAL_DB_ENDPOINT と完全一致する開発DBだけ許可する", () => {
    expect(() => assertGeneralDevDatabase(generalDb)).not.toThrow();
    expect(() => assertGeneralDevDatabase({ ...generalDb, GENERAL_DB_ENDPOINT: undefined })).toThrow();
    expect(() => assertGeneralDevDatabase({ ...generalDb, GENERAL_DB_ENDPOINT: "ep-other" })).toThrow();
    expect(() => assertGeneralDevDatabase({ ...generalDb, DATABASE_URL_UNPOOLED: url("ep-other") })).toThrow();
  });
  it("デモ用・元アプリの DB は GENERAL_DB_ENDPOINT に書いても拒否する", () => {
    for (const ep of [...DEMO_DB_ENDPOINTS, ...ORIGINAL_DB_ENDPOINTS]) {
      expect(() => assertGeneralDevDatabase({ DATABASE_URL: url(ep, true), DATABASE_URL_UNPOOLED: url(ep), GENERAL_DB_ENDPOINT: ep })).toThrow();
    }
  });
  it("Vercel 上・DEMO_NOW あり・pooled/direct の取り違えは拒否する", () => {
    expect(() => assertGeneralDevDatabase({ ...generalDb, VERCEL: "1" })).toThrow();
    expect(() => assertGeneralDevDatabase({ ...generalDb, VERCEL_ENV: "production" })).toThrow();
    expect(() => assertGeneralDevDatabase({ ...generalDb, DEMO_NOW: "2026-10-22T09:00:00+09:00" })).toThrow();
    expect(() => assertGeneralDevDatabase({ ...generalDb, DATABASE_URL: url(GENERAL_EP) })).toThrow();
    expect(() => assertGeneralDevDatabase({ ...generalDb, DATABASE_URL_UNPOOLED: url(GENERAL_EP, true) })).toThrow();
  });
});

describe("デモ専用の操作（reset-demo・デモ seed）は general では動かない", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("AIC_LOCAL_ENV=general または APP_MODE=general なら、ファイルを読む前に拒否する", async () => {
    const { loadApprovalEnvironment } = await import("./local-env");
    vi.stubEnv("AIC_LOCAL_ENV", "general");
    expect(() => loadApprovalEnvironment()).toThrow(/demo 環境専用/);
    vi.stubEnv("AIC_LOCAL_ENV", "");
    vi.stubEnv("APP_MODE", "general");
    expect(() => loadApprovalEnvironment()).toThrow(/demo 環境専用/);
  });
  it("Vercel 上では一般向けの開発用設定も読まない", async () => {
    const { loadGeneralEnvironment } = await import("./local-env");
    vi.stubEnv("VERCEL", "1");
    expect(() => loadGeneralEnvironment()).toThrow(/Vercel/);
  });
});
