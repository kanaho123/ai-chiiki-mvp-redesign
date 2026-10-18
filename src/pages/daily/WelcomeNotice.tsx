import { useEffect, useState } from "react";
import { Icon } from "../../components/Icon";
import { WELCOME_KEY } from "../onboarding/parts";

/** 初回登録を終えた直後に1回だけ出すお知らせ */
export function WelcomeNotice({ role, text }: { role: "restaurant" | "producer"; text: string }) {
  const [show] = useState(() => { try { return sessionStorage.getItem(WELCOME_KEY) === role; } catch { return false; } });
  useEffect(() => { try { sessionStorage.removeItem(WELCOME_KEY); } catch {} }, []);
  if (!show) return null;
  return <div className="alert ok" role="status"><Icon name="check" /><div><b>登録が完了しました</b><br />{text}</div></div>;
}
