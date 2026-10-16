// Legacy: 旧仕様の出品（Listing）の型。生産者画面・ホームの旧表示だけが使う。
// Phase 3 で生産者画面を新しい Supply に移行した後に削除する。
export type SupplyListing = {
  id: string;
  producerId: string;
  producerName: string;
  item: string;
  variety: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  availableDate: string;
  region: string;
  irregularReason: string | null;
  handoverPlace: string;
  handoverStart: string;
  handoverEnd: string;
  minQuantity: number;
  step: number;
  handoverFee: number;
  isPublic: boolean;
};
