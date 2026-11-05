// Reads a signature file from disk (CLI and tests). Kept apart from classify.ts so apps that bundle the
// classifier (apps/web, apps/shopify) don't pull a file read with a runtime path into their builds.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SignatureFileSchema, type SignatureFile } from "./types.ts";

const here = dirname(fileURLToPath(import.meta.url));

export function loadSignatures(path = process.env.AI_SIGNATURES ?? resolve(here, "..", "data", "signatures.json")): SignatureFile {
  return SignatureFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}
