export const ONBOARDING_STORAGE_KEY = "chatverse:onboarding:v1";
export const ONBOARDING_CHANGE_EVENT = "chatverse:onboarding-change";

export type OnboardingChapter = "home" | "models" | "world";
export type OnboardingChapterStatus = "pending" | "dismissed" | "completed";

export type OnboardingState = {
  version: 1;
  chapters: Record<OnboardingChapter, OnboardingChapterStatus>;
};

const DEFAULT_STATE: OnboardingState = {
  version: 1,
  chapters: {
    home: "pending",
    models: "pending",
    world: "pending",
  },
};

export function readOnboardingState(storage: Pick<Storage, "getItem"> = window.localStorage): OnboardingState {
  try {
    const parsed = JSON.parse(storage.getItem(ONBOARDING_STORAGE_KEY) ?? "null") as Partial<OnboardingState> | null;
    if (!parsed || parsed.version !== 1 || !parsed.chapters) return cloneDefaultState();
    return {
      version: 1,
      chapters: {
        home: normalizeStatus(parsed.chapters.home),
        models: normalizeStatus(parsed.chapters.models),
        world: normalizeStatus(parsed.chapters.world),
      },
    };
  } catch {
    return cloneDefaultState();
  }
}

export function setOnboardingChapterStatus(
  chapter: OnboardingChapter,
  status: OnboardingChapterStatus,
  storage: Pick<Storage, "getItem" | "setItem"> = window.localStorage,
): OnboardingState {
  const next = readOnboardingState(storage);
  next.chapters[chapter] = status;
  storage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(next));
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(ONBOARDING_CHANGE_EVENT, { detail: next }));
  return next;
}

export function completeOnboardingChapter(chapter: OnboardingChapter): OnboardingState {
  return setOnboardingChapterStatus(chapter, "completed");
}

export function dismissOnboardingChapter(chapter: OnboardingChapter): OnboardingState {
  return setOnboardingChapterStatus(chapter, "dismissed");
}

function normalizeStatus(value: unknown): OnboardingChapterStatus {
  return value === "dismissed" || value === "completed" ? value : "pending";
}

function cloneDefaultState(): OnboardingState {
  return { version: 1, chapters: { ...DEFAULT_STATE.chapters } };
}
