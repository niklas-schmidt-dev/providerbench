import { createHash } from "node:crypto";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Copies the repository's dataset into the web app before a build. With
// PROVIDERBENCH_DATA_OVERLAY set to a directory of report files, those
// reports are added on top: a local preview of reports that are not
// published, and the fixture the browser tests run against. Overlay reports
// never rank, and a production build does not set the variable.

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, "..");
const source = path.resolve(webRoot, "..", "data");
const target = path.join(webRoot, "data");

for (const [file, command] of [
  ["report-manifest.json", "validate --manifest data/report-manifest.json data/results"],
  ["catalog.json", "list --json > data/catalog.json"],
]) {
  if (!existsSync(path.join(source, file))) {
    throw new Error(`data/${file} is missing; run \`go run ./cmd/providerbench ${command}\``);
  }
}

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });

// The same identity rules as lib/data.ts and the Go validator.
function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
}

function overlay(directory) {
  const manifestPath = path.join(target, "report-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const taken = new Set(manifest.reports.map((entry) => entry.file));
  const files = readdirSync(directory).filter((file) => file.endsWith(".json")).sort();
  if (files.length === 0) throw new Error(`PROVIDERBENCH_DATA_OVERLAY: no .json reports in ${directory}`);
  for (const file of files) {
    if (taken.has(file)) throw new Error(`overlay report ${file} has the name of a published report`);
    const raw = readFileSync(path.join(directory, file));
    const report = JSON.parse(raw.toString("utf8"));
    const category = report.category ?? "compute";
    writeFileSync(path.join(target, "results", file), raw);
    manifest.reports.push({
      file,
      sha256: createHash("sha256").update(raw).digest("hex"),
      schema_version: report.schema_version,
      protocol_version: report.protocol_version ?? slug(`${category}-cli-${report.cli_version}`),
      profile: report.profile ?? "standard",
      category,
      cohort_id: report.measurement?.campaign_id ?? "",
      rank_eligible: false,
      eligibility_reasons: ["overlay report, not part of the published dataset"],
    });
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`sync-data: added ${files.length} overlay reports from ${directory}`);
}

const overlayDir = process.env.PROVIDERBENCH_DATA_OVERLAY;
if (overlayDir) overlay(path.resolve(webRoot, overlayDir));
