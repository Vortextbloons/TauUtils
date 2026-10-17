// Exercise real TypeScript boundaries with deterministic Bedrock API doubles.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const esbuild = require("esbuild");
const root = path.resolve(__dirname, "..");

function load(file, mocks, expose = []) {
  file = file.replaceAll("\\", "/");
  const source = (process.argv.includes("--baseline") ? require("node:child_process").execFileSync("git", ["show", "HEAD:" + file], { cwd: root, encoding: "utf8" }) : fs.readFileSync(path.join(root, file), "utf8")) +
    (expose.length ? `\nexport { ${expose.join(", ")} };` : "");
  const { code } = esbuild.transformSync(source, { loader: "ts", format: "cjs", target: "es2022" });
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, console,
    require(id) {
      if (id in mocks) return mocks[id];
      if (id.startsWith(".")) return load(path.relative(root, path.resolve(root, path.dirname(file), id)) + ".ts", mocks);
      throw new Error(`Unmocked dependency ${id}`);
    },
  }, { filename: file });
  return module.exports;
}

class Stack {
  constructor(amount) { this.amount = amount; this.typeId = "minecraft:stone"; }
  clone() { return new Stack(this.amount); }
  isStackableWith(other) { return other.typeId === this.typeId; }
}

function container(amount = 63) {
  return {
    size: 1, slots: [new Stack(amount)],
    getItem(slot) { return this.slots[slot]?.clone(); },
    setItem(slot, stack) { this.slots[slot] = stack?.clone(); },
    addItem(stack) {
      const fits = Math.min(64 - (this.slots[0]?.amount ?? 0), stack.amount);
      this.slots[0] = new Stack((this.slots[0]?.amount ?? 0) + fits);
      return fits < stack.amount ? new Stack(stack.amount - fits) : undefined;
    },
  };
}

async function shops() {
  const inventory = container();
  const shop = { id: "shop", ownerPlayerId: "seller", visibility: "public", listingIds: ["listing"] };
  const listing = { id: "listing", shopId: "shop", sellerPlayerId: "seller", quantity: 2, pricePerUnit: 10, currencyObjective: "money", item: {}, title: "Stone" };
  const state = { playerShops: { config: { enabled: true }, shops: { shop }, listings: { listing }, earningsByPlayerId: {} } };
  let balance = 100;
  const menu = { button() { return this; }, async show() { return { canceled: false, value: { listingId: "listing" } }; } };
  const core = load("src/player-shops/core.ts", {
    "@minecraft/server": {}, "../ui": { TauUi: { action: () => menu } },
    "../shared/item-serialization": { deserializeItemStack: () => new Stack(2) },
    "../types": { ICONS: {} },
    "../storage": { state, getInventoryContainer: () => inventory, getPlayerId: () => "buyer", isFeatureActive: () => true,
      getScore: () => balance, setScore: (_p, _o, n) => { balance = n; return true; }, journalHead: () => 0,
      journalAppend() {}, journalAck() {}, savePlayerShops() {}, tell() {} },
  }, ["purchaseListing", "openListingCancelFlow"]);
  assert.equal(core.purchaseListing({}, listing).ok, false);
  assert.equal(inventory.slots[0].amount, 63, "partial purchase must roll back merged items");
  assert.equal(balance, 100);
  await core.openListingCancelFlow({}, shop);
  assert.equal(inventory.slots[0].amount, 63, "partial cancellation must roll back escrow return");
  assert.ok(state.playerShops.listings.listing);
  inventory.slots[0].amount = 60;
  assert.equal(core.purchaseListing({}, listing).ok, true);
  assert.equal(balance, 80);
  assert.equal(inventory.slots[0].amount, 62);
  assert.equal(state.playerShops.listings.listing, undefined);
  console.log("PASS shop partial purchase/cancel rollback and successful purchase");
}

function dynamicStorage() {
  const values = new Map();
  let fail = false;
  const world = {
    getDynamicProperty: (key) => values.get(key), getDynamicPropertyIds: () => [...values.keys()],
    setDynamicProperty(key, value) {
      if (fail && key.includes(":chunk:") && key.endsWith(":1")) throw new Error("interrupted write");
      if (value === undefined) values.delete(key); else values.set(key, value);
    },
  };
  const core = load("src/storage/dynamic-json.ts", { "@minecraft/server": { world }, "../types": { STORAGE_KEYS: {} } });
  const first = { text: "🧪".repeat(20000) };
  assert.equal(core.writeDynamicJSON("tau:test", first), true);
  assert.equal(core.readDynamicJSON("tau:test", {}).text, first.text);
  fail = true;
  assert.equal(core.writeSplitDynamicJson("tau:test", { text: "new".repeat(25000) }), false);
  assert.equal(core.readDynamicJSON("tau:test", {}).text, first.text, "interrupted generation must retain committed data");
  fail = false;
  assert.equal(core.writeDynamicJSON("tau:test", { text: "small" }), true);
  assert.equal(core.readDynamicJSON("tau:test", {}).text, "small");
  values.set("tau:bad:chunks", 1); values.set("tau:bad:chunk:0", "{bad");
  assert.equal(core.readSplitDynamicJson("tau:bad", {}).hasSplitData, false);
  core.clearSplitDynamicJson("tau:test");
  assert.equal([...values.keys()].some((key) => key.startsWith("tau:test:")), false);
  console.log("PASS oversized UTF-8 saves, interrupted generations, malformed chunks and cleanup");
}

function stats() {
  const values = new Map([["tau:stats", "legacy"]]);
  const state = { stats: { playerIds: { A: "a", B: "b" }, players: { a: { kills: 1 }, b: { kills: 7 } } } };
  let failedPlayer = "b";
  for (let i = 0; i < 2000; i++) state.stats.playerIds["LongPlayerName" + i] = "a";
  const world = {
    getDynamicProperty: (k) => values.get(k), getDynamicPropertyIds: () => [...values.keys()],
    setDynamicProperty(k, v) {
      if (k === "tau:stats:player:" + failedPlayer) throw new Error("player write failed");
      if (v === undefined) values.delete(k); else values.set(k, v);
    },
  };
  const dynamic = load("src/storage/dynamic-json.ts", { "@minecraft/server": { world }, "../types": { STORAGE_KEYS: {} } });
  const core = load("src/storage/split-keys/stats.ts", {
    "@minecraft/server": { system: { runTimeout() {}, clearJob() {} }, world },
    "../dynamic-json": dynamic,
    "../manifests": { updateManifestAfterSplitWrite: () => true }, "../state": { state }, "../defaults": {},
  });
  core.markAllStatsPlayersDirty(); core.markStatsPlayerDirty("a");
  assert.equal(core.flushStatsDirtySync(), false);
  assert.ok(values.has("tau:stats"), "migration backup survives a failed record");
  failedPlayer = "none";
  assert.equal(core.flushStatsDirtySync(), true);
  assert.equal(values.has("tau:stats"), false);
  assert.equal(JSON.parse(values.get("tau:stats:player:b")).kills, 7);
  const loaded = core.loadStatsFromSplitKeys([...values.keys()]);
  assert.equal(Object.keys(loaded.store.playerIds).length, 2002, "oversized name index must reload through committed chunks");
  console.log("PASS full stats migration, failed-write retry and oversized player index reload");
}

function combat() {
  const values = new Map(), deferred = [], jobs = [], drops = [];
  let restricted = true;
  const inventory = container(12);
  const setItem = inventory.setItem;
  inventory.setItem = function (...args) { if (restricted) throw new Error("restricted"); return setItem.apply(this, args); };
  const player = { name: "Fighter", isValid: true, location: { x: 1, y: 70, z: 2 }, dimension: { id: "overworld" }, getComponent: () => undefined };
  const tags = new Map([["fighter", { expiresAt: Date.now() + 10000 }]]);
  const world = { getDynamicProperty: (key) => values.get(key), getDynamicPropertyIds: () => [...values.keys()],
    setDynamicProperty(k, v) { assert.equal(restricted, false); if (v === undefined) values.delete(k); else values.set(k, v); },
    getDimension: () => ({ spawnItem: (stack) => drops.push(stack.amount) }), sendMessage() {} };
  const core = load("src/combat/core.ts", {
    "@minecraft/server": { world, EquipmentSlot: {}, EntityComponentTypes: {}, system: { run: (fn) => deferred.push(fn), runJob: (job) => { jobs.push(job); return jobs.length; }, clearJob() {} } },
    "../storage": { getPlayerId: () => "fighter", getInventoryContainer: () => inventory, state: { combat: { config: {} } }, tell() {}, journalAck() {}, journalHead: () => 0 },
    "../storage/dynamic-json": { safeSetDynamicJson(k, v) { world.setDynamicProperty(k, JSON.stringify(v)); return true; }, readDynamicJSON: (k, fallback) => values.has(k) ? JSON.parse(values.get(k)) : fallback },
    "../shared/item-serialization": { serializeItemStack: (stack) => ({ amount: stack.amount }), deserializeItemStack: (data) => new Stack(data.amount) },
    "../sidebar": {}, "../command-builder": {}, "../shared/templates": {},
    "./status": { combatTagsByPlayerId: tags, hasActiveCombatTag: () => true, isCombatFeatureActive: () => true },
  });
  core.handleCombatLeave(player);
  assert.equal(inventory.slots[0].amount, 12);
  assert.equal(drops.length, 0);
  assert.equal(values.size, 0, "restricted leave must perform no storage writes");
  restricted = false;
  deferred.splice(0).forEach((fn) => fn());
  assert.equal(drops.length, 0, "persisted punishment intent must not drop copied inventory");
  core.handleCombatJoin(player);
  jobs.splice(0).forEach((job) => { for (const _ of job) {} });
  assert.equal(inventory.slots[0], undefined);
  assert.deepEqual(drops, [12]);
  core.handleCombatJoin(player);
  jobs.splice(0).forEach((job) => { for (const _ of job) {} });
  assert.deepEqual(drops, [12], "a settled rejoin must not drop twice");
  inventory.slots[0] = new Stack(5); restricted = true;
  assert.equal(core.dropCombatInventory(player), false);
  assert.equal(inventory.slots[0].amount, 5);
  assert.deepEqual(drops, [12], "failed removal must not create drops");
  console.log("PASS restricted combat logout, writable rejoin and failed-removal guard");
}

function identity() {
  const deferred = [], state = { stats: { playerIds: { Old: "owner" }, players: { owner: {} } } };
  const core = load("src/storage/players.ts", {
    "@minecraft/server": { system: { run: (fn) => deferred.push(fn) } }, "../teams": {}, "./state": { state },
    "./defaults": { defaultPlayerStats: () => ({}) }, "./identity": { recordPlayerIdentity() {} },
    "./split-keys/stats": { markStatsPlayerDirty() {}, markStatsPlayerIdsDirty() {} }, "./save": {},
    "./helpers": { normalizeKey: (s) => s.toLowerCase() },
  });
  const owner = { id: "entity1", name: "Old", isValid: true, stored: undefined,
    getDynamicProperty() { return this.stored; }, setDynamicProperty(_k, value) { this.stored = value; } };
  assert.equal(core.getPlayerId(owner), "owner");
  deferred.splice(0).forEach((fn) => fn());
  owner.name = "New";
  assert.equal(core.getPlayerId(owner), "owner");
  assert.equal(state.stats.playerIds.Old, undefined);
  const newcomer = { ...owner, id: "entity2", name: "Old", stored: undefined };
  assert.notEqual(core.getPlayerId(newcomer), "owner");
  console.log("PASS rename continuity and abandoned-name ownership isolation");
}

function spatial() {
  const { createSpatialLookup } = load("src/shared/spatial-lookup.ts", {});
  const entries = [
    { dimensionId: "a", min: { x: -100000, z: -100000 }, max: { x: 100000, z: 100000 } },
    { dimensionId: "a", min: { x: -1, z: -1 }, max: { x: 1, z: 1 } },
    { dimensionId: "b", min: { x: -1, z: -1 }, max: { x: 1, z: 1 } },
  ];
  const query = createSpatialLookup(entries, (entry) => entry);
  assert.deepEqual(Array.from(query({ x: 0, z: 0 }, "a")), entries.slice(0, 2));
  assert.equal(query({ x: 1000, z: 1000 }, "a").length, 1);
  assert.equal(query({ x: 0, z: 0 }, "missing").length, 0);
  console.log("PASS spatial priority, large bounds and dimension isolation");
}

function placement() {
  let beforeInteract;
  const signal = { subscribe() {} };
  const events = new Proxy({}, { get: () => signal });
  const storage = { isFeatureEnabled: () => false, getInventoryContainer: () => undefined, tell() {} };
  const core = load("src/events/interaction-events.ts", {
    "@minecraft/server": { BlockTypes: { get: (id) => id === "minecraft:stone" ? { id } : undefined },
      Direction: { East: "east" }, system: { afterEvents: events },
      world: { afterEvents: events, beforeEvents: { playerInteractWithBlock: { subscribe: (fn) => { beforeInteract = fn; } }, playerBreakBlock: signal } } },
    "../generators": {}, "../crates": {}, "../tau-items": {},
    "../custom-areas": { shouldCancelAreaBlockPlace: () => false, shouldCancelAreaItemUse: () => false },
    "../claims": { shouldCancelClaimBlockPlace: (_p, target) => target.x === 1, shouldCancelClaimItemUse: () => false },
    "../loot-chests": {}, "../moderation/banned-items": {}, "../storage": storage, "../loot-chests/core": {},
  });
  core.registerInteractionEvents();
  const event = { cancel: false, itemStack: { typeId: "minecraft:stone" }, player: { dimension: { id: "overworld" } },
    block: { location: { x: 0, y: 70, z: 0 }, dimension: { id: "overworld" } }, blockFace: "east" };
  beforeInteract(event);
  assert.equal(event.cancel, true, "ordinary placement must be canceled at a protected adjacent cell");
  event.cancel = false; event.itemStack.typeId = "minecraft:stick";
  beforeInteract(event);
  assert.equal(event.cancel, false, "non-placeable item interactions must remain allowed");
  event.cancel = false; event.itemStack.typeId = "minecraft:stone"; event.block.getComponent = () => ({});
  beforeInteract(event);
  assert.equal(event.cancel, false, "opening a container while holding a block must remain allowed");
  console.log("PASS supported placement denial, non-placeable items and container interaction controls");
}

function generators() {
  let deniedY = 70, edits = 0;
  const inventory = container(1), definition = { id: "gen", name: "Generator", placeAnywhere: true };
  const state = { generators: { config: { enabled: true }, placed: {} } };
  const player = { selectedSlotIndex: 0, getComponent: () => ({ container: inventory }) };
  const core = load("src/generators/operations.ts", {
    "@minecraft/server": { Direction: {}, BlockPermutation: { resolve: (id) => id }, world: {
      getDimension: () => ({ getBlock: (point) => ({ typeId: "minecraft:air", isAir: true, setPermutation() { edits++; } }) }),
    } },
    "../storage": { state, getPlayerId: () => "owner", isFeatureEnabled: () => true, isOperator: () => false, saveGenerators() {} },
    "../teams": {}, "../plots": { getPlotForLocation: () => undefined, getPlotOwnerIdForPlayer: () => "owner", savePlotAtLocation() {} },
    "../claims": { shouldCancelClaimBlockPlace: (_p, target) => target.y === deniedY, shouldCancelClaimBlockBreak: () => false },
    "../custom-areas": { shouldCancelAreaBlockPlace: () => false, shouldCancelAreaBlockBreak: () => false },
    "../shared/item-components": {},
    "./definitions": { getDefinitionByStack: () => definition, isGeneratorAdminProtected: () => false, getMaxTier: () => 1,
      readGeneratorItemData: () => ({ tier: 1 }), getTier: () => ({ rateTicks: 100 }), normalizeItemId: (id) => id },
    "./output-pick": { pickGeneratorOutput: () => "minecraft:stone" },
  });
  const location = { x: 0, y: 70, z: 0 };
  assert.equal(core.placeGenerator(player, location, "overworld", new Stack(1)).ok, false);
  assert.equal(edits, 0);
  deniedY = 71;
  assert.equal(core.placeGenerator(player, location, "overworld", new Stack(1)).ok, false);
  assert.equal(edits, 0, "denied output must prevent both world edits");
  deniedY = -1;
  assert.equal(core.placeGenerator(player, location, "overworld", new Stack(1)).ok, true);
  assert.equal(edits, 2);
  assert.equal(inventory.slots[0], undefined);
  console.log("PASS generator base/output permission boundaries and allowed placement");
}

function wipe() {
  const values = new Map([["tau:referrals:chunk:0", "old"], ["tau:combat:logout:p", "old"], ["tau:combat:penalty:p", "old"], ["other:data", "keep"]]);
  let resets = 0;
  const hooks = new Proxy({}, { get: () => () => { resets++; } });
  const mocks = {
    "@minecraft/server": { world: { getDynamicPropertyIds: () => [...values.keys()], setDynamicProperty(k, v) { if (v === undefined) values.delete(k); else values.set(k, v); } } },
    "../types": { STORAGE_KEYS: { referrals: "tau:referrals", moderation: "tau:moderation" } },
    "./state": { state: {} }, "./defaults": new Proxy({}, { get: () => () => ({}) }),
    "./dynamic-json": { clearSplitDynamicJson() {} },
  };
  for (const id of ["./save", "./split-keys/stats", "../combat/core", "../claims", "../custom-areas", "../plots/build", "../plots/player-ops",
    "../generators/operations", "../loot-chests/core", "./split-keys/plots", "./split-keys/player-shops", "./split-keys/tpa", "./identity"]) mocks[id] = hooks;
  load("src/storage/helpers.ts", mocks).clearAllData();
  assert.deepEqual([...values.entries()], [["other:data", "keep"]]);
  assert.ok(resets >= 12, "wipe must cancel jobs and invalidate feature/persistence caches");
  console.log("PASS wipe removes referral/combat namespaces and resets runtime hooks");
}

function rtp() {
  let ground = false, destination;
  const region = { id: "r", name: "Region", enabled: true, dimensionId: "overworld", allowedRanks: [], priority: 0,
    min: { x: 0, y: 64, z: 0 }, max: { x: 0, y: 70, z: 0 }, maxAttempts: 2, cooldownSeconds: 0,
    fallFromSky: false, protection: { enabled: false } };
  const core = load("src/rtp/core.ts", {
    "@minecraft/server": { EntityDamageCause: {}, world: { getDimension: () => ({ heightRange: { min: -64, max: 320 },
      getBlock: (point) => ({ typeId: ground && point.y === 64 ? "minecraft:stone" : "minecraft:air" }) }) } },
    "../custom-areas": { getCustomAreaAtLocation: () => undefined }, "../claims": { getClaimAt: () => undefined },
    "../shared/teleport-service": { requestPlayerTeleport(_p, point) { destination = point; return { ok: true }; } },
    "../storage": { state: { rtp: { config: { enabled: true, maxAttempts: 2 }, regions: { r: region } } },
      isFeatureEnabled: () => true, getPlayerId: () => "p" },
  });
  assert.equal(core.randomTeleport({}, "r").ok, false);
  assert.equal(destination, undefined, "no safe floor must not fall back to sky teleport");
  ground = true;
  assert.equal(core.randomTeleport({}, "r").ok, true);
  assert.equal(destination.y, 65);
  console.log("PASS RTP refuses unsafe fallback and preserves valid bounded landing");
}

async function main() { await shops(); dynamicStorage(); stats(); combat(); identity(); spatial(); placement(); generators(); wipe(); rtp(); }
main().catch((error) => { console.error(error); process.exitCode = 1; });
