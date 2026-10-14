// Copies canonical artifacts (model registry and weights, model cards, dataset manifests and
// documentation) into the web app's public directory so the browser reads exactly what is in
// the repository. The generated folders are git-ignored.
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "apps/web/public");

function copy(src, dst) {
  const from = join(root, src);
  if (!existsSync(from)) {
    console.warn(`[sync] missing ${src} — the corresponding feature will show as unavailable`);
    return false;
  }
  mkdirSync(dirname(join(pub, dst)), { recursive: true });
  cpSync(from, join(pub, dst));
  return true;
}

function copyDir(src, dst, ext) {
  const from = join(root, src);
  if (!existsSync(from)) return [];
  const files = readdirSync(from).filter((f) => f.endsWith(ext));
  for (const f of files) copy(join(src, f), join(dst, f));
  writeFileSync(join(pub, dst, "index.json"), JSON.stringify(files));
  return files;
}

copy("models/registry.json", "models/registry.json");
copy("models/baselines/ridge_floor/weights.json", "models/ridge_floor/weights.json");
copy("models/baselines/ridge_floor/metrics.json", "models/ridge_floor/metrics.json");
mkdirSync(join(pub, "models/cards"), { recursive: true });
copyDir("models/model_cards", "models/cards", ".md");
mkdirSync(join(pub, "datasets"), { recursive: true });
copyDir("datasets/manifests", "datasets", ".json");
mkdirSync(join(pub, "docs"), { recursive: true });
copyDir("docs", "docs", ".md");
