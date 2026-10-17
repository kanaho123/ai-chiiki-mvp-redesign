import { useLayoutEffect, useRef } from "react";

/**
 * 画面下部に固定する主ボタンの領域。実際の高さを --bar-h として測り、本文側の下余白に使う
 * （注意文の行数や画面幅で高さが変わっても、本文の最後が固定領域の下に隠れないようにする）。
 */
export function BottomBar({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const update = () => root.style.setProperty("--bar-h", `${Math.ceil(el.getBoundingClientRect().height)}px`);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--bar-h");
    };
  }, []);
  return (
    <div ref={ref} className={`bottom-bar ${className}`}>
      <div className="bottom-bar-inner">{children}</div>
    </div>
  );
}
