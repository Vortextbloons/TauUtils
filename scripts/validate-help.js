// CI check: every helpTopic used in src/commands/descriptors.ts must exist as
// a static topic in src/commands/help-topics.ts, otherwise getHelpLines()
// falls back to the index topic and the command is unreachable via help.
// Mirrors assertHelpTopicsCoverDescriptors() in help-topics.ts using regexes
// so it runs on source without a TS build step.
const { readFileSync } = require("fs");
const { resolve } = require("path");

const root = resolve(__dirname, "..");
const descriptorsSrc = readFileSync(resolve(root, "src", "commands", "descriptors.ts"), "utf8");
const helpSrc = readFileSync(resolve(root, "src", "commands", "help-topics.ts"), "utf8");

// Static topic keys: lines like `  "shop": [` or `  shop: [`.
const topicKeys = new Set(
  [...helpSrc.matchAll(/^\s{2}(?:"([^"\\]+)"|([A-Za-z0-9_]+)):\s*\[/gm)].map((m) => m[1] ?? m[2])
);

// Descriptor topics: d("tau:name", "description", "topic", ...) one call per line.
const usedTopics = new Set(
  [...descriptorsSrc.matchAll(/\bd\(\s*"tau:[^"]+"\s*,\s*"[^"]+"\s*,\s*"([^"\\]+)"/g)].map((m) => m[1])
);

const missing = [...usedTopics].filter((topic) => !topicKeys.has(topic));
if (missing.length > 0) {
  console.error(`Missing help topics for descriptors: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`Help topics OK: ${usedTopics.size} descriptor topics covered.`);
