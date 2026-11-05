"use client";

import { runCommand } from "@/lib/commands";

/** Top-bar button for the command palette, so the shortcut is discoverable without knowing ⌘K. */
export function PaletteButton() {
  return (
    <button type="button" className="palette-btn" onClick={() => runCommand("help")} aria-label="Open the command palette">
      <span>Commands</span>
      <kbd>⌘K</kbd>
    </button>
  );
}
