"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Turn = { role: "user" | "assistant"; content: string };

// Minimal typing for the Web Speech API (Chrome, Edge, Safari); not in TypeScript's DOM lib.
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
};
type RecognitionCtor = new () => Recognition;

const SCREENS: Record<string, string> = { "/": "AI Sales", "/checkout-test": "Checkout Test", "/answer-check": "Answer Check", "/weekly-fix": "Weekly Fix" };
const OPEN_KEY = "centurion.assistant.open";

/**
 * Ask Centurion: a Meta Muse Spark analyst over the store's data, by text or voice. Read-only.
 * A launcher in the corner opens a chat window; it lives in the root layout, so the conversation
 * survives tab changes. "/" opens it, Esc closes it.
 */
export function Assistant({ suggestions, storeName }: { suggestions: string[]; storeName: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [voiceOk, setVoiceOk] = useState(false);
  const [open, setOpen] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const screen = SCREENS[usePathname()] ?? "Centurion";

  // Remember open/closed per browser; storage can be unavailable (private mode), so never depend on it.
  useEffect(() => {
    try {
      if (localStorage.getItem(OPEN_KEY) === "1") setOpen(true);
    } catch {}
  }, []);
  function show(next: boolean) {
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {}
    if (next) setTimeout(() => input.current?.focus(), 0);
    else launcher.current?.focus();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if (e.key === "/" && !typing && !open) {
        e.preventDefault();
        show(true);
      } else if (e.key === "Escape" && open) {
        show(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    setVoiceOk(Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition));
  }, []);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setError(null);
    setDraft("");
    const history = turns;
    setTurns([...history, { role: "user", content: q }]);
    setBusy(true);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history, screen })
      });
      const data = (await res.json()) as { answer?: string; error?: string };
      if (!res.ok || !data.answer) throw new Error(data.error ?? "No answer came back.");
      setTurns(t => [...t, { role: "assistant", content: data.answer! }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function toggleVoice() {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = "en-US";
    r.interimResults = true;
    r.continuous = false;
    let finalText = "";
    r.onresult = e => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i]![0]!.transcript;
        if (e.results[i]!.isFinal) finalText = text;
      }
      setDraft(text);
    };
    r.onerror = e => {
      if (e.error !== "aborted" && e.error !== "no-speech") setError(`Voice input stopped: ${e.error}.`);
    };
    r.onend = () => {
      setListening(false);
      if (finalText.trim()) void ask(finalText);
    };
    rec.current = r;
    setError(null);
    setListening(true);
    r.start();
  }

  return (
    <>
      {open ? (
        <section className="assistant" role="dialog" aria-label="Ask Centurion">
          <div className="assistant-head">
            <span className="assistant-mark" aria-hidden="true" />
            <span className="assistant-title">Ask Centurion</span>
            <span className="assistant-model">Muse Spark · on {screen}</span>
            <div className="assistant-actions">
              {turns.length > 0 && !busy ? (
                <button type="button" className="icon-btn ghost" onClick={() => setTurns([])} aria-label="New conversation" title="New conversation">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              ) : null}
              <button type="button" className="icon-btn ghost" onClick={() => show(false)} aria-label="Close Ask Centurion" title="Close (Esc)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          </div>

          <div className="assistant-log" ref={log} aria-live="polite">
            {turns.length === 0 && !busy ? (
              <>
                <p className="assistant-intro">
                  Ask anything about {storeName || "your store"}’s AI revenue, products and what AI assistants get wrong. Answers come only from
                  your Centurion data, with the numbers used. Read-only.
                </p>
                <div className="assistant-chips">
                  {[`Explain the ${screen} screen in 3 bullets`, ...suggestions].map(s => (
                    <button key={s} type="button" className="chip" onClick={() => void ask(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            {turns.map((t, i) => (
              <div key={i} className={`turn ${t.role === "user" ? "user" : "bot"}`}>
                {t.content.split("\n").filter(Boolean).map((line, j) => (
                  <p key={j}>{line}</p>
                ))}
              </div>
            ))}
            {busy ? <div className="turn bot thinking">Reading your store data…</div> : null}
          </div>

          {error ? <p className="assistant-error">{error}</p> : null}
          <form
            className="assistant-input"
            onSubmit={e => {
              e.preventDefault();
              void ask(draft);
            }}
          >
            <input
              ref={input}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder={listening ? "Listening…" : "Ask a question"}
              aria-label="Ask Centurion a question"
              disabled={busy}
            />
            {voiceOk ? (
              <button
                type="button"
                className={`icon-btn${listening ? " live" : ""}`}
                onClick={toggleVoice}
                aria-label={listening ? "Stop voice input" : "Ask by voice"}
                aria-pressed={listening}
                disabled={busy}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                </svg>
              </button>
            ) : null}
            <button type="submit" className="btn" disabled={busy || !draft.trim()}>
              Ask
            </button>
          </form>
        </section>
      ) : null}

      <button
        ref={launcher}
        type="button"
        className={`assistant-launcher${open ? " open" : ""}`}
        onClick={() => show(!open)}
        aria-expanded={open}
        aria-label={open ? "Close Ask Centurion" : "Open Ask Centurion (press /)"}
      >
        {open ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        ) : (
          <>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
            </svg>
            <span>Ask Centurion</span>
            <kbd>/</kbd>
          </>
        )}
      </button>
    </>
  );
}
