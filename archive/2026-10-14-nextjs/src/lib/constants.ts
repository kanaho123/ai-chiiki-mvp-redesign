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
