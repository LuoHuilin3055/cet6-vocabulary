import assert from "node:assert/strict";
import test from "node:test";
import {
  addWrong,
  dailyCompletedCount,
  emptyQuizStore,
  markModeMastered,
  nextReviewItem,
  removeWrong,
  recordAttempt,
  shouldRemoveSpellingWrong,
} from "../app/quiz-storage.ts";

test("daily progress counts a word only after both modes are correct", () => {
  const store = emptyQuizStore();
  markModeMastered(store, "choice", "consistent");
  assert.equal(dailyCompletedCount(store), 0);
  markModeMastered(store, "spelling", "consistent");
  assert.equal(dailyCompletedCount(store), 1);
  markModeMastered(store, "choice", "consistent");
  assert.equal(dailyCompletedCount(store), 1);
});

test("a corrected word does not count while it remains in either wrong book", () => {
  const store = emptyQuizStore();
  addWrong(store, "spelling", "battery");
  markModeMastered(store, "choice", "battery");
  markModeMastered(store, "spelling", "battery");
  assert.equal(dailyCompletedCount(store), 0);
  removeWrong(store, "spelling", "battery");
  markModeMastered(store, "spelling", "battery");
  assert.equal(dailyCompletedCount(store), 1);
});

test("answer attempts accumulate daily and per-word statistics", () => {
  const store = emptyQuizStore();
  recordAttempt(store, "battery", false);
  recordAttempt(store, "battery", true);
  assert.deepEqual(store.statistics.words.battery, { answered: 2, correct: 1, wrong: 1 });
  assert.deepEqual(store.statistics.daily[store.daily.date], { answered: 2, correct: 1, wrong: 1 });
});

test("review navigation wraps remaining wrong items until the queue is empty", () => {
  const items = ["one", "two", "three"];
  assert.equal(nextReviewItem(items, 0), "two");
  assert.equal(nextReviewItem(items, 2), "one");
  assert.equal(nextReviewItem(["last"], 0), undefined);
});

test("spelling wrongs leave only after a later round is correct on the first attempt", () => {
  assert.equal(shouldRemoveSpellingWrong(0, false), false);
  assert.equal(shouldRemoveSpellingWrong(1, true), false);
  assert.equal(shouldRemoveSpellingWrong(1, false), true);
  assert.equal(shouldRemoveSpellingWrong(3, true), false);
});

test("choice and spelling wrong books remain isolated", () => {
  const store = emptyQuizStore();
  addWrong(store, "choice", "battery");
  addWrong(store, "spelling", "preserve");
  assert.deepEqual(store.wrong.choice, ["battery"]);
  assert.deepEqual(store.wrong.spelling, ["preserve"]);
});

test("a correct review removes only the matching wrong-book entry", () => {
  const store = emptyQuizStore();
  addWrong(store, "choice", "battery");
  addWrong(store, "choice", "preserve");
  addWrong(store, "spelling", "battery");
  removeWrong(store, "choice", "battery");
  assert.deepEqual(store.wrong.choice, ["preserve"]);
  assert.deepEqual(store.wrong.spelling, ["battery"]);
});
