export const REGIONS = ["大阪近郊", "北摂", "京都近郊", "兵庫近郊"] as const;
export const UNITS = ["kg", "個"] as const;
export const IRREGULAR_REASONS = ["形の不揃い", "余剰", "余剰・形の不揃い"] as const;

export const DEMO_PLACE = "共通受渡拠点P";
export const STATUS_LABEL = "農家承認前・在庫未確保";

export const LIMITS = {
  textMax: 30,
  placeMax: 50,
  quantityMax: 10000,
  priceMax: 1000000,
} as const;

// 産地（都道府県）。「大阪産」＝産地条件。受取場所（受渡枠）とは別の項目として扱う。
export const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県",
  "東京都", "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県", "三重県",
  "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県",
  "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
] as const;

/** 手入力画面で選択肢として先に出す近隣府県 */
export const NEARBY_PREFECTURES = ["大阪府", "京都府", "兵庫県", "奈良県", "和歌山県", "滋賀県"] as const;

/** 案の共通注記（提案は予約ではない） */
export const PLAN_NOTICE = "生産者への確認前・在庫未確保";
