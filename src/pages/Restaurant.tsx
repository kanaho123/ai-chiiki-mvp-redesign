import { useCallback, useEffect, useRef, useState } from "react";
import type { Me } from "../App";
import { Icon } from "../components/Icon";
import { jstDateOf } from "../lib/dates.js";
import { EMPTY_FORM, formFromDraft, formFromRequest, toPlanBody, type RequestForm } from "../lib/request-form.js";
import type { DraftField } from "../lib/resolve.js";
import type { Suggestion } from "../lib/suggest.js";
import { PlanView } from "./restaurant/PlanView";
import { StepConfirm } from "./restaurant/StepConfirm";
import { StepInput } from "./restaurant/StepInput";
import { WishSwitch, wishItem } from "./restaurant/WishList";
import { activateFirst, loadWishList, newWish, saveWishList, type Wish, type WishList } from "../lib/wishlist.js";
import type { CatalogData, ExtractResult, Freshness, PlanOption, Shown, Step } from "./restaurant/types";
import { useSession } from "../routes/session";

// 飲食店の仕入れ案：STEP 1 希望を入力 → STEP 2 条件を確認 → STEP 3 仕入れ案を見る。
// AI は STEP 1→2 で条件の候補を読み取るだけ。計算は確定した条件で /api/plan（通常ロジック）が行う。

type Saved = { step: Step; text: string; form: RequestForm; shown: Shown | null; itemText?: string };

// 画面の状態は店（ログインユーザー）ごとに保持する。保存した案は「保存済みプラン」ではなく、再表示時は必ず最新か確認する
const storageKey = (userId: string) => `ai-chiiki:restaurant:v4:${userId}`;

function load(userId: string): Saved | null {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function save(userId: string, s: Saved) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(s));
  } catch {}
}

/** AI の読み取り結果から確認画面に入った項目（「AIが読み取り」の目印用） */
function aiFilledFields(form: RequestForm): DraftField[] {
  const out: DraftField[] = [];
  if (form.itemId) out.push("itemId");
  if (form.varietyId) out.push("varietyId");
  if (form.quantityKg) out.push("quantityKg");
  if (form.desiredDate) out.push("desiredDate");
  if (form.budgetMode) out.push("budget");
  if (form.originPrefectures.length) out.push("originPrefectures");
  if (form.slotId) out.push("slotId");
  for (const k of ["allowFirstTime", "allowIrregular"] as const) if (form[k]) out.push(k);
  if (form.preferredProducerId) out.push("preferredProducerId");
  return out;
}

export default function RestaurantPage({ me }: { me: Me }) {
  const [step, setStep] = useState<Step>("input");
  const [text, setText] = useState("");
  const [form, setForm] = useState<RequestForm>(EMPTY_FORM);
  const [extraction, setExtraction] = useState<ExtractResult | null>(null);
  const [aiFields, setAiFields] = useState<DraftField[]>([]);
  const [shown, setShown] = useState<Shown | null>(null);
  const [freshness, setFreshness] = useState<Freshness>("checking");
  const [catalog, setCatalog] = useState<CatalogData | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  // 読み取り（AI）の完了時点の登録データを使う（押した時点ではまだ読み込み中のことがある）
  const catalogRef = useRef<CatalogData | null>(null);
  catalogRef.current = catalog;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [emptyHint, setEmptyHint] = useState(false);
  const [restored, setRestored] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const extractAbort = useRef<AbortController | null>(null);
  // 受け取り場所を「おまかせ」にしたときの、希望日に受け取れる場所ごとの案（おすすめ順）。表示中の案はその中の1つ
  const [planOptions, setPlanOptions] = useState<PlanOption[] | null>(null);
  // 「おまかせ」で受け取り日も決めずに探したか（ほかの受け取り方を選ぶとき・条件に戻るときに使う）
  const [openDate, setOpenDate] = useState(false);
  const autoSlot = useSession().appMode === "general"; // 「おまかせ」は一般向けの環境だけ
  // 「欲しい食材」の一覧（一般向けの環境だけ・ブラウザに保存）。null は読み込み前
  const wishOn = autoSlot;
  const [wishes, setWishes] = useState<WishList | null>(null);
  // 文章から読み取った品目名で、登録された品目に一致しなかったもの（確認の画面の品目欄に残す・一般向けの環境だけ）
  const [itemText, setItemText] = useState("");

  useEffect(() => {
    const saved = load(me.id);
    if (saved) {
      setText(saved.text ?? "");
      setForm({ ...EMPTY_FORM, ...saved.form });
      setItemText(typeof saved.itemText === "string" ? saved.itemText.slice(0, 40) : "");
      setShown(saved.shown);
      setStep(saved.shown && saved.step === "result" ? "result" : saved.step === "confirm" ? "confirm" : "input");
      setFreshness("checking"); // 保存していた案は、最新の版と照合できるまで有効扱いしない
    }
    setWishes(wishOn ? loadWishList(me.id) : null);
    setRestored(true);
    fetch("/api/catalog", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setCatalog)
      .catch(() => setCatalogError(true));
  }, [me.id]);

  useEffect(() => {
    if (restored) save(me.id, { step, text, form, shown, itemText });
  }, [step, text, form, shown, itemText, restored, me.id]);

  // 一覧がまだない（今までの保存データ・初めて）：入力中の品目があればそれを1行目（いま確認する食材）にする。なければ空の1行
  useEffect(() => {
    if (!wishOn || !restored || !catalog || wishes) return;
    const item = catalog.items.find((i) => i.id === form.itemId);
    const first = item ? newWish(item.name, form.quantityKg) : newWish(itemText);
    setWishes({ rows: [first], active: first.id });
  }, [wishOn, restored, catalog, wishes, form, itemText]);

  // 「欲しい食材」の1行目（いま確認する食材）の名前が空のままなら、フォームの品目で埋める（登録データの読み込みより先に読み取りが終わった場合など）
  useEffect(() => {
    if (!wishOn || !catalog || step !== "confirm") return;
    const name = catalog.items.find((i) => i.id === form.itemId)?.name;
    if (!name) return;
    setWishes((l) => {
      const a = l?.rows.find((w) => w.id === l.active);
      return l && a && !a.name.trim() ? { ...l, rows: l.rows.map((w) => (w.id === a.id ? { ...w, name, kg: w.kg || form.quantityKg } : w)) } : l;
    });
  }, [wishOn, catalog, step, form.itemId, form.quantityKg]);

  useEffect(() => {
    if (wishOn && wishes) saveWishList(me.id, wishes);
  }, [wishOn, wishes, me.id]);

  // 表示中の案の計算後に供給・枠などが変わったら、その案を無効にする。
  // 結果画面を開いた（戻った）とき・タブに戻ったときに確認する（常時の通信はしない）
  const checkVersion = useCallback(async () => {
    if (!shown) return;
    try {
      const q = new URLSearchParams({ itemId: shown.request.itemId, slotId: shown.request.slotId });
      const r = await fetch(`/api/inventory-version?${q}`, { cache: "no-store" });
      if (!r.ok) return setFreshness("stale");
      const { version } = await r.json();
      setFreshness(version === shown.version ? "fresh" : "stale");
    } catch {
      setFreshness("stale");
    }
  }, [shown]);

  useEffect(() => {
    if (!shown || step !== "result") return;
    checkVersion();
    const onFocus = () => document.visibilityState === "visible" && checkVersion();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [shown, step, checkVersion]);

  const top = () => setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 0);

  /** STEP 1 → 2：AI で条件の候補を読み取る。失敗しても文章は残し、手入力へ切り替えられる */
  async function extract() {
    setError(null);
    if (!text.trim()) {
      setEmptyHint(true); // 空欄なら AI を呼ばない
      return;
    }
    setEmptyHint(false);
    if (extractAbort.current) return; // 読み取り中の多重送信はしない
    const controller = new AbortController();
    extractAbort.current = controller;
    setExtracting(true);
    try {
      const r = await fetch("/api/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: controller.signal });
      const d = await r.json().catch(() => ({}));
      if (controller.signal.aborted) return; // 手入力に切り替えた後の結果は使わない
      if (!r.ok) {
        setError(d.error ?? "AIで条件を読み取れませんでした。入力内容を残したまま手入力できます。");
        return;
      }
      const next = formFromDraft(d.draft);
      const typed = wishOn && !next.itemId && typeof d.extracted?.itemText === "string" ? d.extracted.itemText : "";
      setItemText(typed);
      // 読み取った食材を「欲しい食材」の1行目（いま確認する食材）にする。同じ食材の行があればその行を使う
      const name = catalogRef.current?.items.find((i) => i.id === next.itemId)?.name ?? typed;
      setWishes((l) => l && activateFirst(l, name, next.quantityKg));
      setExtraction(d);
      setForm(next);
      setAiFields(aiFilledFields(next));
      setNotice(null);
      setStep("confirm");
      top();
    } catch {
      // 「待たずに手入力する」で中断した場合はエラーを出さない
      if (!controller.signal.aborted) setError("AIで条件を読み取れませんでした。入力内容を残したまま手入力できます。");
    } finally {
      extractAbort.current = null;
      setExtracting(false);
    }
  }

  function manual() {
    extractAbort.current?.abort(); // 読み取り中なら中断し、後から結果で上書きしない
    // いま確認する食材の行があればそのまま。なければ入力中の品目（なければ空の行）を1行目にする
    const current = wishes?.rows.find((w) => w.id === wishes.active);
    if (wishOn && wishes && !current) setWishes(activateFirst(wishes, catalog?.items.find((i) => i.id === form.itemId)?.name ?? "", form.quantityKg));
    setItemText(wishOn && current && catalog && !wishItem(current, catalog.items) ? current.name : "");
    setExtraction(null);
    setAiFields([]);
    setError(null);
    setNotice(null);
    setStep("confirm");
    top();
  }

  /** STEP 2 → 3：確認・修正したフォームの値だけを /api/plan へ送る */
  async function requestPlan(body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error ?? "条件を読み取れません");
        return;
      }
      setShown(d);
      setFreshness("fresh");
      setStep("result");
      top();
    } catch {
      setError("通信に失敗しました。もう一度お試しください");
    } finally {
      setBusy(false);
    }
  }

  /**
   * STEP 2 → 3：受け取り場所を選んでいれば、そのまま /api/plan。
   * 「おまかせ」なら、まず希望日に受け取れる場所ごとの案を /api/plan-options で並べ、いちばん上の場所で既存の /api/plan を計算する
   */
  async function submitConditions() {
    const body = toPlanBody(form);
    if (form.slotId || !autoSlot) {
      setPlanOptions(null);
      return requestPlan(body);
    }
    setBusy(true);
    setError(null);
    let options: PlanOption[] = [];
    try {
      const r = await fetch("/api/plan-options", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error ?? "条件を読み取れません");
        setBusy(false);
        return;
      }
      options = d.options ?? [];
    } catch {
      setError("通信に失敗しました。もう一度お試しください");
      setBusy(false);
      return;
    }
    if (options.length === 0) {
      setError(form.desiredDate ? "この日に受け取れる出品が見つかりませんでした。日付や品目を変えてお試しください" : "受け取れる出品が見つかりませんでした。品目や数量を変えてお試しください");
      setBusy(false);
      return;
    }
    setPlanOptions(options);
    setOpenDate(!form.desiredDate);
    // 受け取り日が未定なら、選んだ案の受け取りの日で計算する（計算の規則は同じ）
    await requestPlan({ ...body, slotId: options[0].slotId, desiredDate: form.desiredDate || jstDateOf(options[0].startAt) });
  }

  /** 結果画面の「ほかの受け取り方」から、別の場所（受け取り日が未定なら別の日も）の案を既存の /api/plan で計算する */
  function pickOption(slotId: string) {
    if (!shown) return;
    const o = planOptions?.find((x) => x.slotId === slotId);
    void requestPlan({ ...shown.request, slotId, ...(openDate && o && { desiredDate: jstDateOf(o.startAt) }) });
  }

  /** 結果 → 条件確認（自動で条件を変えない。候補を選んだ場合もフォームに反映するだけ） */
  function editConditions(s?: Suggestion) {
    if (!shown) return setStep("confirm");
    // 「おまかせ」で選んだ場所なら、条件を変えたあとも「おまかせ」のまま探し直す
    // 受け取り日を決めていなかったなら、未定のまま戻す
    const base = { ...formFromRequest(shown.request), ...(planOptions && { slotId: "", ...(openDate && { desiredDate: "" }) }) };
    const c = s?.change ?? {};
    setForm({
      ...base,
      ...(c.allowFirstTime !== undefined && { allowFirstTime: c.allowFirstTime ? "yes" : "no" }),
      ...(c.allowIrregular !== undefined && { allowIrregular: c.allowIrregular ? "yes" : "no" }),
      ...(c.quantityKg !== undefined && { quantityKg: String(c.quantityKg) }),
    });
    setExtraction(null);
    setAiFields([]);
    setItemText("");
    setNotice(s ? `「${s.label}」を反映しました。内容を確認して${autoSlot ? "、下のボタンから仕入れ案を見てください" : "「この条件で仕入れ案を見る」を押してください"}。` : null);
    setStep("confirm");
    top();
  }

  /**
   * 一覧のほかの食材を、いま確認する食材にして条件の確認へ進む（仕入れ案は1品目ずつ。品目をまとめた計算はしない）。
   * 同じ品目なら確認中の条件をそのまま使う。違う品目なら品目・必要量を入れ替え、品種と予算は選び直してもらう（受け取り日・産地などは引き継ぐ）。
   * 登録された品目に一致しない名前は品目欄に残す（近い食材の候補はその場で出る）
   */
  function openWish(w: Wish) {
    if (!catalog || !wishes) return;
    const item = wishItem(w, catalog.items);
    const kg = w.kg.trim();
    setForm(item && form.itemId === item.id
      ? { ...form, quantityKg: kg || form.quantityKg }
      : { ...form, itemId: item?.id ?? "", varietyId: "", quantityKg: kg, budgetMode: "", budgetYen: "" });
    setWishes((l) => l && { ...l, active: w.id });
    setItemText(item ? "" : w.name.trim());
    setPlanOptions(null);
    setExtraction(null);
    setAiFields([]);
    setError(null);
    setNotice(null);
    setStep("confirm");
    top();
  }

  const busyLabel = <><span className="spinner" aria-hidden="true" />計算中…</>;

  const stepIndex = ["input", "confirm", "result"].indexOf(step);
  const stepName = ["希望を入力", "内容を確認", "仕入れ案"][stepIndex];
  const loading = step === "input" && extracting;

  return (
    <main className={`screen ${loading ? "" : "has-bar"}`}>
      {/* 進行状況：「1/3 希望を入力」と3本の短い線 */}
      {!loading && (
        <div className="flow-progress" aria-label={`進行状況 ${stepIndex + 1}/3 ${stepName}`}>
          <span className="flow-count">{stepIndex + 1}/3</span>
          <span className="flow-name">{stepName}</span>
          <span className="flow-segs" aria-hidden="true">{[0, 1, 2].map((k) => <i key={k} className={k <= stepIndex ? "on" : ""} />)}</span>
        </div>
      )}

      {/* 仕入れ案の画面：一覧のほかの食材へ切り替える（「一覧」で確認の画面の「欲しい食材」へ） */}
      {wishOn && wishes && catalog && step === "result" && shown && (
        <WishSwitch list={wishes} items={catalog.items} currentItemId={shown.request.itemId}
          onOpen={openWish} onList={() => editConditions()} />
      )}

      {catalogError && <div className="alert bad" role="alert"><Icon name="alert" />登録データを読み込めませんでした。再読み込みしてください。</div>}

      {step === "input" && (
        <StepInput text={text} onText={(t) => { setText(t); setEmptyHint(false); }} onExtract={extract} onManual={manual} busy={extracting}
          aiAvailable={catalog ? catalog.aiAvailable : null} error={error} emptyHint={emptyHint} general={wishOn} />
      )}

      {step === "confirm" && catalog && (
        <StepConfirm key={wishes?.active ?? ""} form={form} setForm={setForm} catalog={catalog} extraction={extraction} sourceText={text} initialItemText={itemText} aiFields={aiFields}
          busy={busy} error={error} notice={notice} onSubmit={submitConditions} onBack={() => { setError(null); setStep("input"); top(); }}
          wishes={wishOn ? wishes : null} onWishes={setWishes} onPickWish={openWish}
          onActiveWish={(patch) => setWishes((l) => l && { ...l, rows: l.rows.map((w) => (w.id === l.active ? { ...w, ...patch } : w)) })} />
      )}

      {step === "result" && shown && (
        <PlanView shown={shown} freshness={freshness} busy={busy} busyLabel={busyLabel} error={error}
          onRecalc={() => requestPlan(shown.request)} onEdit={() => editConditions()} onSuggestion={editConditions}
          options={planOptions} onPickOption={pickOption} />
      )}
    </main>
  );
}
