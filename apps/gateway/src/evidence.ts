import { createHmac } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";

// Append-only, hash-chained evidence log. Each entry carries an HMAC over the previous
// entry's hash plus its own payload, so editing or deleting any line breaks the chain.
// This is the "what was this agent allowed to do, and what did it do" record that
// answers chargeback disputes and claim audits.

export interface EvidenceEntry {
  ts: string;
  agent_id: string;
  tier: string;
  subject: string | null;
  tool: string;
  args: unknown;
  decision: "allowed" | "denied" | "error";
  detail: string;
  rulebook_version: string;
}

const LOG_PATH = process.env.EVIDENCE_LOG ?? "evidence.jsonl";
const SECRET = process.env.EVIDENCE_SECRET ?? "dev-only-secret-change-me";

let lastHash = readLastHash();

function readLastHash(): string {
  if (!existsSync(LOG_PATH)) return "genesis";
  const lines = readFileSync(LOG_PATH, "utf8").trim().split("\n").filter(Boolean);
  const last = lines.at(-1);
  if (!last) return "genesis";
  try {
    return (JSON.parse(last) as { hash: string }).hash;
  } catch {
    throw new Error(`Evidence log ${LOG_PATH} has a corrupt last line; refusing to extend a broken chain.`);
  }
}

export function recordEvidence(entry: EvidenceEntry): string {
  const payload = JSON.stringify(entry);
  const hash = createHmac("sha256", SECRET).update(`${lastHash}|${payload}`).digest("hex");
  appendFileSync(LOG_PATH, `${JSON.stringify({ ...entry, prev_hash: lastHash, hash })}\n`);
  lastHash = hash;
  return hash;
}

export function verifyChain(path = LOG_PATH, secret = SECRET): { ok: boolean; entries: number; broken_at?: number } {
  if (!existsSync(path)) return { ok: true, entries: 0 };
  const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
  let prev = "genesis";
  for (const [i, line] of lines.entries()) {
    const { prev_hash, hash, ...entry } = JSON.parse(line) as EvidenceEntry & { prev_hash: string; hash: string };
    const expected = createHmac("sha256", secret).update(`${prev}|${JSON.stringify(entry)}`).digest("hex");
    if (prev_hash !== prev || hash !== expected) return { ok: false, entries: lines.length, broken_at: i };
    prev = hash;
  }
  return { ok: true, entries: lines.length };
}
