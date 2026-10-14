import type { ReactNode } from "react";

/**
 * 入力欄のラベル。必須／任意のバッジは見た目だけで、読み上げる名前には含めない
 * （必須かどうかは入力欄の aria-required で伝える）。
 */
export function Label({ children, required = false }: { children: ReactNode; required?: boolean }) {
  return (
    <span className="label">
      {children}
      <span className={required ? "req" : "opt"} aria-hidden="true">
        {required ? "必須" : "任意"}
      </span>
    </span>
  );
}
