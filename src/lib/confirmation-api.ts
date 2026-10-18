// 画面から API を呼ぶ共通の関数。失敗は、利用者が次に何をすればよいか分かる日本語の文だけを ApiError で返す
// （通信の失敗・JSON でない応答・HTTP の番号・内部のエラー名をそのまま画面に出さない）。
// ログインの有効期限が切れていた（401）ときは "aic:unauthorized" を知らせ、ログイン状態を確認し直す（routes/session.tsx）。
// Keep credentials and contact details out of browser storage.

export const ERROR_TEXT = {
  network: "通信できませんでした。電波の状態を確認して、もう一度お試しください",
  server: "サーバーで問題が発生しました。時間をおいて、もう一度お試しください",
  unauthorized: "ログインの有効期限が切れました。もう一度ログインしてください",
  other: "処理できませんでした。内容を確認して、もう一度お試しください",
} as const;

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly data: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
  }
}

export async function confirmationApi<T>(url: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method, cache: "no-store", signal,
      ...(body !== undefined && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new ApiError(ERROR_TEXT.network, 0);
  }
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (response.ok && data) return data as T;
  if (response.status === 401) {
    window.dispatchEvent(new Event("aic:unauthorized"));
    throw new ApiError(ERROR_TEXT.unauthorized, 401, data ?? {});
  }
  // 500 番台はサーバー側の問題として共通の文にする。それ以外はサーバーが返した日本語の説明（なければ共通の文）
  if (response.status >= 500) throw new ApiError(ERROR_TEXT.server, response.status, data ?? {});
  const serverText = typeof data?.error === "string" && data.error ? data.error : null;
  throw new ApiError(serverText ?? ERROR_TEXT.other, response.status, data ?? {});
}

/** 画面に出してよい文だけを返す（ApiError の文。それ以外の例外は fallback） */
export const friendlyError = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
