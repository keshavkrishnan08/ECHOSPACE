// Copies the canonical model registry and exported weights from models/ into the web app's
// public directory so the browser engine loads exactly the artifacts that the Python side uses.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "apps/web/public/models");
mkdirSync(out, { recursive: true });
const files = [
  ["models/registry.json", "registry.json"],
  ["models/baselines/ridge_floor/weights.json", "ridge_floor/weights.json"],
];
for (const [src, dst] of files) {
  const from = join(root, src);
  if (!existsSync(from)) {
    console.warn(`[sync-models] missing ${src} — the corresponding model will show as unavailable`);
    continue;
  }
  mkdirSync(dirname(join(out, dst)), { recursive: true });
  cpSync(from, join(out, dst));
}
