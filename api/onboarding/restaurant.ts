import { checkRestaurant } from "../../src/lib/onboarding.js";
import { completeOnboarding } from "../../server/onboarding-api.js";
import { handle } from "../../server/http.js";

// 飲食店の初回登録を完了する（お店の情報・仕入れの好みを保存し、登録済みにする）
export const POST = handle((request) => completeOnboarding(request, "restaurant", checkRestaurant));
