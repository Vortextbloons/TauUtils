const { cpSync, mkdirSync, rmSync, readdirSync } = require("fs");
const { resolve } = require("path");

const mcDev = "C:/Users/isaac/AppData/Roaming/Minecraft Bedrock/Users/Shared/games/com.mojang";
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
