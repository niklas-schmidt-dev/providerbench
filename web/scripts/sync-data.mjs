import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, "..");
const source = path.resolve(webRoot, "..", "data");
const target = path.join(webRoot, "data");

if (!existsSync(path.join(source, "report-manifest.json"))) {
  throw new Error(
    "data/report-manifest.json is missing; run `go run ./cmd/providerbench validate --manifest data/report-manifest.json data/results`",
  );
}

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
