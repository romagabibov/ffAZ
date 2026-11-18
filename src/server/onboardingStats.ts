import type { Firestore, Query } from "firebase-admin/firestore";
import { onboardingQuestions, type OnboardingStats } from "../lib/onboardingQuestions.js";

async function count(query: Query) {
  return (await query.count().get()).data().count;
}

export function createOnboardingStatsReader(db: Firestore) {
  let result: OnboardingStats | undefined;
  let expiresAt = 0;
  let pending: Promise<OnboardingStats> | undefined;

  async function read() {
    const completed = db.collection("publicProfiles").where("onboardingComplete", "==", true);
    const [total, questions] = await Promise.all([
      count(completed),
      Promise.all(Object.entries(onboardingQuestions).map(async ([field, { options }]) => {
        const choices = await Promise.all(options.map(async ([value]) => {
          const accepted = field === "industry" && value === "fashion_design" ? [value, "designer"] : [value];
          const filter = accepted.length === 1 ? completed.where(field, "==", value) : completed.where(field, "in", accepted);
          return [value, await count(filter)] as const;
        }));
        return [field, Object.fromEntries(choices)] as const;
      })),
    ]);
    return { completed: total, counts: Object.fromEntries(questions) as OnboardingStats["counts"] };
  }

  return async () => {
    if (result && expiresAt > Date.now()) return result;
    if (!pending) pending = read().then((data) => {
      result = data;
      expiresAt = Date.now() + 5 * 60_000;
      return data;
    }).finally(() => { pending = undefined; });
    return pending;
  };
}
