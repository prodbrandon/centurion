"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CHAT_ACTIONS, COMMAND_EVENT, COMMANDS, runCommand, type CommandId } from "@/lib/commands";
import { CardView, ReplyView, type Card, type Reply } from "./assistant/Cards";

type Turn =
  | { role: "user"; text: string }
  | { role: "bot"; reply: Reply }
  | { role: "card"; card: Card; label: string }
  | { role: "error"; text: string };

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
const speechCtor = () => {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

const SCREENS: Record<string, string> = { "/": "AI Sales", "/checkout-test": "Checkout Test", "/answer-check": "Answer Check", "/weekly-fix": "Weekly Fix" };
const OPEN_KEY = "centurion.assistant.open";
const SIZE_KEY = "centurion.assistant.expanded";
const SLASH = Object.fromEntries(COMMANDS.filter(c => c.slash).map(c => [c.slash!, c.id])) as Record<string, CommandId>;
const ACTION_LABEL = Object.fromEntries(COMMANDS.map(c => [c.id, c.label])) as Record<string, string>;

const remember = (key: string, on: boolean) => {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {}
};
const recall = (key: string) => {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
};
/** What the model sees of its own earlier replies: the text, not the charts. */
const asHistory = (turns: Turn[]) =>
  turns.flatMap((t): { role: "user" | "assistant"; content: string }[] =>
    t.role === "user" ? [{ role: "user" as const, content: t.text }] : t.role === "bot" ? [{ role: "assistant" as const, content: [t.reply.headline, ...t.reply.bullets].join("\n") }] : []
  );

/**
 * Ask Centurion: a Meta Muse Spark analyst over the store's data, in a corner launcher that pops out a chat
 * window. Answers come back as cards with charts; actions (draft and apply a fix, run checks, replay an agent
 * checkout, export orders) run inside the chat. Lives in the root layout, so the conversation survives tab changes.
 */
export function Assistant({ suggestions, storeName }: { suggestions: string[]; storeName: string }) {
  const reduce = useReducedMotion();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceOk, setVoiceOk] = useState(false);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [unread, setUnread] = useState(0);
  const [teaser, setTeaser] = useState<string | null>(null);
  const openRef = useRef(false);
  openRef.current = open;
  const rec = useRef<Recognition | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const screen = SCREENS[usePathname()] ?? "Centurion";

  useEffect(() => {
    setVoiceOk(Boolean(speechCtor()));
    // The chat always starts hidden; only its size is remembered.
    setExpanded(recall(SIZE_KEY));
  }, []);

  /** A reply or card that lands while the chat is closed raises a badge and a teaser on the launcher. */
  function notify(turn: Turn, text: string) {
    setTurns(t => [...t, turn]);
    if (!openRef.current) {
      setUnread(u => u + 1);
      setTeaser(text);
    }
  }

  // Proactive insight, once per browser session: prepare this week's fix and nudge the merchant.
  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem("centurion.assistant.nudged") === "1";
      sessionStorage.setItem("centurion.assistant.nudged", "1");
    } catch {}
    if (seen) return;
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "draft_fix" }) });
        const data = (await res.json()) as { card?: Card };
        if (res.ok && data.card && data.card.type === "fix") {
          const c = data.card;
          notify(
            { role: "card", card: c, label: "New · this week’s fix is ready" },
            `This week’s fix is ready: ${c.product}. ${c.finding ? `${c.finding.provider} tells shoppers “${c.finding.said}”` : ""}`
          );
        }
      } catch {}
    }, 3000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [turns, busy, reduce]);

  function show(next: boolean) {
    setOpen(next);
    remember(OPEN_KEY, next);
    if (next) {
      setUnread(0);
      setTeaser(null);
    }
    if (next) setTimeout(() => input.current?.focus(), 50);
    else launcher.current?.focus();
  }
  function toggleExpand() {
    setExpanded(e => {
      remember(SIZE_KEY, !e);
      return !e;
    });
  }

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    if (q.startsWith("/")) {
      const id = SLASH[q.split(/\s/)[0]!.toLowerCase()];
      setDraft("");
      if (id) runCommand(id);
      else setTurns(t => [...t, { role: "error", text: `Unknown command ${q}. Try ${Object.keys(SLASH).join(", ")}.` }]);
      return;
    }
    setDraft("");
    const history = asHistory(turns);
    setTurns(t => [...t, { role: "user", text: q }]);
    setBusy(true);
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q, history, screen }) });
      const data = (await res.json()) as { reply?: Reply; error?: string };
      if (!res.ok || !data.reply) throw new Error(data.error ?? "No answer came back.");
      notify({ role: "bot", reply: data.reply! }, data.reply!.headline);
    } catch (e) {
      setTurns(t => [...t, { role: "error", text: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setBusy(false);
    }
  }

  async function act(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const data = (await res.json()) as { card?: Card; error?: string };
      if (!res.ok || !data.card) throw new Error(data.error ?? "The action failed.");
      notify({ role: "card", card: data.card!, label: ACTION_LABEL[id] ?? id }, `${ACTION_LABEL[id] ?? id} is ready.`);
    } catch (e) {
      setTurns(t => [...t, { role: "error", text: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setBusy(false);
    }
  }

  function toggleVoice() {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const Ctor = speechCtor();
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
      if (e.error !== "aborted" && e.error !== "no-speech") setTurns(t => [...t, { role: "error", text: `Voice input stopped: ${e.error}.` }]);
    };
    r.onend = () => {
      setListening(false);
      if (finalText.trim()) void ask(finalText);
    };
    rec.current = r;
    setListening(true);
    r.start();
  }

  // Commands from the palette, keyboard shortcuts and slash commands.
  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent<CommandId>).detail;
      if (id === "open_chat") show(true);
      else if (id === "toggle_expand") {
        if (!open) show(true);
        toggleExpand();
      } else if (id === "new_chat") setTurns([]);
      else if (id === "voice") {
        if (!open) show(true);
        if (voiceOk && !busy) toggleVoice();
      } else if ((CHAT_ACTIONS as string[]).includes(id)) {
        if (!open) show(true);
        void act(id);
      }
    };
    window.addEventListener(COMMAND_EVENT, on);
    return () => window.removeEventListener(COMMAND_EVENT, on);
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open && !document.querySelector(".palette")) show(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const quick = [
    { id: "draft_fix", label: "Draft this week’s fix" },
    { id: "watch_checkout", label: "Watch an AI agent buy" },
    { id: "run_answer_check", label: "Run Answer Check" }
  ];
  const spring = reduce ? { duration: 0 } : { type: "spring" as const, stiffness: 420, damping: 34 };

  return (
    <>
      <AnimatePresence>
        {open ? (
          <motion.section
            key="chat"
            className={`assistant${expanded ? " expanded" : ""}`}
            role="dialog"
            aria-label="Ask Centurion"
            layout={!reduce}
            initial={reduce ? false : { opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? undefined : { opacity: 0, y: 16, scale: 0.96 }}
            transition={spring}
            style={{ transformOrigin: "bottom right" }}
          >
            <div className="assistant-head">
              <span className="assistant-mark" aria-hidden="true" />
              <span className="assistant-title">Ask Centurion</span>
              <span className="assistant-model">Muse Spark · on {screen}</span>
              <div className="assistant-actions">
                {turns.length > 0 && !busy ? (
                  <button type="button" className="icon-btn ghost" onClick={() => setTurns([])} aria-label="New conversation" title="New conversation (n)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </button>
                ) : null}
                <button
                  type="button"
                  className="icon-btn ghost"
                  onClick={toggleExpand}
                  aria-label={expanded ? "Shrink the chat" : "Expand the chat"}
                  title={expanded ? "Shrink (e)" : "Expand (e)"}
                  aria-pressed={expanded}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    {expanded ? <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" /> : <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />}
                  </svg>
                </button>
                <button type="button" className="icon-btn ghost" onClick={() => show(false)} aria-label="Close Ask Centurion" title="Close (Esc)">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="assistant-log" ref={log} aria-live="polite">
              {turns.length === 0 && !busy ? (
                <div className="assistant-empty">
                  <p className="assistant-intro">
                    Your AI commerce analyst for {storeName || "your store"}. Ask in plain words, or run an action. Answers come only from your
                    Centurion data.
                  </p>
                  <p className="assistant-label">Do it now</p>
                  <div className="quick">
                    {quick.map(a => (
                      <button key={a.id} type="button" className="act primary" onClick={() => void act(a.id)}>
                        {a.label} <span aria-hidden="true">→</span>
                      </button>
                    ))}
                  </div>
                  <p className="assistant-label">Ask</p>
                  <div className="assistant-chips">
                    {[`Explain the ${screen} screen`, ...suggestions].map(s => (
                      <button key={s} type="button" className="chip" onClick={() => void ask(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                  <p className="assistant-hint">
                    Type <kbd>/</kbd> for commands · <kbd>⌘K</kbd> for everything
                  </p>
                </div>
              ) : null}
              {turns.map((t, i) => (
                <motion.div
                  key={i}
                  className={`turn ${t.role}`}
                  initial={reduce ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  {t.role === "user" ? (
                    <p>{t.text}</p>
                  ) : t.role === "bot" ? (
                    <ReplyView reply={t.reply} onAction={id => void act(id)} busy={busy} />
                  ) : t.role === "card" ? (
                    <>
                      <p className="card-label">▸ {t.label}</p>
                      <CardView card={t.card} />
                    </>
                  ) : (
                    <p className="assistant-error">{t.text}</p>
                  )}
                </motion.div>
              ))}
              {busy ? (
                <div className="turn bot thinking" aria-label="Working">
                  <span className="dots">
                    <i />
                    <i />
                    <i />
                  </span>
                  Reading your store data
                </div>
              ) : null}
            </div>

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
                placeholder={listening ? "Listening…" : "Ask a question, or type / for commands"}
                aria-label="Ask Centurion a question"
                disabled={busy}
                list="centurion-slash"
              />
              <datalist id="centurion-slash">
                {Object.keys(SLASH).map(s => (
                  <option key={s} value={s} />
                ))}
              </datalist>
              {voiceOk ? (
                <button
                  type="button"
                  className={`icon-btn${listening ? " live" : ""}`}
                  onClick={toggleVoice}
                  aria-label={listening ? "Stop voice input" : "Ask by voice"}
                  aria-pressed={listening}
                  disabled={busy}
                  title="Voice (v)"
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
          </motion.section>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {!open && teaser ? (
          <motion.button
            key="teaser"
            type="button"
            className="assistant-teaser"
            onClick={() => show(true)}
            initial={reduce ? false : { opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? undefined : { opacity: 0, y: 8, scale: 0.96 }}
            transition={spring}
          >
            <span className="assistant-mark" aria-hidden="true" />
            <span>{teaser}</span>
          </motion.button>
        ) : null}
      </AnimatePresence>

      <motion.button
        ref={launcher}
        type="button"
        className={`assistant-launcher${open ? " open" : ""}${unread ? " unread" : ""}`}
        onClick={() => show(!open)}
        aria-expanded={open}
        aria-label={open ? "Close Ask Centurion" : unread ? `Open Ask Centurion, ${unread} new` : "Open Ask Centurion (press /)"}
        whileHover={reduce ? undefined : { y: -2 }}
        whileTap={reduce ? undefined : { scale: 0.96 }}
        animate={!reduce && unread && !open ? { rotate: [0, -6, 6, -4, 4, 0], y: [0, -6, 0, -3, 0] } : { rotate: 0, y: 0 }}
        transition={!reduce && unread && !open ? { duration: 0.9, repeat: Infinity, repeatDelay: 2.4 } : spring}
        layout={!reduce}
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
            {unread ? (
              <motion.span className="badge" key={unread} initial={reduce ? false : { scale: 0.4 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 600, damping: 18 }}>
                {unread}
              </motion.span>
            ) : (
              <kbd>/</kbd>
            )}
          </>
        )}
        {!open && unread && !reduce ? <span className="ping" aria-hidden="true" /> : null}
      </motion.button>
    </>
  );
}
