export type QuizMode = "choice" | "spelling";
export type QuizScope = "standard" | "review";

export type AnswerRecord = {
  userAnswer: string;
  correct: boolean;
  everWrong: boolean;
  attempts: number;
  showAnswer: boolean;
  roundWrong?: boolean;
};

type AnswerMap = Record<string, AnswerRecord>;
type ModeMaps = Record<QuizMode, AnswerMap>;

export type QuizStore = {
  version: 2;
  answers: Record<QuizScope, ModeMaps>;
  wrong: Record<QuizMode, string[]>;
  positions: Record<QuizScope, Record<QuizMode, number>>;
  daily: {
    date: string;
    choiceCorrect: string[];
    spellingCorrect: string[];
  };
  spellingReview: {
    completedThisRound: string[];
    passedRounds: Record<string, number>;
  };
  statistics: {
    daily: Record<string, { answered: number; correct: number; wrong: number }>;
    words: Record<string, { answered: number; correct: number; wrong: number }>;
  };
};

export const QUIZ_KEY = "cet6-quiz-v2";

export function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function emptyQuizStore(): QuizStore {
  return {
    version: 2,
    answers: {
      standard: { choice: {}, spelling: {} },
      review: { choice: {}, spelling: {} },
    },
    wrong: { choice: [], spelling: [] },
    positions: {
      standard: { choice: 1, spelling: 1 },
      review: { choice: 1, spelling: 1 },
    },
    daily: { date: todayKey(), choiceCorrect: [], spellingCorrect: [] },
    spellingReview: { completedThisRound: [], passedRounds: {} },
    statistics: { daily: {}, words: {} },
  };
}

export function loadQuizStore(): QuizStore {
  const fallback = emptyQuizStore();
  try {
    const parsed = JSON.parse(localStorage.getItem(QUIZ_KEY) || "null") as Partial<QuizStore> | null;
    if (!parsed || parsed.version !== 2) return migrateLegacy(fallback);
    const store: QuizStore = {
      ...fallback,
      ...parsed,
      answers: {
        standard: {
          choice: parsed.answers?.standard?.choice || {},
          spelling: parsed.answers?.standard?.spelling || {},
        },
        review: {
          choice: parsed.answers?.review?.choice || {},
          spelling: parsed.answers?.review?.spelling || {},
        },
      },
      wrong: {
        choice: parsed.wrong?.choice || [],
        spelling: parsed.wrong?.spelling || [],
      },
      positions: {
        standard: {
          choice: parsed.positions?.standard?.choice || 1,
          spelling: parsed.positions?.standard?.spelling || 1,
        },
        review: {
          choice: parsed.positions?.review?.choice || 1,
          spelling: parsed.positions?.review?.spelling || 1,
        },
      },
      daily: parsed.daily || fallback.daily,
      spellingReview: parsed.spellingReview || fallback.spellingReview,
      statistics: parsed.statistics || fallback.statistics,
    };
    if (store.daily.date !== todayKey()) store.daily = fallback.daily;
    return store;
  } catch {
    return fallback;
  }
}

function migrateLegacy(store: QuizStore) {
  try {
    const legacy = JSON.parse(localStorage.getItem("cet6-progress-v1") || "{}") as Record<string, { mark?: string }>;
    store.wrong.choice = Object.entries(legacy)
      .filter(([, value]) => value.mark === "unknown" || value.mark === "fuzzy")
      .map(([word]) => word);
  } catch { /* ignore malformed legacy data */ }
  return store;
}

export function saveQuizStore(store: QuizStore) {
  localStorage.setItem(QUIZ_KEY, JSON.stringify(store));
}

export function dailyCompletedCount(store: QuizStore) {
  const spelling = new Set(store.daily.spellingCorrect);
  return new Set(store.daily.choiceCorrect.filter((word) => spelling.has(word))).size;
}

export function addWrong(store: QuizStore, mode: QuizMode, word: string) {
  if (!store.wrong[mode].includes(word)) store.wrong[mode].push(word);
}

export function removeWrong(store: QuizStore, mode: QuizMode, word: string) {
  store.wrong[mode] = store.wrong[mode].filter((item) => item !== word);
}

export function markDailyCorrect(store: QuizStore, mode: QuizMode, word: string) {
  const key = mode === "choice" ? "choiceCorrect" : "spellingCorrect";
  if (!store.daily[key].includes(word)) store.daily[key].push(word);
}

export function nextReviewItem<T>(items: T[], currentIndex: number) {
  if (items.length <= 1) return undefined;
  return items[(currentIndex + 1) % items.length];
}

export function shouldRemoveSpellingWrong(passedRounds: number, roundWrong: boolean) {
  return passedRounds >= 1 && !roundWrong;
}

export function recordAttempt(store: QuizStore, word: string, correct: boolean) {
  const date = store.daily.date;
  const daily = store.statistics.daily[date] || { answered: 0, correct: 0, wrong: 0 };
  const wordStats = store.statistics.words[word] || { answered: 0, correct: 0, wrong: 0 };
  daily.answered += 1;
  wordStats.answered += 1;
  if (correct) {
    daily.correct += 1;
    wordStats.correct += 1;
  } else {
    daily.wrong += 1;
    wordStats.wrong += 1;
  }
  store.statistics.daily[date] = daily;
  store.statistics.words[word] = wordStats;
}
