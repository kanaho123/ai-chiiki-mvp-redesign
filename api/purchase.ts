import { createRouter } from "../server/router.js";
import * as catalog from "../server/routes/catalog.js";
import * as inventoryVersion from "../server/routes/inventory-version.js";
import * as itemSuggestions from "../server/routes/item-suggestions.js";
import * as plan from "../server/routes/plan.js";
import * as planOptions from "../server/routes/plan-options.js";

// 飲食店の仕入れ（/api/catalog・/api/inventory-version・/api/plan・/api/plan-options・/api/item-suggestions）を受け持つ Function
export const { GET, POST, PATCH, PUT, DELETE } = createRouter({
  "/api/catalog": catalog,
  "/api/inventory-version": inventoryVersion,
  "/api/plan": plan,
  "/api/plan-options": planOptions,
  "/api/item-suggestions": itemSuggestions,
});
