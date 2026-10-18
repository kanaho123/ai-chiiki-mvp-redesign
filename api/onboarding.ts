import { createRouter } from "../server/router.js";
import * as master from "../server/routes/onboarding/master.js";
import * as producer from "../server/routes/onboarding/producer.js";
import * as restaurant from "../server/routes/onboarding/restaurant.js";

// 初回登録（/api/onboarding/*）を受け持つ Function
export const { GET, POST, PATCH, PUT, DELETE } = createRouter({
  "/api/onboarding/master": master,
  "/api/onboarding/producer": producer,
  "/api/onboarding/restaurant": restaurant,
});
