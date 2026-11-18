type Question = { label: string; options: readonly (readonly [string, string])[] };
type OnboardingField = "industry" | "degree" | "interestLevel" | "ageGroup" | "primaryGoal";

export const onboardingQuestions: Record<OnboardingField, Question> = {
  industry: { label: "onboarding_industry", options: [
    ["agency", "onboarding_agency"], ["model", "onboarding_model"], ["agency_rep", "onboarding_scout"],
    ["fashion_design", "onboarding_designer"], ["marketing_pr", "onboarding_marketing"],
    ["photography_media", "onboarding_photography"], ["retail_buying", "onboarding_retail"],
    ["tech_ecommerce", "onboarding_tech"], ["student", "onboarding_student"], ["other", "onboarding_other"],
  ] },
  degree: { label: "onboarding_degree", options: [
    ["highschool", "onboarding_secondary"], ["bachelors", "onboarding_bachelor"], ["masters", "onboarding_master"],
    ["phd", "onboarding_phd"], ["self_taught", "onboarding_self_taught"],
  ] },
  interestLevel: { label: "onboarding_interest", options: [
    ["casual", "onboarding_casual"], ["enthusiast", "onboarding_enthusiast"],
    ["professional", "onboarding_professional"], ["executive", "onboarding_executive"],
  ] },
  ageGroup: { label: "onboarding_age", options: [
    ["under_18", "onboarding_under_18"], ["18_24", "18–24"], ["25_34", "25–34"], ["35_44", "35–44"], ["45_plus", "45+"],
  ] },
  primaryGoal: { label: "onboarding_goal", options: [
    ["networking", "onboarding_networking"], ["attend_events", "onboarding_events"], ["find_jobs", "onboarding_jobs"],
    ["sponsorship", "onboarding_sponsorship"], ["learning", "onboarding_learning"],
  ] },
};

export type OnboardingStats = {
  completed: number;
  counts: Record<OnboardingField, Record<string, number>>;
};
