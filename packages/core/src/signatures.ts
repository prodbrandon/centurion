// The current AI source signature dataset, bundled at build time so it works in
// any runtime. It grows through `attribution discover` / `promote` in packages/attribution.
import raw from "../../attribution/data/signatures.json" with { type: "json" };
import { SignatureFileSchema, type SignatureFile } from "../../attribution/src/types.ts";

export const currentSignatures: SignatureFile = SignatureFileSchema.parse(raw);
