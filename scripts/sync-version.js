const { readFileSync, writeFileSync } = require("fs");
const { resolve } = require("path");

const versionTsPath = resolve(__dirname, "..", "src", "shared", "version.ts");
const bpManifestPath = resolve(__dirname, "..", "behavior_pack", "manifest.json");
const rpManifestPath = resolve(__dirname, "..", "resource_pack", "manifest.json");

const src = readFileSync(versionTsPath, "utf8");
const match = src.match(/TAUUTILS_VERSION\s*=\s*"((\d+)\.(\d+)\.(\d+)(.*?))"/);
if (!match) {
  console.error("Could not parse version from src/shared/version.ts");
  process.exit(1);
}

const isDev = /IS_DEV\s*=\s*true/.test(src);

const fullVersion = match[1] + (isDev ? "-dev" : "");
const versionArr = [Number(match[2]), Number(match[3]), Number(match[4])];

function patchManifest(filePath) {
  const json = JSON.parse(readFileSync(filePath, "utf8"));
  json.header.version = versionArr;
  json.header.name = json.header.name.replace(
    /\d+(?:\.\d+)+(?:-[^\s"]*)?/,
    fullVersion
  );
  if (json.modules) {
    for (const mod of json.modules) {
      mod.version = versionArr;
    }
  }
  if (json.dependencies) {
    for (const dep of json.dependencies) {
      if (Array.isArray(dep.version)) {
        dep.version = versionArr;
      }
    }
  }
  writeFileSync(filePath, JSON.stringify(json, null, 2) + "\n");
  console.log(`  Patched ${filePath} -> [${versionArr.join(", ")}] "${json.header.name}"`);
}

console.log(`Syncing version ${versionArr.join(".")}${isDev ? "-dev" : ""} to manifests...`);
patchManifest(bpManifestPath);
patchManifest(rpManifestPath);
console.log("Done.");
