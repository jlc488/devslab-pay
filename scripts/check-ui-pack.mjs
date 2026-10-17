// Verifies that the published @devslab-kr/pay-ui tarball holds only its compiled output, its
// stylesheet and docs. Run after `npm run build` (packing skips lifecycle scripts so the JSON report
// is not mixed with build output). Publishes nothing.
import { execSync } from "node:child_process";

// Fixed command string (no interpolated input), so running it through the shell is safe on Windows too.
const report = execSync("npm pack --dry-run --json --ignore-scripts --workspace @devslab-kr/pay-ui", { encoding: "utf8" });
const [pack] = JSON.parse(report);
const files = pack.files.map((file) => file.path).sort();
console.log(`${pack.name}@${pack.version} (${pack.entryCount} files, ${pack.size} bytes packed)`);
for (const file of files) console.log(`  ${file}`);

const required = ["package.json", "README.md", "CHANGELOG.md", "dist/index.js", "dist/index.d.ts", "dist/styles.css"];
const allowed = (path) => required.includes(path) || /^dist\/[a-z-]+\.(?:js|d\.ts)$/.test(path);
const missing = required.filter((path) => !files.includes(path));
const unexpected = files.filter((path) => !allowed(path));
if (missing.length > 0 || unexpected.length > 0) {
  if (missing.length > 0) console.error(`Missing from package: ${missing.join(", ")}`);
  if (unexpected.length > 0) console.error(`Not allowed in package: ${unexpected.join(", ")}`);
  process.exit(1);
}
console.log("pay-ui package contents OK");
