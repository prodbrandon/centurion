"use client";

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

/** Ask Centurion: a Meta Muse Spark analyst over the store's data, by text or voice. Read-only. */
export function Assistant({ suggestions, storeName }: { suggestions: string[]; storeName: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [voiceOk, setVoiceOk] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const log = useRef<HTMLDivElement>(null);

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
        body: JSON.stringify({ question: q, history })
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
    <section className="assistant" aria-label="Ask Centurion">
      <div className="assistant-head">
        <span className="assistant-mark" aria-hidden="true" />
        <span className="assistant-title">Ask Centurion</span>
        <span className="assistant-model">Meta Muse Spark · reads {storeName || "your store"}’s data · read-only</span>
      </div>

      {turns.length > 0 || busy ? (
        <div className="assistant-log" ref={log} aria-live="polite">
          {turns.map((t, i) => (
            <div key={i} className={`turn ${t.role}`}>
              {t.content.split("\n").filter(Boolean).map((line, j) => (
                <p key={j}>{line}</p>
              ))}
            </div>
          ))}
          {busy ? <div className="turn assistant thinking">Reading your store data…</div> : null}
        </div>
      ) : (
        <div className="assistant-chips">
          {suggestions.map(s => (
            <button key={s} type="button" className="chip" onClick={() => void ask(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        className="assistant-input"
        onSubmit={e => {
          e.preventDefault();
          void ask(draft);
        }}
      >
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={listening ? "Listening…" : "Ask about AI revenue, products, or what AI gets wrong"}
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
      {error ? <p className="assistant-error">{error}</p> : null}
      {turns.length > 0 && !busy ? (
        <button type="button" className="assistant-reset" onClick={() => setTurns([])}>
          New conversation
        </button>
      ) : null}
    </section>
  );
}
