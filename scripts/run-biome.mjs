import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [command, ...options] = process.argv.slice(2);
if (command !== "check" && command !== "lint") {
  console.error("usage: node scripts/run-biome.mjs <check|lint> [biome options]");
  process.exit(2);
}

const supportedExtension = /\.(?:cjs|js|json|jsonc|jsx|mjs|ts|tsx)$/;
const excludedPrefix = /^(?:\.awf|\.claude|\.pi|docs)\//;
const targets = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean)
  .filter((path) => existsSync(path))
  .filter((path) => supportedExtension.test(path))
  .filter((path) => !excludedPrefix.test(path))
  .filter((path) => path !== "package-lock.json");

if (targets.length === 0) {
  console.error(
    "Biome target assertion failed: no repository executable-resource files were selected.",
  );
  process.exit(1);
}

const biome = fileURLToPath(import.meta.resolve("@biomejs/biome/bin/biome"));
const result = spawnSync(biome, [command, ...options, ...targets], {
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
if (result.signal) {
  console.error(`Biome terminated by signal ${result.signal}.`);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);

const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
const checkedMatch = output.match(/Checked (\d+) files?\b/);
const checked = checkedMatch ? Number.parseInt(checkedMatch[1], 10) : Number.NaN;
if (checked !== targets.length) {
  console.error(
    `Biome target assertion failed: selected ${targets.length} repository executable-resource files but Biome reported ${checkedMatch ? checked : "no checked-file count"}.`,
  );
  process.exit(1);
}

console.log(
  `Biome target assertion passed: checked ${checked} repository executable-resource files.`,
);
