import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

// Scan the exact source set that would be committed, including new files in a
// remediation branch. Checking only already tracked files would miss a secret
// introduced before its first commit.
const tracked = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" }).split("\0").filter(Boolean);
const ignored = new Set([".env.example"]);
const forbidden = [
  { pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, label: "private key material" },
  { pattern: /\bDEMO_PAYER_SECRET\s*=\s*S[A-Z2-7]{55}\b/, label: "demo Stellar secret" },
  { pattern: /\bTESTNET_SINK_ADDRESS\s*=\s*G[A-Z2-7]{55}\b/, label: "Testnet sink address" },
  { pattern: /\bsk_live_[A-Za-z0-9_-]+/, label: "live secret key" },
];

const findings = [];
for (const file of tracked) {
  if (!existsSync(file) || ignored.has(file) || /.(?:jpg|jpeg|png|mp4|mp3|wav|woff2?)$/i.test(file)) continue;
  const content = readFileSync(file, "utf8");
  for (const rule of forbidden) {
    if (rule.pattern.test(content)) findings.push(`${file}: ${rule.label}`);
  }
}
if (findings.length) {
  process.stderr.write(`Release secret check failed:\n${findings.map((finding) => `- ${finding}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("Release secret check passed.\n");
