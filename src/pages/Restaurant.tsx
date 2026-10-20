import { useCallback, useEffect, useRef, useState } from "react";
import type { Me } from "../App";
import { Icon } from "../components/Icon";
import { EMPTY_FORM, formFromDraft, formFromRequest, toPlanBody, type RequestForm } from "../lib/request-form.js";
import type { DraftField } from "../lib/resolve.js";
import type { Suggestion } from "../lib/suggest.js";
import { PlanView } from "./restaurant/PlanView";
import { StepConfirm } from "./restaurant/StepConfirm";
import { StepInput } from "./restaurant/StepInput";
import { WishListCard, WishSwitch, wishItem } from "./restaurant/WishList";
import { loadWishList, newWish, saveWishList, type Wish, type WishList } from "../lib/wishlist.js";
import type { CatalogData, ExtractResult, Freshness, PlanOption, Shown, Step } from "./restaurant/types";
import { useSession } from "../routes/session";

// 飲食店の仕入れ案：STEP 1 希望を入力 → STEP 2 条件を確認 → STEP 3 仕入れ案を見る。
// AI は STEP 1→2 で条件の候補を読み取るだけ。計算は確定した条件で /api/plan（通常ロジック）が行う。

type Saved = { step: Step; text: string; form: RequestForm; shown: Shown | null };

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
  for (const k of ["allowFirstTime", "allowIrregular", "allowMixedVarieties", "allowMixedGrades"] as const) if (form[k]) out.push(k);
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [emptyHint, setEmptyHint] = useState(false);
  const [restored, setRestored] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const extractAbort = useRef<AbortController | null>(null);
  // 受け取り場所を「おまかせ」にしたときの、希望日に受け取れる場所ごとの案（おすすめ順）。表示中の案はその中の1つ
  const [planOptions, setPlanOptions] = useState<PlanOption[] | null>(null);
  const autoSlot = useSession().appMode === "general"; // 「おまかせ」は一般向けの環境だけ
  // 「欲しい食材」の一覧（一般向けの環境だけ・ブラウザに保存）。null は読み込み前
  const wishOn = autoSlot;
  const [wishes, setWishes] = useState<WishList | null>(null);

  useEffect(() => {
    const saved = load(me.id);
    if (saved) {
      setText(saved.text ?? "");
      setForm({ ...EMPTY_FORM, ...saved.form });
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
    if (restored) save(me.id, { step, text, form, shown });
  }, [step, text, form, shown, restored, me.id]);

  // 一覧がまだない（今までの保存データ・初めて）：入力中の品目があればそれを1行目にする。なければ空の1行
  useEffect(() => {
    if (!wishOn || !restored || !catalog || wishes) return;
    const item = catalog.items.find((i) => i.id === form.itemId);
    const first = item ? newWish(item.name, form.quantityKg) : newWish();
    setWishes({ rows: [first], active: item && step !== "input" ? first.id : null });
  }, [wishOn, restored, catalog, wishes, form, step]);

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
      setWishes((l) => l && { ...l, active: null });
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
    setWishes((l) => l && { ...l, active: null });
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
      setError("この日に受け取れる出品が見つかりませんでした。日付や品目を変えてお試しください");
      setBusy(false);
      return;
    }
    setPlanOptions(options);
    await requestPlan({ ...body, slotId: options[0].slotId });
  }

  /** 結果画面の「ほかの受け取り方」から、別の場所の案を既存の /api/plan で計算する */
  function pickOption(slotId: string) {
    if (!shown) return;
    void requestPlan({ ...shown.request, slotId });
  }

  /** 結果 → 条件確認（自動で条件を変えない。候補を選んだ場合もフォームに反映するだけ） */
  function editConditions(s?: Suggestion) {
    if (!shown) return setStep("confirm");
    // 「おまかせ」で選んだ場所なら、条件を変えたあとも「おまかせ」のまま探し直す
    const base = { ...formFromRequest(shown.request), ...(planOptions && { slotId: "" }) };
    const c = s?.change ?? {};
    setForm({
      ...base,
      ...(c.allowFirstTime !== undefined && { allowFirstTime: c.allowFirstTime ? "yes" : "no" }),
      ...(c.allowIrregular !== undefined && { allowIrregular: c.allowIrregular ? "yes" : "no" }),
      ...(c.allowMixedVarieties !== undefined && { allowMixedVarieties: c.allowMixedVarieties ? "yes" : "no" }),
      ...(c.allowMixedGrades !== undefined && { allowMixedGrades: c.allowMixedGrades ? "yes" : "no" }),
      ...(c.quantityKg !== undefined && { quantityKg: String(c.quantityKg) }),
    });
    setExtraction(null);
    setAiFields([]);
    setNotice(s ? `「${s.label}」を反映しました。内容を確認して「この条件で仕入れ案を見る」を押してください。` : null);
    setStep("confirm");
    top();
  }

  /**
   * 一覧の1行から、その品目の今までの流れ（条件の確認 → 仕入れ案）へ進む。品目をまとめた計算はしない。
   * 同じ品目なら確認中の条件をそのまま使う。違う品目なら品目・必要量を入れ替え、品種と予算は選び直してもらう（受け取り日・産地などは引き継ぐ）
   */
  function openWish(w: Wish) {
    if (!catalog || !wishes) return;
    const item = wishItem(w, catalog.items);
    if (!item) return;
    const kg = w.kg.trim();
    setForm(form.itemId === item.id
      ? { ...form, quantityKg: kg || form.quantityKg }
      : { ...form, itemId: item.id, varietyId: "", quantityKg: kg, budgetMode: "", budgetYen: "" });
    setWishes({ ...wishes, active: w.id });
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

      {wishOn && wishes && catalog && step !== "input" && (
        <WishSwitch list={wishes} items={catalog.items} currentItemId={step === "result" && shown ? shown.request.itemId : form.itemId}
          onOpen={openWish} onList={() => { setError(null); setStep("input"); top(); }} />
      )}

      {catalogError && <div className="alert bad" role="alert"><Icon name="alert" />登録データを読み込めませんでした。再読み込みしてください。</div>}

      {step === "input" && (
        <StepInput text={text} onText={(t) => { setText(t); setEmptyHint(false); }} onExtract={extract} onManual={manual} busy={extracting}
          aiAvailable={catalog ? catalog.aiAvailable : null} error={error} emptyHint={emptyHint}>
          {wishOn && wishes && <WishListCard list={wishes} items={catalog?.items ?? null} onChange={setWishes} onOpen={openWish} />}
        </StepInput>
      )}

      {step === "confirm" && catalog && (
        <StepConfirm key={wishes?.active ?? ""} form={form} setForm={setForm} catalog={catalog} extraction={extraction} sourceText={text} aiFields={aiFields}
          busy={busy} error={error} notice={notice} onSubmit={submitConditions} onBack={() => { setError(null); setStep("input"); top(); }} />
      )}

      {step === "result" && shown && (
        <PlanView shown={shown} freshness={freshness} busy={busy} busyLabel={busyLabel} error={error}
          onRecalc={() => requestPlan(shown.request)} onEdit={() => editConditions()} onSuggestion={editConditions}
          options={planOptions} onPickOption={pickOption} />
      )}
    </main>
  );
}
