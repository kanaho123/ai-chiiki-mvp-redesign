import { checkProducer } from "../../src/lib/onboarding.js";
import { completeOnboarding } from "../../server/onboarding-api.js";
import { handle } from "../../server/http.js";

// 生産者の初回登録を完了する（農園の情報・主な作物・参加する受渡枠・開示する連絡先を保存し、登録済みにする）
export const POST = handle((request) => completeOnboarding(request, "producer", checkProducer));
