const { execSync } = require("child_process");
const { existsSync, readFileSync, mkdirSync, rmSync, renameSync } = require("fs");
const { resolve } = require("path");

const envPath = resolve(__dirname, "..", ".env");
let downloadPath = "";

if (existsSync(envPath)) {
  const env = readFileSync(envPath, "utf8");
  for (const line of env.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const eq = trimmed.indexOf("=");
      if (eq > 0 && trimmed.slice(0, eq).trim() === "DOWNLOAD_PATH") {
        downloadPath = trimmed.slice(eq + 1).trim();
      }
    }
  }
}

if (!downloadPath) {
  console.error("DOWNLOAD_PATH not set in .env. Copy .env.example to .env and set your path.");
  process.exit(1);
}

const bpPath = resolve(__dirname, "..", "behavior_pack");
const rpPath = resolve(__dirname, "..", "resource_pack");
const tempDir = resolve(__dirname, "..", "temp_release");
const outputPath = resolve(downloadPath, "TauUtils.mcaddon");

function ps(command) {
  execSync(`powershell -NoProfile -Command "${command}"`, { stdio: "pipe" });
}

if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
mkdirSync(tempDir, { recursive: true });

console.log("Zipping behavior pack...");
const bpZip = resolve(tempDir, "TauUtils_BP.zip");
ps(`Compress-Archive -Path '${bpPath}\\*' -DestinationPath '${bpZip}' -Force`);
const bpMcpack = bpZip.replace(/\.zip$/, ".mcpack");
renameSync(bpZip, bpMcpack);

console.log("Zipping resource pack...");
const rpZip = resolve(tempDir, "TauUtils_RP.zip");
ps(`Compress-Archive -Path '${rpPath}\\*' -DestinationPath '${rpZip}' -Force`);
const rpMcpack = rpZip.replace(/\.zip$/, ".mcpack");
renameSync(rpZip, rpMcpack);

console.log("Creating .mcaddon...");
const addonZip = resolve(tempDir, "TauUtils.zip");
ps(`Compress-Archive -Path '${bpMcpack}','${rpMcpack}' -DestinationPath '${addonZip}' -Force`);
renameSync(addonZip, outputPath);

rmSync(tempDir, { recursive: true });
console.log(`Created ${outputPath}`);
