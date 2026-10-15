import { afterEach, describe, expect, it } from "vitest";
import { requireEditPassphrase } from "./auth.js";

const req = (pass?: string) =>
  new Request("http://localhost/api/listings", {
    method: "POST",
    headers: pass === undefined ? {} : { "x-edit-passphrase": encodeURIComponent(pass) },
  });

describe("編集用合言葉の検証", () => {
  const original = process.env.EDIT_PASSPHRASE;
  afterEach(() => {
    if (original === undefined) delete process.env.EDIT_PASSPHRASE;
    else process.env.EDIT_PASSPHRASE = original;
  });

  it("サーバーに合言葉が設定されていなければ、編集はすべて拒否する", () => {
    delete process.env.EDIT_PASSPHRASE;
    expect(requireEditPassphrase(req("なんでも"))?.status).toBe(503);
  });

  it("合言葉がない・違うときは 401 で拒否する", async () => {
    process.env.EDIT_PASSPHRASE = "テスト用の合言葉";
    expect(requireEditPassphrase(req())?.status).toBe(401);
    expect(requireEditPassphrase(req("ちがう"))?.status).toBe(401);
    expect(requireEditPassphrase(req(""))?.status).toBe(401);
  });

  it("一致したときだけ許可する（日本語も可）", () => {
    process.env.EDIT_PASSPHRASE = "テスト用の合言葉";
    expect(requireEditPassphrase(req("テスト用の合言葉"))).toBeNull();
  });
});
