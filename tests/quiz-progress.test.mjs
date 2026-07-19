import assert from "node:assert/strict";
import test from "node:test";
import {
  addWrong,
  dailyCompletedCount,
  emptyQuizStore,
  markDailyCorrect,
  nextReviewItem,
  removeWrong,
  shouldRemoveSpellingWrong,
} from "../app/quiz-storage.ts";

test("daily progress counts a word only after both modes are correct", () => {
  const store = emptyQuizStore();
  markDailyCorrect(store, "choice", "consistent");
  assert.equal(dailyCompletedCount(store), 0);
  markDailyCorrect(store, "spelling", "consistent");
  assert.equal(dailyCompletedCount(store), 1);
  markDailyCorrect(store, "choice", "consistent");
  assert.equal(dailyCompletedCount(store), 1);
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
