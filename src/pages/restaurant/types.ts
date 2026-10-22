import type { PlanRequest, PlanResult } from "../../lib/allocate.js";
import type { Candidate, DraftField, ResolveNotice } from "../../lib/resolve.js";
import type { Suggestion } from "../../lib/suggest.js";
import type { ExtractedRequest } from "../../lib/validate.js";

/** GET /api/catalog */
export type CatalogData = {
  now: string;
  demoClock: boolean;
  aiAvailable: boolean;
  items: { id: string; name: string; varieties: { id: string; name: string }[] }[];
  slots: { id: string; label: string; placeName: string; startAt: string; endAt: string; confirmDeadlineAt: string; feeYen: number; feeConfirmed: boolean; maxKg: number }[];
  prefectures: string[];
  nearbyPrefectures: string[];
  priorTradeProducers: { id: string; name: string }[];
  producers: { id: string; name: string }[];
};

/** POST /api/extract の成功応答 */
export type ExtractResult = {
  extracted: ExtractedRequest;
  unresolvedFields: DraftField[];
  candidateMatches: Partial<Record<string, Candidate[]>>;
  notices: ResolveNotice[];
};

/** POST /api/plan の応答 */
/** farmTags：農家（producerId）ごとの「対応できる取引」のタグ（規格外OK など。表示だけ。古い保存データにはない） */
export type Shown = { plan: PlanResult; version: string; fingerprint?: string; request: PlanRequest; suggestions: Suggestion[]; demoClock: boolean; farmTags?: Record<string, string[]> };

/** POST /api/plan-options の1件：希望日に受け取れる1つの回（受け取り1か所）での案の要約。おすすめ順に並ぶ */
export type PlanOption = {
  slotId: string; label: string; placeName: string; placeKind: string | null;
  startAt: string; endAt: string;
  status: string; requestedKg: number; fulfilledKg: number; shortageKg: number; producerCount: number; totalYen: number | null;
  farms: { producerName: string; kg: number }[];
};

/** 表示中の案が最新か。checking の間は以前の結果を有効扱いしない */
export type Freshness = "checking" | "fresh" | "stale";

export type Step = "input" | "confirm" | "result";
