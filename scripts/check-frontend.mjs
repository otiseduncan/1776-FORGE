// Syntax-checks every frontend ES module without a bundler.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (p.includes("vendor")) continue;
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".js")) files.push(p);
  }
})("public");
for (const f of files) execFileSync(process.execPath, ["--check", f], { stdio: "inherit" });
console.log(`Frontend syntax OK (${files.length} modules)`);
