const { existsSync, readFileSync, cpSync, mkdirSync, rmSync } = require("fs");
const { resolve } = require("path");

const envPath = resolve(__dirname, "..", ".env");
let mcDev = "";

const skipDeploy = process.argv.includes("--skip-deploy");

if (existsSync(envPath)) {
  const env = readFileSync(envPath, "utf8");
  for (const line of env.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const eq = trimmed.indexOf("=");
      if (eq > 0 && trimmed.slice(0, eq).trim() === "DEPLOY_PATH") {
        mcDev = trimmed.slice(eq + 1).trim();
      }
    }
  }
}

if (!mcDev) {
  if (skipDeploy) {
    console.log("DEPLOY_PATH not set; --skip-deploy passed, skipping deploy.");
    process.exit(0);
  }
  console.error("DEPLOY_PATH not set in .env. Copy .env.example to .env and set your path.");
  process.exit(1);
}

const bpSrc = resolve(__dirname, "..", "behavior_pack");
const rpSrc = resolve(__dirname, "..", "resource_pack");
const bpDest = `${mcDev}/development_behavior_packs/TauUtils`;
const rpDest = `${mcDev}/development_resource_packs/TauUtils Resources`;

for (const [src, dest, name] of [[bpSrc, bpDest, "BP"], [rpSrc, rpDest, "RP"]]) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true, force: true });
  console.log(`Deployed ${name}: ${dest}`);
}
