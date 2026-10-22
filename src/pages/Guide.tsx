import { useNavigate } from "react-router";
import { GUIDE_KEY } from "../routes/guards";
import { homeOf } from "../routes/paths";
import type { Role } from "../routes/session";
import { SlideGuide, type Slide } from "./Onboarding";

// 新規登録（初回登録）を終えた直後に1回だけ出す、役割ごとの簡単な使い方（3枚）。見終わったらホームへ。
// ログイン済みのユーザーはここを通らない（ガードが直接ホームへ案内する）。書くのは今できることだけ。

const GUIDES: Record<Role, Slide[]> = {
  restaurant: [
    { title: ["欲しい食材を、", "話すか書くだけ"], icon: "chat", tone: "green",
      text: "「トマトを10kg、10月27日に」のように入力します。AIが品目・量・日付を整理します。" },
    { title: ["近くの農家を", "組み合わせます"], icon: "basket", tone: "green",
      text: "1軒では足りない量も、複数の農家の分を合わせて1つの仕入れ案にします。受け取りは1か所です。" },
    { title: ["農家に相談して", "決めます"], icon: "clipboard", tone: "green",
      text: "仕入れ案から農家に仕入れ相談をします。まだ注文ではありません。農家の返事がそろうと、やり取りできます。" },
  ],
  producer: [
    { title: ["写真か声で、", "出品できます"], icon: "camera", tone: "orange",
      text: "野菜の写真を撮るか、話すだけ。AIが品目や量を下書きします。内容を確かめてから出品します。" },
    { title: ["飲食店から", "相談が届きます"], icon: "clipboard", tone: "orange",
      text: "届いた相談はホームに出ます。「対応できます」か「今回は対応できません」で返事をします。" },
    { title: ["受け渡しは、", "いつもの場所で"], icon: "pin", tone: "orange",
      text: "普段の出荷先など、いつもの場所で渡せます。はじめて出品するときに一度だけ登録します。" },
  ],
};

export default function Guide({ role }: { role: Role }) {
  const navigate = useNavigate();
  const done = () => {
    try { sessionStorage.removeItem(GUIDE_KEY); } catch {}
    navigate(homeOf(role), { replace: true });
  };
  return <div className={`role-${role}`}><SlideGuide slides={GUIDES[role]} doneLabel="ホームへ" onDone={done} /></div>;
}
