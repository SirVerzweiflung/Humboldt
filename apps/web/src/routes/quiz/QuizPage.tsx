import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ensureAnonAuth } from "../../lib/supabase";
import { loadManifest, type Preset } from "../../lib/geo";
import { quizCreate, quizLoad, quizSave } from "../../lib/quiz";
import type { Quiz, QuizQuestion } from "../../lib/quizSchema";
import { errMsg } from "../../lib/errMsg";
import { QuestionEditor } from "./QuestionEditor";

const EDIT_CODE_KEY = "quiz_edit_code";

export function QuizPage() {
  const [presets, setPresets] = useState<Record<string, Preset> | null>(null);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Auth + presets + restore last-edited quiz.
  useEffect(() => {
    (async () => {
      try {
        await ensureAnonAuth();
        setPresets((await loadManifest()).presets);
        const saved = localStorage.getItem(EDIT_CODE_KEY);
        if (saved) {
          const q = await quizLoad(saved);
          if (q) setQuiz(q);
          else localStorage.removeItem(EDIT_CODE_KEY);
        }
      } catch (e) {
        setError(errMsg(e));
      }
    })();
  }, []);

  function open(q: Quiz) {
    localStorage.setItem(EDIT_CODE_KEY, q.quizcode);
    setQuiz(q);
    setSelected(0);
  }

  if (error) return <Centered><p className="rounded bg-pink px-3 py-2 text-sm">{error}</p></Centered>;
  if (!presets) return <Centered><p className="opacity-70">Loading…</p></Centered>;
  if (!quiz) return <QuizEntry onOpen={open} onError={setError} />;

  return (
    <Editor
      quiz={quiz}
      presets={presets}
      selected={selected}
      setSelected={setSelected}
      setQuiz={setQuiz}
      onClose={() => {
        localStorage.removeItem(EDIT_CODE_KEY);
        setQuiz(null);
      }}
    />
  );
}

// ── entry: new / open-by-code ───────────────────────────────────────────────
function QuizEntry({ onOpen, onError }: { onOpen: (q: Quiz) => void; onError: (e: string) => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [notFound, setNotFound] = useState(false);

  async function makeNew() {
    setBusy(true);
    try {
      const { quizcode } = await quizCreate();
      const q = await quizLoad(quizcode);
      if (q) onOpen(q);
    } catch (e) {
      onError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function openExisting(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotFound(false);
    try {
      const q = await quizLoad(code.trim());
      if (q) onOpen(q);
      else setNotFound(true);
    } catch (err) {
      onError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Centered>
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Quiz editor</h1>
          <Link to="/host" className="text-sm underline opacity-70">
            ← Host
          </Link>
        </div>

        <button
          onClick={makeNew}
          disabled={busy}
          className="rounded-lg bg-gunmetal px-6 py-3 text-lg font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Working…" : "New quiz"}
        </button>

        <form onSubmit={openExisting} className="flex flex-col gap-2">
          <span className="text-sm opacity-70">…or open an existing quiz by its quizcode</span>
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="quizcode"
              className="flex-1 rounded-lg border border-gunmetal/30 px-3 py-2 font-mono"
            />
            <button
              disabled={busy || code.trim().length < 8}
              className="rounded-lg bg-pacific px-4 py-2 font-semibold text-white disabled:opacity-50"
            >
              Open
            </button>
          </div>
          {notFound && <span className="text-xs text-pink">No quiz with that code.</span>}
        </form>
      </div>
    </Centered>
  );
}

// ── editor: master-detail ───────────────────────────────────────────────────
function Editor({
  quiz,
  presets,
  selected,
  setSelected,
  setQuiz,
  onClose,
}: {
  quiz: Quiz;
  presets: Record<string, Preset>;
  selected: number;
  setSelected: (i: number) => void;
  setQuiz: (q: Quiz) => void;
  onClose: () => void;
}) {
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  function setQuestions(questions: QuizQuestion[]) {
    setQuiz({ ...quiz, questions });
  }
  function newQuestion(): QuizQuestion {
    const first = Object.keys(presets)[0];
    return {
      prompt: "",
      surface_kind: "geo",
      surface_ref: first,
      surface_meta: { preset: first, bbox: presets[first].bbox, layers: Object.keys(presets[first].layers) },
      solution: null,
      label: "",
    };
  }
  function addQuestion() {
    setQuestions([...quiz.questions, newQuestion()]);
    setSelected(quiz.questions.length);
  }
  function deleteQuestion(i: number) {
    setQuestions(quiz.questions.filter((_, k) => k !== i));
    setSelected(Math.max(0, i - 1));
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= quiz.questions.length) return;
    const next = [...quiz.questions];
    [next[i], next[j]] = [next[j], next[i]];
    setQuestions(next);
    setSelected(j);
  }
  function patchSelected(patch: Partial<QuizQuestion>) {
    setQuestions(quiz.questions.map((q, k) => (k === selected ? { ...q, ...patch } : q)));
  }

  async function save() {
    setSaveState("saving");
    try {
      await quizSave(quiz.quizcode, quiz.title, quiz.questions);
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1500);
    } catch {
      setSaveState("error");
    }
  }
  function exportJson() {
    const blob = new Blob([JSON.stringify({ title: quiz.title, questions: quiz.questions }, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${quiz.title || "quiz"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const current = quiz.questions[selected];

  return (
    <div className="flex h-full w-full">
      {/* sidebar */}
      <aside className="flex w-72 flex-col gap-3 overflow-y-auto bg-wheat p-3">
        <input
          value={quiz.title}
          onChange={(e) => setQuiz({ ...quiz, title: e.target.value })}
          placeholder="Quiz name"
          className="rounded border border-gunmetal/30 bg-white p-2 font-semibold placeholder:font-normal placeholder:italic placeholder:text-gunmetal/40"
        />
        <QuizCodeRow code={quiz.quizcode} />
        <div className="flex gap-2">
          <button onClick={save} className="flex-1 rounded bg-gunmetal px-3 py-2 text-sm font-semibold text-white">
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved ✓" : saveState === "error" ? "Error" : "Save"}
          </button>
          <button onClick={exportJson} className="rounded bg-gunmetal/10 px-3 py-2 text-sm font-semibold">
            Export
          </button>
        </div>

        <div className="mt-2 flex flex-col gap-1">
          {quiz.questions.map((q, i) => (
            <div
              key={i}
              className={`flex items-center gap-1 rounded p-2 text-sm ${i === selected ? "bg-pacific text-white" : "bg-white"}`}
            >
              <button onClick={() => setSelected(i)} className="flex-1 truncate text-left">
                {i + 1}. {q.prompt || <span className="opacity-50">untitled</span>}{" "}
                <span className="opacity-60">({q.surface_kind === "geo" ? "map" : "img"})</span>
              </button>
              <button onClick={() => move(i, -1)} className="px-1" title="up">↑</button>
              <button onClick={() => move(i, 1)} className="px-1" title="down">↓</button>
              <button onClick={() => deleteQuestion(i)} className="px-1" title="delete">✕</button>
            </div>
          ))}
        </div>

        <button onClick={addQuestion} className="rounded border border-dashed border-gunmetal/40 p-2 text-sm font-semibold">
          + Add question
        </button>
        <button onClick={onClose} className="mt-auto text-xs underline opacity-70">
          Close quiz
        </button>
      </aside>

      {/* detail */}
      <main className="flex-1 overflow-hidden bg-white">
        {current ? (
          <QuestionEditor question={current} quizId={quiz.id} presets={presets} onChange={patchSelected} />
        ) : (
          <Centered><p className="opacity-60">Add a question to begin.</p></Centered>
        )}
      </main>
    </div>
  );
}

function QuizCodeRow({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded bg-white p-2 text-xs">
      <p className="mb-1 font-semibold">Quizcode — your only way back in. Save it.</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate">{code}</code>
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="rounded bg-gunmetal px-2 py-1 font-semibold text-white"
        >
          {copied ? "✓" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full w-full items-center justify-center p-6">{children}</div>;
}
