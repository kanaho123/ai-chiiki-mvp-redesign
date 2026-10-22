import { createRouter } from "../server/router.js";
import * as extract from "../server/routes/extract.js";
import * as supplyDraft from "../server/routes/supply-draft.js";

// AI の読み取り（飲食店の仕入れ希望 /api/extract・生産者の出品の下書き /api/supply-draft）を受け持つ Function
export const { GET, POST, PATCH, PUT, DELETE } = createRouter({
  "/api/extract": extract,
  "/api/supply-draft": supplyDraft,
});
