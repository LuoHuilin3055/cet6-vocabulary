"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  addWrong,
  dailyCompletedCount,
  emptyQuizStore,
  loadQuizStore,
  markModeMastered,
  nextReviewItem,
  QuizMode,
  QuizScope,
  QuizStore,
  recordAttempt,
  removeWrong,
  saveQuizStore,
  shouldRemoveSpellingWrong,
  updateWordCompletion,
  todayKey,
} from "./quiz-storage";

type Word = { id: number; word: string; meaning: string };
type Theme = "light" | "dark" | "system";
type View = "home" | "practice" | "wrong" | "review-complete" | "words" | "stats" | "settings";

const SETTINGS_KEY = "cet6-settings-v1";
const BG_DB = "cet6-background";
const NUMBER_PAGE_SIZE = 100;

function saveBackground(file?: File): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BG_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("images");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const tx = request.result.transaction("images", "readwrite");
      const images = tx.objectStore("images");
      if (file) images.put(file, "background");
      else images.delete("background");
      tx.oncomplete = () => resolve(file ? URL.createObjectURL(file) : null);
      tx.onerror = () => reject(tx.error);
    };
  });
}

function loadBackground(): Promise<string | null> {
  return new Promise((resolve) => {
    const request = indexedDB.open(BG_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("images");
    request.onerror = () => resolve(null);
    request.onsuccess = () => {
      const result = request.result.transaction("images").objectStore("images").get("background");
      result.onsuccess = () => resolve(result.result ? URL.createObjectURL(result.result) : null);
      result.onerror = () => resolve(null);
    };
  });
}

export default function Home() {
  const [words, setWords] = useState<Word[]>([]);
  const [quiz, setQuiz] = useState<QuizStore>(() => emptyQuizStore());
  const [view, setView] = useState<View>("home");
  const [mode, setMode] = useState<QuizMode>("choice");
  const [scope, setScope] = useState<QuizScope>("standard");
  const [currentId, setCurrentId] = useState(1);
  const [completedMode, setCompletedMode] = useState<QuizMode>("choice");
  const [spellingInput, setSpellingInput] = useState("");
  const [showNumbers, setShowNumbers] = useState(false);
  const [numberPage, setNumberPage] = useState(0);
  const [theme, setTheme] = useState<Theme>("system");
  const [dailyGoal, setDailyGoal] = useState(50);
  const [query, setQuery] = useState("");
  const [background, setBackground] = useState<string | null>(null);
  const [overlay, setOverlay] = useState(38);
  const [blur, setBlur] = useState(0);
  const uploadRef = useRef<HTMLInputElement>(null);
  const appRef = useRef<HTMLElement>(null);

  useEffect(() => {
    fetch("./words.json").then((response) => response.json()).then(setWords);
    Promise.resolve().then(() => {
      setQuiz(loadQuizStore());
      try {
        const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
        if (saved.theme) setTheme(saved.theme);
        if (saved.sessionSize) setDailyGoal(saved.sessionSize);
        if (typeof saved.overlay === "number") setOverlay(saved.overlay);
        if (typeof saved.blur === "number") setBlur(saved.blur);
      } catch { /* keep defaults */ }
    });
    loadBackground().then(setBackground);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => root.dataset.theme = theme === "system"
      ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : theme;
    apply();
    const media = matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", apply);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme, sessionSize: dailyGoal, overlay, blur }));
    return () => media.removeEventListener("change", apply);
  }, [theme, dailyGoal, overlay, blur]);

  const source = useMemo(() => {
    if (scope === "standard") return words;
    const wrong = new Set(quiz.wrong[mode]);
    const completed = mode === "spelling" ? new Set(quiz.spellingReview.completedThisRound) : new Set<string>();
    return words.filter((item) => wrong.has(item.word) && !completed.has(item.word));
  }, [words, quiz.wrong, quiz.spellingReview.completedThisRound, mode, scope]);
  const currentIndex = Math.max(0, source.findIndex((item) => item.id === currentId));
  const current = source[currentIndex];
  const record = current ? quiz.answers[scope][mode][current.word] : undefined;

  useEffect(() => {
    if (mode === "spelling") Promise.resolve().then(() => setSpellingInput(record?.userAnswer || ""));
  }, [currentId, mode, scope, record?.userAnswer]);

  useEffect(() => {
    if (view === "practice" && mode === "choice") appRef.current?.focus();
  }, [view, mode, currentId]);

  const updateQuiz = (change: (next: QuizStore) => void) => {
    const next = structuredClone(quiz);
    if (next.daily.date !== todayKey()) next.daily = { date: todayKey(), choiceCorrect: [], spellingCorrect: [] };
    change(next);
    setQuiz(next);
    saveQuizStore(next);
  };

  const startPractice = (nextMode: QuizMode, nextScope: QuizScope) => {
    const wrong = new Set(quiz.wrong[nextMode]);
    const completed = nextMode === "spelling" ? new Set(quiz.spellingReview.completedThisRound) : new Set<string>();
    const available = nextScope === "standard"
      ? words
      : words.filter((item) => wrong.has(item.word) && !completed.has(item.word));
    if (!available.length) return;
    if (nextScope === "review") {
      updateQuiz((next) => {
        for (const item of available) {
          const previous = next.answers.review[nextMode][item.word];
          if (previous && !previous.correct) {
            next.answers.review[nextMode][item.word] = {
              ...previous,
              userAnswer: "",
              showAnswer: false,
            };
          }
        }
      });
    }
    const savedId = quiz.positions[nextScope][nextMode];
    const id = available.some((item) => item.id === savedId) ? savedId : available[0].id;
    setMode(nextMode);
    setScope(nextScope);
    setCurrentId(id);
    setNumberPage(Math.floor(Math.max(0, available.findIndex((item) => item.id === id)) / NUMBER_PAGE_SIZE));
    setShowNumbers(false);
    setView("practice");
  };

  const moveTo = (item?: Word) => {
    if (!item) return;
    setCurrentId(item.id);
    updateQuiz((next) => {
      if (scope === "review" && current && current.id !== item.id) {
        const previous = next.answers.review[mode][current.word];
        if (previous && !previous.correct) {
          next.answers.review[mode][current.word] = { ...previous, userAnswer: "", showAnswer: false };
        }
      }
      next.positions[scope][mode] = item.id;
    });
    setShowNumbers(false);
  };

  const relativeWord = (direction: -1 | 1) => {
    if (!source.length) return undefined;
    if (scope === "review") {
      if (source.length <= 1) return undefined;
      return source[(currentIndex + direction + source.length) % source.length];
    }
    return source[currentIndex + direction];
  };

  const moveRelative = (direction: -1 | 1) => moveTo(relativeWord(direction));

  const choiceOptions = useMemo(() => {
    if (!current || mode !== "choice" || !words.length) return [];
    const position = words.findIndex((item) => item.id === current.id);
    const options = [current];
    for (let offset = 1; options.length < 4 && offset < words.length; offset++) {
      const candidate = words[(position + offset) % words.length];
      if (candidate.word !== current.word) options.push(candidate);
    }
    const rotation = current.id % options.length;
    return [...options.slice(rotation), ...options.slice(0, rotation)];
  }, [current, mode, words]);

  const nextAfterCorrect = (nextWord?: Word) => {
    if (nextWord) setCurrentId(nextWord.id);
    else if (scope === "review") {
      setCompletedMode(mode);
      setView("review-complete");
    } else setView("home");
  };

  const chooseAnswer = (answer: Word) => {
    if (!current || record?.showAnswer || record?.correct) return;
    const correct = answer.word === current.word;
    const nextWord = scope === "review" ? nextReviewItem(source, currentIndex) : source[currentIndex + 1];
    updateQuiz((next) => {
      const previous = next.answers[scope].choice[current.word];
      next.answers[scope].choice[current.word] = {
        userAnswer: answer.word,
        correct,
        everWrong: previous?.everWrong || !correct,
        attempts: (previous?.attempts || 0) + 1,
        showAnswer: !correct,
      };
      if (!correct) addWrong(next, "choice", current.word);
      recordAttempt(next, current.id, current.word, correct);
      if (correct && scope === "standard") markModeMastered(next, "choice", current.word);
      if (correct && scope === "review") {
        removeWrong(next, "choice", current.word);
        markModeMastered(next, "choice", current.word);
        updateWordCompletion(next, current.word);
      }
      if (correct) next.positions[scope].choice = nextWord?.id || 1;
    });
    if (correct) nextAfterCorrect(nextWord);
  };

  const retryChoice = () => {
    if (!current) return;
    updateQuiz((next) => {
      const previous = next.answers.review.choice[current.word];
      next.answers.review.choice[current.word] = { ...previous, userAnswer: "", correct: false, showAnswer: false };
    });
  };

  const submitSpelling = () => {
    if (!current) return;
    const previous = quiz.answers[scope].spelling[current.word];
    if (previous?.showAnswer) {
      setSpellingInput("");
      updateQuiz((next) => {
        next.answers[scope].spelling[current.word] = { ...previous, userAnswer: "", showAnswer: false };
      });
      return;
    }
    const answer = spellingInput.trim();
    if (!answer) return;
    const correct = answer.toLowerCase() === current.word.toLowerCase();
    const passedRounds = quiz.spellingReview.passedRounds[current.word] || 0;
    const removeOnCorrect = scope === "review" && shouldRemoveSpellingWrong(passedRounds, previous?.roundWrong || false);
    const wrongAfter = removeOnCorrect ? quiz.wrong.spelling.filter((word) => word !== current.word) : quiz.wrong.spelling;
    const remainingThisRound = correct && scope === "review"
      ? [...source.slice(currentIndex + 1), ...source.slice(0, currentIndex)].filter((item) => item.word !== current.word)
      : [];
    const startsNewRound = correct && scope === "review" && !remainingThisRound.length && wrongAfter.length > 0;
    const nextWord = scope === "standard"
      ? source[currentIndex + 1]
      : remainingThisRound[0] || (startsNewRound ? words.find((item) => wrongAfter.includes(item.word)) : undefined);
    updateQuiz((next) => {
      const old = next.answers[scope].spelling[current.word];
      next.answers[scope].spelling[current.word] = {
        userAnswer: answer,
        correct,
        everWrong: old?.everWrong || !correct,
        attempts: (old?.attempts || 0) + 1,
        showAnswer: !correct,
        roundWrong: scope === "review" ? (old?.roundWrong || !correct) : old?.roundWrong,
      };
      if (!correct) addWrong(next, "spelling", current.word);
      recordAttempt(next, current.id, current.word, correct);
      if (correct && scope === "standard") markModeMastered(next, "spelling", current.word);
      if (correct && scope === "review") {
        if (removeOnCorrect) {
          removeWrong(next, "spelling", current.word);
          markModeMastered(next, "spelling", current.word);
          updateWordCompletion(next, current.word);
          delete next.spellingReview.passedRounds[current.word];
        } else {
          next.spellingReview.passedRounds[current.word] = passedRounds + 1;
          if (!next.spellingReview.completedThisRound.includes(current.word)) next.spellingReview.completedThisRound.push(current.word);
        }
        if (startsNewRound) {
          next.spellingReview.completedThisRound = [];
          for (const word of wrongAfter) {
            const saved = next.answers.review.spelling[word];
            if (saved) next.answers.review.spelling[word] = { ...saved, userAnswer: "", correct: false, showAnswer: false, roundWrong: false };
          }
        }
      }
      if (correct) next.positions[scope].spelling = nextWord?.id || 1;
    });
    if (correct) nextAfterCorrect(nextWord);
  };

  const answerClass = (item: Word) => {
    if (!record) return "";
    if (record.correct && record.userAnswer === item.word) return "correct";
    if (record.showAnswer && item.word === current?.word) return "correct";
    if (record.showAnswer && record.userAnswer === item.word) return "incorrect selected";
    return record.userAnswer === item.word ? "selected" : "";
  };

  const numberStatus = (item: Word) => {
    const answer = quiz.answers[scope][mode][item.word];
    if (!answer) return "unanswered";
    if (answer.correct && answer.everWrong) return "corrected";
    if (answer.correct) return "correct";
    if (answer.everWrong) return "wrong";
    return "unanswered";
  };

  const completedToday = dailyCompletedCount(quiz);
  const learnedWords = useMemo(() => {
    const choice = quiz.answers.standard.choice;
    const spelling = quiz.answers.standard.spelling;
    return words.filter((item) => choice[item.word]?.correct || spelling[item.word]?.correct).length;
  }, [quiz.answers.standard, words]);
  const filteredWords = useMemo(() => words.filter((item) => `${item.word} ${item.meaning}`.toLowerCase().includes(query.toLowerCase())), [words, query]);
  const numberPages = Math.max(1, Math.ceil(source.length / NUMBER_PAGE_SIZE));
  const visibleNumbers = source.slice(numberPage * NUMBER_PAGE_SIZE, (numberPage + 1) * NUMBER_PAGE_SIZE);

  const changeBackground = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith("image/") || file.size > 12 * 1024 * 1024) return;
    if (background) URL.revokeObjectURL(background);
    setBackground(await saveBackground(file));
    event.target.value = "";
  };
  const removeBackground = async () => {
    if (background) URL.revokeObjectURL(background);
    setBackground(await saveBackground());
  };

  const resetQuizRecords = () => {
    if (!confirm("确定要重置全部刷题记录吗？答题进度、错题本和统计数据都会被清空，此操作无法撤销。")) return;
    const next = emptyQuizStore();
    setQuiz(next);
    saveQuizStore(next);
    localStorage.removeItem("cet6-progress-v1");
    setCurrentId(1);
    setView("home");
  };

  const handleKeyboard = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (showNumbers) {
      if (key === "escape") {
        event.preventDefault();
        setShowNumbers(false);
      }
      return;
    }
    if (view !== "practice") return;
    const target = event.target as HTMLElement;
    const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
    if (!typing && !event.altKey && mode === "choice" && !record?.showAnswer && !record?.correct) {
      const letters = ["a", "b", "c", "d"];
      const optionIndex = /^[1-4]$/.test(key) ? Number(key) - 1 : letters.indexOf(key);
      if (optionIndex >= 0 && choiceOptions[optionIndex]) {
        event.preventDefault();
        chooseAnswer(choiceOptions[optionIndex]);
        return;
      }
    }
    if (typing) {
      if (mode === "spelling" && key === "arrowup" && (scope === "review" ? source.length > 1 : currentIndex > 0)) {
        event.preventDefault();
        moveRelative(-1);
      } else if (mode === "spelling" && key === "arrowdown" && (scope === "review" ? source.length > 1 : currentIndex < source.length - 1)) {
        event.preventDefault();
        moveRelative(1);
      }
      return;
    }
    if (key === "arrowleft" && (scope === "review" ? source.length > 1 : currentIndex > 0)) {
      event.preventDefault();
      moveRelative(-1);
    } else if (key === "arrowright" && (scope === "review" ? source.length > 1 : currentIndex < source.length - 1)) {
      event.preventDefault();
      moveRelative(1);
    } else if (key === "n") {
      event.preventDefault();
      setNumberPage(Math.floor(currentIndex / NUMBER_PAGE_SIZE));
      setShowNumbers(true);
    }
  };

  return <main ref={appRef} tabIndex={-1} className="app-shell" onKeyDown={handleKeyboard}>
    {background && <div className="custom-background" style={{ backgroundImage: `url(${background})`, filter: `blur(${blur}px) scale(1.03)` }} />}
    {background && <div className="background-overlay" style={{ opacity: overlay / 100 }} />}
    <aside className="sidebar">
      <button className="brand" onClick={() => setView("home")}><span>六</span><b>六级单词</b></button>
      <nav>
        <button className={view === "home" ? "active" : ""} onClick={() => setView("home")}><i>⌂</i>首页</button>
        <button className={view === "practice" && scope === "standard" ? "active" : ""} onClick={() => startPractice("choice", "standard")}><i>▣</i>学习</button>
        <button className={view === "wrong" || scope === "review" ? "active" : ""} onClick={() => setView("wrong")}><i>◇</i>错题本</button>
        <button className={view === "words" ? "active" : ""} onClick={() => setView("words")}><i>☷</i>单词列表</button>
        <button className={view === "stats" ? "active" : ""} onClick={() => setView("stats")}><i>▥</i>统计</button>
        <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}><i>⚙</i>设置</button>
      </nav>
      <div className="theme-switch" aria-label="切换主题"><button className={theme === "light" ? "selected" : ""} onClick={() => setTheme("light")}>☀</button><button className={theme === "system" ? "selected" : ""} onClick={() => setTheme("system")}>自动</button><button className={theme === "dark" ? "selected" : ""} onClick={() => setTheme("dark")}>☾</button></div>
    </aside>

    <section className="content">
      {view === "home" && <>
        <header className="topbar"><div><p className="eyebrow">CET-6 VOCABULARY</p><h1>六级单词 <em>{words.length || "…"}词</em></h1></div><p>选择与拼写都正确，才算真正完成。</p></header>
        <section className="dashboard-grid">
          <article className="welcome-card"><span className="leaf">❧</span><p>学习概况</p><h2>{completedToday ? "今天的双项练习正在稳步推进" : "从选择与拼写的第一题开始"}</h2><div className="stat-row"><b>{learnedWords}</b><span>已练习</span><b>{quiz.wrong.choice.length}</b><span>选择错题</span><b>{quiz.wrong.spelling.length}</b><span>拼写错题</span></div></article>
          <article className="progress-card"><div className="ring" style={{ "--percent": `${Math.min(100, completedToday / Math.max(dailyGoal, 1) * 100) * 3.6}deg` } as React.CSSProperties}><span>{Math.min(100, Math.round(completedToday / Math.max(dailyGoal, 1) * 100))}%</span></div><div className="progress-details"><p>今日双项完成</p><h3>{completedToday} <small>/ {dailyGoal} 词</small></h3><div className="daily-bar"><i style={{ width: `${Math.min(100, completedToday / Math.max(dailyGoal, 1) * 100)}%` }} /></div><div className="legend"><span>● 选择与拼写均正确才计数</span></div></div></article>
          <button className="study-card en" onClick={() => startPractice("choice", "standard")}><span className="language-icon">A<small>?</small></span><div><h2>选择题</h2><p>按词表顺序练习，保存每题答案</p><b>继续答题 →</b></div></button>
          <button className="study-card zh" onClick={() => startPractice("spelling", "standard")}><span className="language-icon">中<small>✎</small></span><div><h2>拼写题</h2><p>反复拼写，直到正确</p><b>继续答题 →</b></div></button>
          <button className="mini-card" onClick={() => setView("wrong")}><span>▱</span><div><h3>错题本</h3><p>选择 {quiz.wrong.choice.length} 题 · 拼写 {quiz.wrong.spelling.length} 题</p></div><b>›</b></button>
          <button className="mini-card" onClick={() => setView("words")}><span>☷</span><div><h3>单词列表</h3><p>搜索并浏览全部词汇</p></div><b>›</b></button>
        </section>
      </>}

      {view === "practice" && current && <section className="study-view">
        <header className="page-head"><button onClick={() => setView(scope === "review" ? "wrong" : "home")}>← {scope === "review" ? "返回错题本" : "返回首页"}</button><span>{scope === "review" ? "错题复习" : "普通学习"} · {mode === "choice" ? "选择题" : "拼写题"}</span></header>
        <div className="study-progress"><i style={{ width: `${(currentIndex + 1) / Math.max(source.length, 1) * 100}%` }} /></div>
        <div className="question-toolbar"><button title={mode === "spelling" ? "上一题（↑）" : "上一题（←）"} disabled={scope === "review" ? source.length <= 1 : currentIndex === 0} onClick={() => moveRelative(-1)}>← 上一题</button><button className="number-trigger" title="选择题号（N）" onClick={() => { setNumberPage(Math.floor(currentIndex / NUMBER_PAGE_SIZE)); setShowNumbers(true); }}>题号 {current.id} <small>/ {words.length}</small>⌄</button><button title={mode === "spelling" ? "下一题（↓）" : "下一题（→）"} disabled={scope === "review" ? source.length <= 1 : currentIndex === source.length - 1} onClick={() => moveRelative(1)}>下一题 →</button></div>
        <article className="flashcard">
          <p className="prompt-label">{mode === "choice" ? "点击选项立即判断" : "输入英文后按 Enter 判断"}</p>
          <h2>{mode === "choice" ? current.word : current.meaning}</h2>
          {mode === "choice" ? <><div className="choice-grid">{choiceOptions.map((item, optionIndex) => <button key={item.word} disabled={Boolean(record?.showAnswer || record?.correct)} className={answerClass(item)} onClick={() => chooseAnswer(item)}><kbd>{String.fromCharCode(65 + optionIndex)}</kbd><span>{item.meaning}</span></button>)}</div><p className="keyboard-tip">键盘可按 A–D 或 1–4 作答</p></> : <><input className="spelling-input" disabled={Boolean(record?.correct)} value={spellingInput} onChange={(event) => setSpellingInput(event.target.value)} onKeyDown={(event) => event.key === "Enter" && submitSpelling()} placeholder={record?.showAnswer ? "再次按 Enter 重新拼写" : "输入英文单词"} autoComplete="off" autoCapitalize="none" spellCheck={false} /><p className="enter-tip">{record?.showAnswer ? "再次按 Enter 隐藏答案并重新作答" : "Enter 判题 · ↑ 上一题 · ↓ 下一题"}</p></>}
          {record?.showAnswer && <div className="answer-result incorrect"><strong>回答错误</strong><span>正确答案：{mode === "choice" ? current.meaning : current.word}</span>{mode === "choice" && scope === "review" && <button onClick={retryChoice}>重新作答</button>}</div>}
          {record?.correct && <div className={`saved-result ${record.everWrong ? "corrected" : "correct"}`}>{record.everWrong ? "曾答错，现已答对" : "回答正确"}</div>}
        </article>
      </section>}

      {view === "wrong" && <section className="wrong-home"><header className="section-title"><div><p className="eyebrow">WRONG BOOK</p><h2>错题本</h2><p>选择题与拼写题分开复习；在复习中答对后移出对应错题本。</p></div></header><div className="wrong-mode-grid"><button disabled={!quiz.wrong.choice.length} onClick={() => startPractice("choice", "review")}><span>A?</span><div><h3>选择题复习</h3><p>{quiz.wrong.choice.length} 道错题</p></div><b>进入 →</b></button><button disabled={!quiz.wrong.spelling.length} onClick={() => startPractice("spelling", "review")}><span>中✎</span><div><h3>拼写题复习</h3><p>{quiz.wrong.spelling.length} 道错题</p></div><b>进入 →</b></button></div></section>}

      {view === "review-complete" && <section className="review-complete"><span>✓</span><p className="eyebrow">REVIEW COMPLETE</p><h2>{completedMode === "choice" ? "选择题" : "拼写题"}错题已全部清空</h2><p>这一类错题已经全部答对，可以继续处理另一类错题。</p><div><button onClick={() => setView("wrong")}>返回错题本</button><button onClick={() => setView("home")}>返回首页</button></div></section>}

      {view === "words" && <section className="list-view"><header className="section-title"><div><p className="eyebrow">ALL WORDS</p><h2>单词列表</h2><p>共 {words.length} 个单词，支持中英文搜索。</p></div></header><div className="filters"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索英文或中文释义…" /></div><WordTable items={filteredWords.slice(0, 300)} quiz={quiz} /><p className="table-tip">{filteredWords.length > 300 ? `当前显示前 300 条（共 ${filteredWords.length} 条）` : `共 ${filteredWords.length} 条`}</p></section>}

      {view === "stats" && <StatisticsPage quiz={quiz} words={words} onReset={resetQuizRecords} />}

      {view === "settings" && <section className="settings-view"><header className="section-title"><div><p className="eyebrow">PREFERENCES</p><h2>设置</h2><p>调整每日目标和显示方式。</p></div></header><article className="setting-card"><div><h3>白天与黑夜模式</h3><p>手动切换或跟随系统。</p></div><div className="segmented"><button className={theme === "light" ? "active" : ""} onClick={() => setTheme("light")}>☀ 白天</button><button className={theme === "system" ? "active" : ""} onClick={() => setTheme("system")}>跟随系统</button><button className={theme === "dark" ? "active" : ""} onClick={() => setTheme("dark")}>☾ 黑夜</button></div></article><article className="setting-card"><div><h3>每日完成目标</h3><p>一个单词的选择题与拼写题均正确后计为一个。</p></div><div className="segmented">{[10, 20, 50, 100].map((number) => <button key={number} className={dailyGoal === number ? "active" : ""} onClick={() => setDailyGoal(number)}>{number}</button>)}</div></article><article className="setting-card background-setting"><div><h3>自定义背景图片</h3><p>图片仅保存在当前浏览器，最大 12MB。</p></div><div className="background-actions"><input ref={uploadRef} hidden type="file" accept="image/*" onChange={changeBackground} /><button className="upload" onClick={() => uploadRef.current?.click()}>选择本地图片</button>{background && <button onClick={removeBackground}>恢复默认</button>}</div>{background && <div className="sliders"><label>遮罩强度 <input type="range" min="0" max="85" value={overlay} onChange={(event) => setOverlay(+event.target.value)} /><b>{overlay}%</b></label><label>背景模糊 <input type="range" min="0" max="16" value={blur} onChange={(event) => setBlur(+event.target.value)} /><b>{blur}px</b></label></div>}</article></section>}
    </section>

    {showNumbers && <div className="number-modal" role="dialog" aria-modal="true" aria-label="选择题号"><button className="modal-backdrop" onClick={() => setShowNumbers(false)} aria-label="关闭题号面板" /><section className="number-panel"><header><div><h3>选择题号</h3><p><span className="dot correct" />正确 <span className="dot wrong" />错误 <span className="dot corrected" />先错后对</p></div><button onClick={() => setShowNumbers(false)}>×</button></header><div className="number-grid">{visibleNumbers.map((item) => <button key={item.id} className={`${numberStatus(item)} ${item.id === current.id ? "current" : ""}`} onClick={() => moveTo(item)}>{item.id}</button>)}</div><footer><button disabled={numberPage === 0} onClick={() => setNumberPage(numberPage - 1)}>← 上100题</button><span>{numberPage + 1} / {numberPages}</span><button disabled={numberPage >= numberPages - 1} onClick={() => setNumberPage(numberPage + 1)}>下100题 →</button></footer></section></div>}
  </main>;
}

function StatisticsPage({ quiz, words, onReset }: { quiz: QuizStore; words: Word[]; onReset: () => void }) {
  const dailyEntries = Object.entries(quiz.statistics.daily).sort(([a], [b]) => a.localeCompare(b)).slice(-7);
  const days = dailyEntries.length ? dailyEntries : [[quiz.daily.date, { answered: 0, correct: 0, wrong: 0 }]] as typeof dailyEntries;
  const maxDaily = Math.max(1, ...days.map(([, value]) => value.answered));
  const wordStats = Object.values(quiz.statistics.words);
  const totals = wordStats.reduce((sum, item) => ({ answered: sum.answered + item.answered, correct: sum.correct + item.correct, wrong: sum.wrong + item.wrong }), { answered: 0, correct: 0, wrong: 0 });
  const correctPercent = totals.answered ? Math.round(totals.correct / totals.answered * 100) : 0;
  const rangeSize = Math.max(1, Math.ceil(words.length / 10));
  const ranges = Array.from({ length: Math.ceil(words.length / rangeSize) }, (_, rangeIndex) => {
    const items = words.slice(rangeIndex * rangeSize, (rangeIndex + 1) * rangeSize);
    const values = items.map((item) => quiz.statistics.questions[String(item.id)]).filter(Boolean);
    const answered = values.reduce((sum, item) => sum + item.answered, 0);
    const correct = values.reduce((sum, item) => sum + item.correct, 0);
    return { label: `${rangeIndex * rangeSize + 1}-${Math.min((rangeIndex + 1) * rangeSize, words.length)}`, answered, accuracy: answered ? Math.round(correct / answered * 100) : 0 };
  });
  const ranking = words.map((item) => ({ ...item, wrong: quiz.statistics.questions[String(item.id)]?.wrong || 0, answered: quiz.statistics.questions[String(item.id)]?.answered || 0 })).filter((item) => item.wrong).sort((a, b) => b.wrong - a.wrong || a.id - b.id).slice(0, 10);

  return <section className="stats-view"><header className="section-title"><div><p className="eyebrow">STATISTICS</p><h2>刷题统计</h2><p>统计数据从启用本页面后开始精确累计。</p></div><button className="reset-records" onClick={onReset}>重置刷题记录</button></header>
    <article className="stats-card"><h3>每日刷题数量</h3><div className="daily-chart" role="img" aria-label="最近七个有记录日期的刷题数量">{days.map(([date, value]) => <div className="daily-column" key={date}><span>{value.answered || ""}</span><i style={{ height: `${Math.max(value.answered ? 8 : 1, value.answered / maxDaily * 100)}%` }} /><small>{date.slice(5)}</small></div>)}</div></article>
    <article className="stats-card"><h3>正确 / 错误占比</h3><div className="ratio-layout"><div className="ratio-donut" style={{ "--correct": `${correctPercent * 3.6}deg` } as React.CSSProperties}><strong>{correctPercent}%</strong><small>正确率</small></div><div className="ratio-legend"><p><i className="correct" />正确 <b>{totals.correct}</b></p><p><i className="wrong" />错误 <b>{totals.wrong}</b></p><p>共作答 <b>{totals.answered}</b> 次</p></div></div></article>
    <article className="stats-card range-card"><h3>题号区间正确率</h3><div className="range-chart" role="img" aria-label="各题号区间正确率">{ranges.map((range) => <div className={`range-row ${range.answered ? "" : "no-data"}`} key={range.label}><span>{range.label}</span><div><i style={{ width: `${range.accuracy}%` }} /></div><b>{range.answered ? `${range.accuracy}%` : "暂无数据"}</b></div>)}</div></article>
    <article className="stats-card"><h3>错题最多排行</h3>{ranking.length ? <div className="wrong-ranking">{ranking.map((item, index) => <div key={item.id}><b>{index + 1}</b><span><strong>{item.word}</strong><small>{item.meaning}</small></span><em>{item.wrong} 次错误</em></div>)}</div> : <div className="stats-empty">暂无错题统计，开始答题后会显示。</div>}</article>
  </section>;
}

function WordTable({ items, quiz }: { items: Word[]; quiz: QuizStore }) {
  return <div className="word-table">{items.length ? items.map((item) => {
    const choice = quiz.answers.standard.choice[item.word]?.correct;
    const spelling = quiz.answers.standard.spelling[item.word]?.correct;
    const status = choice && spelling ? "双项完成" : choice ? "选择已完成" : spelling ? "拼写已完成" : "未完成";
    return <div className="word-row" key={item.id}><strong>{item.id}. {item.word}</strong><span>{item.meaning}</span><em className={choice && spelling ? "known" : "new"}>{status}</em></div>;
  }) : <div className="empty">这里暂时没有单词。</div>}</div>;
}
