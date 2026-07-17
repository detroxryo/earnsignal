import { spawnSync } from "node:child_process";

const pattern = String.raw`(BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|PRIVATE_KEY\s*=|SECRET_KEY\s*=|seed phrase|mnemonic\s*=)`;
const result = spawnSync("rg", [
  "-n",
  "--hidden",
  "--glob", "!node_modules/**",
  "--glob", "!.git/**",
  "--glob", "!scripts/scan-secrets.mjs",
  pattern,
  ".",
], { stdio: "inherit" });

if (result.error) {
  console.error(`Secret scan could not start: ${result.error.message}`);
  process.exit(2);
}
if (result.status === 0) {
  console.error("Potential secret material found. Review every match before publishing.");
  process.exit(1);
}
if (result.status === 1) {
  console.log("Secret scan passed: no configured key patterns found.");
  process.exit(0);
}
process.exit(result.status ?? 2);
