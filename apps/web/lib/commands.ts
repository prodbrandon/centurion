// One registry for every shortcut: the command palette, keyboard keys and chat slash commands all read it.
export type CommandId =
  | "open_chat"
  | "toggle_expand"
  | "new_chat"
  | "voice"
  | "draft_fix"
  | "run_answer_check"
  | "watch_checkout"
  | "export_ai_orders"
  | "go_sales"
  | "go_checkout"
  | "go_answers"
  | "go_fix"
  | "palette"
  | "help";

export interface Command {
  id: CommandId;
  label: string;
  /** Keyboard shortcut shown in the palette ("g s" = press g, then s). */
  keys: string;
  /** Chat slash command, typed in the Ask Centurion box. */
  slash?: string;
  group: "Ask Centurion" | "Actions" | "Go to" | "Help";
}

export const COMMANDS: Command[] = [
  { id: "palette", label: "Command palette", keys: "⌘ K", group: "Help" },
  { id: "open_chat", label: "Open Ask Centurion", keys: "/", group: "Ask Centurion" },
  { id: "toggle_expand", label: "Expand or shrink the chat", keys: "e", slash: "/expand", group: "Ask Centurion" },
  { id: "new_chat", label: "New conversation", keys: "n", slash: "/clear", group: "Ask Centurion" },
  { id: "voice", label: "Ask by voice", keys: "v", slash: "/voice", group: "Ask Centurion" },
  { id: "draft_fix", label: "Draft this week’s fix", keys: "f", slash: "/fix", group: "Actions" },
  { id: "run_answer_check", label: "Run Answer Check", keys: "r", slash: "/check", group: "Actions" },
  { id: "watch_checkout", label: "Watch an AI agent buy", keys: "w", slash: "/checkout", group: "Actions" },
  { id: "export_ai_orders", label: "Export AI orders (CSV)", keys: "x", slash: "/export", group: "Actions" },
  { id: "go_sales", label: "Go to AI Sales", keys: "g s", group: "Go to" },
  { id: "go_checkout", label: "Go to Checkout Test", keys: "g c", group: "Go to" },
  { id: "go_answers", label: "Go to Answer Check", keys: "g a", group: "Go to" },
  { id: "go_fix", label: "Go to Weekly Fix", keys: "g w", group: "Go to" },
  { id: "help", label: "Show keyboard shortcuts", keys: "?", slash: "/help", group: "Help" }
];

export const ROUTES: Partial<Record<CommandId, string>> = { go_sales: "/", go_checkout: "/checkout-test", go_answers: "/answer-check", go_fix: "/weekly-fix" };
/** Commands that run inside the chat as actions (the same ids as the server's ACTIONS). */
export const CHAT_ACTIONS: CommandId[] = ["draft_fix", "run_answer_check", "watch_checkout", "export_ai_orders"];

export const COMMAND_EVENT = "centurion:command";
export const runCommand = (id: CommandId) => window.dispatchEvent(new CustomEvent<CommandId>(COMMAND_EVENT, { detail: id }));
