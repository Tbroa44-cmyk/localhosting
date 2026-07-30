const fs = require("fs");
const path = require("path");

const versionFile = path.join(__dirname, "..", "public", "version.json");

let version = { major: 1, minor: 0, patch: 0 };

try {
  const existing = JSON.parse(fs.readFileSync(versionFile, "utf8"));
  version = { major: existing.major || 1, minor: existing.minor || 0, patch: (existing.patch || 0) + 1 };
} catch {
  version.patch = 1;
}

fs.writeFileSync(versionFile, JSON.stringify(version, null, 2));
console.log(`Bumped to v${version.major}.${version.minor}.${version.patch}`);
