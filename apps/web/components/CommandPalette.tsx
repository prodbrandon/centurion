"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { COMMAND_EVENT, COMMANDS, ROUTES, runCommand, type Command, type CommandId } from "@/lib/commands";

const SINGLE: Record<string, CommandId> = Object.fromEntries(COMMANDS.filter(c => c.keys.length === 1 && c.keys !== "/" && c.keys !== "?").map(c => [c.keys, c.id]));
const GO: Record<string, CommandId> = Object.fromEntries(COMMANDS.filter(c => c.keys.startsWith("g ")).map(c => [c.keys.slice(2), c.id]));

const typingIn = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/**
 * ⌘K command palette plus every keyboard shortcut: "/" chat, "g s/c/a/w" go to a screen, single keys for
 * chat actions, "?" for the list. Shortcuts never fire while typing in a field.
 */
export function CommandPalette() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const pendingG = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = (c: Command) => {
    setOpen(false);
    setQuery("");
    if (c.id === "palette") return setOpen(true);
    if (c.id === "help") return openPalette("");
    const route = ROUTES[c.id];
    if (route) router.push(route);
    else runCommand(c.id);
  };
  function openPalette(q: string) {
    setQuery(q);
    setIndex(0);
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 30);
  }

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return COMMANDS.filter(c => c.id !== "palette" && (!q || `${c.label} ${c.group} ${c.slash ?? ""}`.toLowerCase().includes(q)));
  }, [query]);

  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent<CommandId>).detail;
      if (id === "help" || id === "palette") openPalette("");
    };
    window.addEventListener(COMMAND_EVENT, on);
    return () => window.removeEventListener(COMMAND_EVENT, on);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        return open ? setOpen(false) : openPalette("");
      }
      if (open) {
        if (e.key === "Escape") setOpen(false);
        else if (e.key === "ArrowDown") {
          e.preventDefault();
          setIndex(i => Math.min(i + 1, results.length - 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setIndex(i => Math.max(i - 1, 0));
        } else if (e.key === "Enter" && results[index]) {
          e.preventDefault();
          run(results[index]!);
        }
        return;
      }
      if (typingIn(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (pendingG.current !== null) {
        window.clearTimeout(pendingG.current);
        pendingG.current = null;
        const id = GO[e.key.toLowerCase()];
        if (id) {
          e.preventDefault();
          router.push(ROUTES[id]!);
        }
        return;
      }
      if (e.key === "g") {
        pendingG.current = window.setTimeout(() => (pendingG.current = null), 900);
      } else if (e.key === "/") {
        e.preventDefault();
        runCommand("open_chat");
      } else if (e.key === "?") {
        e.preventDefault();
        openPalette("");
      } else if (SINGLE[e.key.toLowerCase()]) {
        e.preventDefault();
        runCommand(SINGLE[e.key.toLowerCase()]!);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  let lastGroup = "";
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="palette-backdrop"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduce ? undefined : { opacity: 0 }}
          onMouseDown={e => e.target === e.currentTarget && setOpen(false)}
        >
          <motion.div
            className="palette"
            role="dialog"
            aria-label="Command palette"
            initial={reduce ? false : { opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? undefined : { opacity: 0, y: -12, scale: 0.98 }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 36 }}
          >
            <input
              ref={inputRef}
              value={query}
              onChange={e => {
                setQuery(e.target.value);
                setIndex(0);
              }}
              placeholder="Type a command or search…"
              aria-label="Search commands"
              role="combobox"
              aria-expanded="true"
              aria-controls="palette-list"
              aria-activedescendant={results[index] ? `cmd-${results[index]!.id}` : undefined}
            />
            <ul id="palette-list" role="listbox">
              {results.map((c, i) => {
                const head = c.group !== lastGroup ? c.group : null;
                lastGroup = c.group;
                return (
                  <li key={c.id} role="presentation">
                    {head ? <p className="palette-group">{head}</p> : null}
                    <button
                      id={`cmd-${c.id}`}
                      type="button"
                      role="option"
                      aria-selected={i === index}
                      className={i === index ? "on" : ""}
                      onMouseEnter={() => setIndex(i)}
                      onClick={() => run(c)}
                    >
                      <span>{c.label}</span>
                      <span className="palette-keys">
                        {c.slash ? <code>{c.slash}</code> : null}
                        {c.keys.split(" ").map(k => (
                          <kbd key={k}>{k}</kbd>
                        ))}
                      </span>
                    </button>
                  </li>
                );
              })}
              {results.length === 0 ? <li className="palette-empty">No command matches “{query}”.</li> : null}
            </ul>
            <p className="palette-foot">
              <kbd>↑</kbd>
              <kbd>↓</kbd> to move · <kbd>Enter</kbd> to run · <kbd>Esc</kbd> to close
            </p>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
