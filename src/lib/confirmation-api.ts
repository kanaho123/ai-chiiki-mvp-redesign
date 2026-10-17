/** Keep credentials and contact details out of browser storage. */
export async function confirmationApi<T>(url: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method, cache: "no-store", signal,
    ...(body !== undefined && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "処理できませんでした。再読み込みしてください");
  return data;
}
