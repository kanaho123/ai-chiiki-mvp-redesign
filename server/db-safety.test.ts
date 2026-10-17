import { describe, expect, it } from "vitest";
import { assertApprovalDatabase, assertDemoDatabase, demoDbProblems, describeDb, endpointOf, APPROVAL_DB_ENDPOINT, PROTECTED_DB_ENDPOINTS } from "./db-safety";

const url = (ep: string, pooler = false) =>
  `postgresql://user:secret@${ep}${pooler ? "-pooler" : ""}.c-13.us-east-1.aws.neon.tech/neondb?sslmode=require`;
const demo = {
  DATABASE_URL: url("ep-demo-branch", true),
  DATABASE_URL_UNPOOLED: url("ep-demo-branch"),
  DEMO_DB_ENDPOINT: "ep-demo-branch",
};

describe("デモ用 DB の安全確認", () => {
  it("approval-dev だけを許可し、本番・片方だけ本番・環境変数の偽装・不明なホストを拒否する", () => {
    const dev = { DATABASE_URL: url(APPROVAL_DB_ENDPOINT, true), DATABASE_URL_UNPOOLED: url(APPROVAL_DB_ENDPOINT), DEMO_DB_ENDPOINT: APPROVAL_DB_ENDPOINT };
    expect(() => assertApprovalDatabase(dev)).not.toThrow();
    for (const ep of PROTECTED_DB_ENDPOINTS) {
      expect(() => assertApprovalDatabase({ DATABASE_URL: url(ep, true), DATABASE_URL_UNPOOLED: url(ep), DEMO_DB_ENDPOINT: ep })).toThrow();
      expect(() => assertApprovalDatabase({ ...dev, DATABASE_URL_UNPOOLED: url(ep) })).toThrow();
    }
    expect(() => assertApprovalDatabase(demo)).toThrow();
    expect(() => assertApprovalDatabase({ ...dev, VERCEL_ENV: "production" })).toThrow();
    expect(() => assertApprovalDatabase({ ...dev, DATABASE_URL: dev.DATABASE_URL.replace("aws.neon.tech", "example.com") })).toThrow();
    expect(() => assertApprovalDatabase({ ...dev, DATABASE_URL_UNPOOLED: url(APPROVAL_DB_ENDPOINT, true) })).toThrow();
    expect(() => assertApprovalDatabase({ ...dev, DATABASE_URL: url(APPROVAL_DB_ENDPOINT) })).toThrow();
  });
  it("エンドポイント ID は -pooler を除いて取り出す", () => {
    expect(endpointOf(url("ep-abc", true))).toBe("ep-abc");
    expect(endpointOf(undefined)).toBeNull();
    expect(endpointOf("壊れた値")).toBeNull();
  });

  it("説明文にパスワードを含めない", () => {
    expect(describeDb(demo.DATABASE_URL)).not.toContain("secret");
  });

  it("許可されたデモ用 DB なら通る", () => {
    expect(demoDbProblems(demo)).toEqual([]);
    expect(() => assertDemoDatabase(demo)).not.toThrow();
  });

  it("元アプリの DB は DEMO_DB_ENDPOINT に書いても拒否する", () => {
    const ep = "ep-hidden-union-b7n46jco";
    const original = { DATABASE_URL: url(ep, true), DATABASE_URL_UNPOOLED: url(ep), DEMO_DB_ENDPOINT: ep };
    expect(() => assertDemoDatabase(original)).toThrow(/元アプリ/);
  });

  it("DEMO_DB_ENDPOINT が無い・一致しない・接続先がずれている・本番環境なら拒否する", () => {
    expect(demoDbProblems({ ...demo, DEMO_DB_ENDPOINT: undefined })).not.toEqual([]);
    expect(demoDbProblems({ ...demo, DEMO_DB_ENDPOINT: "ep-other" })).not.toEqual([]);
    expect(demoDbProblems({ ...demo, DATABASE_URL_UNPOOLED: url("ep-other") })).not.toEqual([]);
    expect(demoDbProblems({ ...demo, VERCEL_ENV: "production" })).not.toEqual([]);
    expect(demoDbProblems({})).not.toEqual([]);
  });
});
