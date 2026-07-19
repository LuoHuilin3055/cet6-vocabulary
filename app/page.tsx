"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

type Word = { id: number; word: string; meaning: string };
type Mark = "known" | "fuzzy" | "unknown";
type Mode = "choice" | "spelling";
type Theme = "light" | "dark" | "system";
type View = "home" | "study" | "wrong" | "words" | "settings";
type Progress = Record<string, { mark: Mark; seen: number; updated: number }>;

const PROGRESS_KEY = "cet6-progress-v1";
const SETTINGS_KEY = "cet6-settings-v1";
const BG_DB = "cet6-background";

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function saveBackground(file?: File): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BG_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("images");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const tx = request.result.transaction("images", "readwrite");
      const store = tx.objectStore("images");
      if (file) store.put(file, "background");
      else store.delete("background");
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
  const [progress, setProgress] = useState<Progress>({});
  const [view, setView] = useState<View>("home");
  const [mode, setMode] = useState<Mode>("choice");
  const [theme, setTheme] = useState<Theme>("system");
  const [sessionSize, setSessionSize] = useState(50);
  const [session, setSession] = useState<Word[]>([]);
  const [index, setIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState("");
  const [spellingAnswer, setSpellingAnswer] = useState("");
  const [answered, setAnswered] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | Mark>("all");
  const [background, setBackground] = useState<string | null>(null);
  const [overlay, setOverlay] = useState(38);
  const [blur, setBlur] = useState(0);
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("./words.json").then((r) => r.json()).then(setWords);
    Promise.resolve().then(() => {
      try {
        setProgress(JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}"));
        const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
        if (saved.theme) setTheme(saved.theme);
        if (saved.sessionSize) setSessionSize(saved.sessionSize);
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
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme, sessionSize, overlay, blur }));
    return () => mq.removeEventListener("change", apply);
  }, [theme, sessionSize, overlay, blur]);

  const stats = useMemo(() => {
    const values = Object.values(progress);
    return {
      learned: values.length,
      known: values.filter((x) => x.mark === "known").length,
      fuzzy: values.filter((x) => x.mark === "fuzzy").length,
      unknown: values.filter((x) => x.mark === "unknown").length,
    };
  }, [progress]);

  const startStudy = (nextMode: Mode, wrongOnly = false) => {
    const source = wrongOnly
      ? words.filter((w) => progress[w.word]?.mark !== "known" && progress[w.word])
      : words;
    if (!source.length) return;
    setMode(nextMode);
    setSession(shuffle(source).slice(0, Math.min(sessionSize, source.length)));
    setIndex(0);
    setSelectedAnswer("");
    setSpellingAnswer("");
    setAnswered(false);
    setView("study");
  };

  const markWord = (mark: Mark) => {
    const current = session[index];
    if (!current) return;
    const next = {
      ...progress,
      [current.word]: { mark, seen: (progress[current.word]?.seen || 0) + 1, updated: Date.now() },
    };
    setProgress(next);
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(next));
    if (index < session.length - 1) {
      setIndex(index + 1);
      setSelectedAnswer("");
      setSpellingAnswer("");
      setAnswered(false);
    } else setView("home");
  };

  const changeBackground = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return alert("请选择图片文件");
    if (file.size > 12 * 1024 * 1024) return alert("图片请不要超过 12MB");
    if (background) URL.revokeObjectURL(background);
    setBackground(await saveBackground(file));
    event.target.value = "";
  };

  const removeBackground = async () => {
    if (background) URL.revokeObjectURL(background);
    setBackground(await saveBackground());
  };

  const filteredWords = useMemo(() => words.filter((item) => {
    const matches = `${item.word} ${item.meaning}`.toLowerCase().includes(query.toLowerCase());
    return matches && (filter === "all" || progress[item.word]?.mark === filter);
  }), [words, progress, query, filter]);

  const wrongWords = words.filter((w) => progress[w.word]?.mark === "fuzzy" || progress[w.word]?.mark === "unknown");
  const current = session[index];
  const choices = useMemo(() => {
    if (!current || mode !== "choice") return [];
    const distractors = shuffle(words.filter((item) => item.word !== current.word)).slice(0, 3);
    return shuffle([current, ...distractors]);
  }, [current, mode, words]);
  const answerCorrect = mode === "choice"
    ? selectedAnswer === current?.word
    : spellingAnswer.trim().toLowerCase() === current?.word.toLowerCase();
  const submitAnswer = () => {
    if (!current || answered || (mode === "choice" ? !selectedAnswer : !spellingAnswer.trim())) return;
    if (answerCorrect) markWord("known");
    else setAnswered(true);
  };
  const nextQuestion = () => markWord("unknown");
  const nav = (next: View) => { setView(next); setQuery(""); };

  return (
    <main className="app-shell">
      {background && <div className="custom-background" style={{ backgroundImage: `url(${background})`, filter: `blur(${blur}px) scale(1.03)` }} />}
      {background && <div className="background-overlay" style={{ opacity: overlay / 100 }} />}
      <aside className="sidebar">
        <button className="brand" onClick={() => nav("home")}><span>六</span><b>六级单词</b></button>
        <nav>
          <button className={view === "home" ? "active" : ""} onClick={() => nav("home")}><i>⌂</i>首页</button>
          <button className={view === "study" ? "active" : ""} onClick={() => startStudy("choice")}><i>▣</i>答题</button>
          <button className={view === "wrong" ? "active" : ""} onClick={() => nav("wrong")}><i>◇</i>错词本</button>
          <button className={view === "words" ? "active" : ""} onClick={() => nav("words")}><i>☷</i>单词列表</button>
          <button className={view === "settings" ? "active" : ""} onClick={() => nav("settings")}><i>⚙</i>设置</button>
        </nav>
        <div className="theme-switch" aria-label="切换主题">
          <button className={theme === "light" ? "selected" : ""} onClick={() => setTheme("light")}>☀</button>
          <button className={theme === "system" ? "selected" : ""} onClick={() => setTheme("system")}>自动</button>
          <button className={theme === "dark" ? "selected" : ""} onClick={() => setTheme("dark")}>☾</button>
        </div>
      </aside>

      <section className="content">
        {view === "home" && <>
          <header className="topbar"><div><p className="eyebrow">CET-6 VOCABULARY</p><h1>六级单词 <em>{words.length || "…"}词</em></h1></div><p>每天一点，慢慢把陌生变熟悉。</p></header>
          <section className="dashboard-grid">
            <article className="welcome-card"><span className="leaf">❧</span><p>今日学习</p><h2>{stats.learned ? "继续保持，你已经在进步了" : "从今天的第一个单词开始"}</h2><div className="stat-row"><b>{stats.learned}</b><span>已学习</span><b>{stats.known}</b><span>已掌握</span><b>{wrongWords.length}</b><span>待复习</span></div></article>
            <article className="progress-card"><div className="ring" style={{ "--percent": `${Math.min(100, Math.round(stats.learned / Math.max(words.length, 1) * 100)) * 3.6}deg` } as React.CSSProperties}><span>{Math.round(stats.learned / Math.max(words.length, 1) * 100)}%</span></div><div><p>词库总进度</p><h3>{stats.learned} <small>/ {words.length || 5651} 词</small></h3><div className="legend"><span>● 已掌握 {stats.known}</span><span>● 模糊 {stats.fuzzy}</span><span>● 不认识 {stats.unknown}</span></div></div></article>
            <button className="study-card en" onClick={() => startStudy("choice")}><span className="language-icon">A<small>?</small></span><div><h2>选择题</h2><p>根据英文选择正确的中文释义</p><b>开始答题 →</b></div></button>
            <button className="study-card zh" onClick={() => startStudy("spelling")}><span className="language-icon">中<small>✎</small></span><div><h2>拼写题</h2><p>根据中文释义拼写英文单词</p><b>开始答题 →</b></div></button>
            <button className="mini-card" onClick={() => nav("wrong")}><span>▱</span><div><h3>错词本</h3><p>{wrongWords.length} 个单词等待复习</p></div><b>›</b></button>
            <button className="mini-card" onClick={() => nav("words")}><span>☷</span><div><h3>单词列表</h3><p>搜索并浏览全部词汇</p></div><b>›</b></button>
          </section>
        </>}

        {view === "study" && current && <section className="study-view">
          <header className="page-head"><button onClick={() => nav("home")}>← 返回首页</button><span>{mode === "choice" ? "选择题" : "拼写题"} · {index + 1} / {session.length}</span></header>
          <div className="study-progress"><i style={{ width: `${(index + 1) / session.length * 100}%` }} /></div>
          <article className="flashcard">
            <p className="prompt-label">{mode === "choice" ? "请选择正确的中文释义" : "请根据中文释义拼写英文单词"}</p>
            <h2>{mode === "choice" ? current.word : current.meaning}</h2>
            {mode === "choice" ? <div className="choice-grid">{choices.map((item) => <button key={item.word} disabled={answered} className={`${selectedAnswer === item.word ? "selected" : ""} ${answered && item.word === current.word ? "correct" : ""} ${answered && selectedAnswer === item.word && item.word !== current.word ? "incorrect" : ""}`} onClick={() => setSelectedAnswer(item.word)}>{item.meaning}</button>)}</div> : <input className="spelling-input" disabled={answered} value={spellingAnswer} onChange={(event) => setSpellingAnswer(event.target.value)} onKeyDown={(event) => event.key === "Enter" && submitAnswer()} placeholder="输入英文单词" autoComplete="off" autoCapitalize="none" spellCheck={false} />}
            {!answered ? <button className="reveal" disabled={mode === "choice" ? !selectedAnswer : !spellingAnswer.trim()} onClick={submitAnswer}>提交答案</button> : <div className={`answer-result ${answerCorrect ? "correct" : "incorrect"}`}><strong>{answerCorrect ? "回答正确" : "回答错误"}</strong>{!answerCorrect && <span>正确答案：{mode === "choice" ? current.meaning : current.word}</span>}<button onClick={nextQuestion}>{index < session.length - 1 ? "下一题 →" : "完成本轮"}</button></div>}
          </article>
        </section>}

        {view === "wrong" && <section className="list-view"><header className="section-title"><div><p className="eyebrow">REVIEW</p><h2>错词本</h2><p>答错的单词都会自动加入这里。</p></div><button disabled={!wrongWords.length} onClick={() => startStudy("choice", true)}>选择题复习</button></header><WordTable items={wrongWords} progress={progress} /></section>}

        {view === "words" && <section className="list-view"><header className="section-title"><div><p className="eyebrow">ALL WORDS</p><h2>单词列表</h2><p>共 {words.length} 个单词，支持中英文搜索。</p></div></header><div className="filters"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索英文或中文释义…"/><select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}><option value="all">全部状态</option><option value="known">已掌握</option><option value="fuzzy">模糊</option><option value="unknown">不认识</option></select></div><WordTable items={filteredWords.slice(0, 300)} progress={progress} /><p className="table-tip">{filteredWords.length > 300 ? `结果较多，当前显示前 300 条（共 ${filteredWords.length} 条）` : `共 ${filteredWords.length} 条`}</p></section>}

        {view === "settings" && <section className="settings-view"><header className="section-title"><div><p className="eyebrow">PREFERENCES</p><h2>设置</h2><p>把学习页面调整成你喜欢的样子。</p></div></header>
          <article className="setting-card"><div><h3>白天与黑夜模式</h3><p>可以手动切换，也可以跟随电脑系统。</p></div><div className="segmented"><button className={theme === "light" ? "active" : ""} onClick={() => setTheme("light")}>☀ 白天</button><button className={theme === "system" ? "active" : ""} onClick={() => setTheme("system")}>跟随系统</button><button className={theme === "dark" ? "active" : ""} onClick={() => setTheme("dark")}>☾ 黑夜</button></div></article>
          <article className="setting-card"><div><h3>每轮题目数量</h3><p>选择一次想完成多少道题。</p></div><div className="segmented">{[10,20,50,100].map((n) => <button key={n} className={sessionSize === n ? "active" : ""} onClick={() => setSessionSize(n)}>{n}</button>)}</div></article>
          <article className="setting-card background-setting"><div><h3>自定义背景图片</h3><p>图片只保存在你的浏览器中，不会上传到服务器。最大 12MB。</p></div><div className="background-actions"><input ref={uploadRef} hidden type="file" accept="image/*" onChange={changeBackground}/><button className="upload" onClick={() => uploadRef.current?.click()}>选择本地图片</button>{background && <button onClick={removeBackground}>恢复默认</button>}</div>{background && <div className="sliders"><label>遮罩强度 <input type="range" min="0" max="85" value={overlay} onChange={(e) => setOverlay(+e.target.value)}/><b>{overlay}%</b></label><label>背景模糊 <input type="range" min="0" max="16" value={blur} onChange={(e) => setBlur(+e.target.value)}/><b>{blur}px</b></label></div>}</article>
        </section>}
      </section>
    </main>
  );
}

function WordTable({ items, progress }: { items: Word[]; progress: Progress }) {
  return <div className="word-table">{items.length ? items.map((item) => <div className="word-row" key={item.id}><strong>{item.word}</strong><span>{item.meaning}</span><em className={progress[item.word]?.mark || "new"}>{progress[item.word]?.mark === "known" ? "已掌握" : progress[item.word]?.mark === "fuzzy" ? "模糊" : progress[item.word]?.mark === "unknown" ? "不认识" : "未学习"}</em></div>) : <div className="empty">这里暂时没有单词。</div>}</div>;
}
