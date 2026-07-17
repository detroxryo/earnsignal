import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const ignoredDirectories = new Set([".git", ".wrangler", "coverage", "dist", "node_modules"]);
const maxFileBytes = 5 * 1024 * 1024;
const rules = [
  {
    name: "private-key-block",
    pattern: new RegExp(["BEGIN ", "(?:RSA|OPENSSH|EC)", " PRIVATE KEY"].join("")),
  },
  {
    name: "private-key-assignment",
    pattern: new RegExp(["PRIVATE", "_KEY", "\\s*=",].join(""), "i"),
  },
  {
    name: "secret-key-assignment",
    pattern: new RegExp(["SECRET", "_KEY", "\\s*=",].join(""), "i"),
  },
  {
    name: "seed-phrase",
    pattern: new RegExp(["seed", " phrase"].join(""), "i"),
  },
  {
    name: "mnemonic-assignment",
    pattern: new RegExp(["mnemonic", "\\s*=",].join(""), "i"),
  },
];

const findings = [];

function inspect(path) {
  const info = statSync(path, { throwIfNoEntry: false });
  if (!info || !info.isFile() || info.size > maxFileBytes) return;
  const buffer = readFileSync(path);
  if (buffer.includes(0)) return;
  const lines = buffer.toString("utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const rule of rules) {
      if (rule.pattern.test(line)) findings.push({ path: relative(root, path), line: index + 1, rule: rule.name });
    }
  });
}

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) walk(path);
    } else {
      inspect(path);
    }
  }
}

walk(root);

if (findings.length > 0) {
  for (const finding of findings) console.error(`${finding.path}:${finding.line} [${finding.rule}]`);
  console.error("Potential secret material found. Values are intentionally suppressed; review every location before publishing.");
  process.exit(1);
}

console.log("Secret scan passed: no configured key patterns found.");
