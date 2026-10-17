const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
function load(file, mocks) {
  const source = process.argv.includes('--baseline') ? require('node:child_process').execFileSync('git', ['show', 'HEAD:' + file], { cwd: root, encoding: 'utf8' }) : fs.readFileSync(path.join(root, file), 'utf8');
  const { code } = esbuild.transformSync(source, { loader: 'ts', format: 'cjs' });
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require(id) { if (id in mocks) return mocks[id]; throw Error(id); } });
  return module.exports;
}
function fixture() {
  const slots = { a: { id: 'a' }, b: { id: 'b' } };
  const state = { plots: { config: { enabled: true }, slots, playerToSlot: {}, snapshots: {} } };
  let clears = 0;
  const ops = load('src/plots/player-ops.ts', {
    '@minecraft/server': {}, '../types': {}, '../storage': { state, getPlayerId: p => p.id, isFeatureEnabled: () => true, savePlots() {} },
    '../shared/teleport-service': {}, './grid': { getPlotSlots: () => Object.values(slots), getDimension: () => ({}) },
    './build': { clearSlot() { clears++; }, saveSlotSnapshot() {}, loadSlotSnapshot() {}, applyAutoBuildRoof() {} },
    './ownership': { getPlotOwnerIdForPlayerId: id => id === 'member' ? 'owner' : id, resolveAuthoritativeOwnedSlotId: id => state.plots.playerToSlot[id] },
    '../teams': { getPlayerTeam: () => ({ teamPlotEnabled: true }) },
  });
  return { ops, slots, state, clears: () => clears };
}
let f = fixture();
f.slots.a.occupiedByPlayerId = 'other'; f.state.plots.playerToSlot.p = 'a';
assert.equal(f.ops.ensurePlayerPlotAssigned({ id: 'p' }).ok, true, 'stale occupied mapping must fall back to a free slot');
assert.equal(f.state.plots.playerToSlot.p, 'b');
assert.equal(f.slots.a.occupiedByPlayerId, 'other');
assert.equal(f.ops.deployPlayerPlot({ id: 'p' }).ok, true);
assert.equal(f.clears(), 1, 'duplicate deployment must not clear the assigned plot again');
f = fixture();
assert.equal(f.ops.ensurePlayerPlotAssigned({ id: 'member' }).ok, true);
assert.equal(f.state.plots.playerToSlot.owner, 'a', 'team member joining alone must allocate the team owner plot');
assert.equal(f.state.plots.playerToSlot.member, undefined);
assert.equal(f.ops.ensurePlayerPlotAssigned({ id: 'second' }).ok, true);
assert.equal(f.state.plots.playerToSlot.second, 'b', 'sequential joins must reserve distinct slots immediately');
assert.equal(f.ops.ensurePlayerPlotAssigned({ id: 'third' }).ok, false);
assert.equal(f.state.plots.playerToSlot.third, undefined);
console.log('PASS stale mapping fallback, idempotent deployment, team-only join, distinct reservations and full capacity');

// Drive the actual join/spawn/leave subscriptions with deterministic scheduling.
const callbacks = {};
const timers = new Map();
let nextTimer = 1, attempts = 0, online = [], errors = 0, available = false;
const system = {
  run(fn) { return this.runTimeout(fn); },
  runTimeout(fn) { const id = nextTimer++; timers.set(id, fn); return id; },
  clearRun(id) { timers.delete(id); },
};
const events = {};
for (const name of ['playerJoin', 'playerSpawn', 'playerLeave']) events[name] = { subscribe(fn) { callbacks[name] = fn; } };
const lifecycleMocks = {};
for (const match of fs.readFileSync(path.join(root, 'src/events/player-lifecycle.ts'), 'utf8').matchAll(/from "([^"]+)"/g)) lifecycleMocks[match[1]] = {};
lifecycleMocks['@minecraft/server'] = { system, world: { afterEvents: events, beforeEvents: { playerLeave: { subscribe() {} } }, getAllPlayers: () => online } };
lifecycleMocks['../storage'] = { state: { plots: { config: { enabled: true } }, stats: { playerIds: {} }, teams: { teams: {} } },
  getPlayerId: p => p.id, isFeatureEnabled: flag => flag === 'plots', collectCurrencyObjectives: () => [] };
lifecycleMocks['./player-cache'] = { getCachedPlayers: () => online };
lifecycleMocks['../plots'] = {
  ensurePlayerPlotAssigned() { attempts++; return { ok: available, message: 'No available plot slots.' }; },
  showPlotError() { errors++; }, getPlotOwnerIdForPlayer: () => 'p', getPlotForLocation: () => undefined, releasePlayerPlotById() {},
};
for (const [mod, names] of Object.entries({
  '../crates': ['clearCrateRuntimeForPlayer'], '../custom-areas': ['clearCustomAreaRuntimeForPlayer'], '../rtp': ['clearRtpRuntimeForPlayer'],
  '../social': ['clearSocialRuntimeForPlayer'], '../warps': ['clearWarpRuntimeForPlayer'], '../sidebar': ['clearSidebarRuntimeForPlayer'],
  '../ui': ['clearCustomAreaUiRuntimeForPlayer'], './interaction-events': ['clearGeneratorMenuForPlayer'], './plot-events': ['clearPlotTitleStateForPlayer'],
})) for (const name of names) lifecycleMocks[mod][name] = () => {};
load('src/events/player-lifecycle.ts', lifecycleMocks).registerPlayerLifecycleEvents();
function tick() { const batch = [...timers.values()]; timers.clear(); for (const fn of batch) fn(); }
const player = { id: 'p', name: 'Player', isValid: true, location: { x: 0, y: 0, z: 0 } };
online = [player];
callbacks.playerJoin({ playerName: player.name });
callbacks.playerSpawn({ initialSpawn: true, player });
tick();
assert.equal(attempts, 1, 'join and initial spawn must initialize once');
tick();
assert.equal(attempts, 2, 'full capacity must retry');
assert.equal(errors, 1, 'retries must not spam errors');
available = true; tick();
assert.equal(attempts, 3);
tick(); assert.equal(attempts, 3, 'successful assignment must stop retrying');
callbacks.playerSpawn({ initialSpawn: false, player }); tick();
assert.equal(attempts, 3, 'respawns must not reassign plots');
callbacks.playerLeave({ playerName: player.name, playerId: 'p' });
available = false;
callbacks.playerSpawn({ initialSpawn: true, player }); tick();
assert.equal(attempts, 4);
callbacks.playerLeave({ playerName: player.name, playerId: 'p' });
online = []; player.isValid = false; tick();
assert.equal(attempts, 4, 'leave must cancel pending assignment');
// A stale deferred join must not initialize a disconnected session.
online = [{ ...player, isValid: true }];
callbacks.playerJoin({ playerName: player.name });
callbacks.playerLeave({ playerName: player.name, playerId: 'p' });
online = []; tick(); assert.equal(attempts, 4);
console.log('PASS join/spawn deduplication, capacity retries, quiet retry success, respawn and disconnect cancellation');

// Plot assignment must run even if an unrelated join handler throws.
lifecycleMocks['../storage'].isFeatureEnabled = flag => flag === 'plots' || flag === 'moderation';
lifecycleMocks['../moderation/banned-items'].clearBannedInventory = () => { throw Error('moderation failed'); };
online = [{ ...player, isValid: true }];
callbacks.playerSpawn({ initialSpawn: true, player: online[0] });
assert.throws(tick, /moderation failed/);
assert.equal(attempts, 5, 'moderation failure must not skip plot assignment');
callbacks.playerLeave({ playerName: player.name, playerId: 'p' });
console.log('PASS plot assignment is independent of failing optional join handlers');

async function playerMenuAssignment() {
  const f = fixture();
  let body = '', teleported, mutate = () => {}, message;
  const menu = { body(value) { body = value; return this; }, button() { return this; }, async show() { mutate(); return { id: 'tp' }; } };
  const ui = load('src/ui/plots-ui.ts', {
    '@minecraft/server': {}, './tau-ui': { TauUi: { action: () => menu, isCanceledOrBack: () => false } }, '../types': { ICONS: {} },
    '../storage': { state: f.state, isFeatureEnabled: () => true, tell(_p, value) { message = value; } }, '../teams': { getPlayerTeam: () => undefined },
    '../plots': { ensurePlayerPlotAssigned: p => f.ops.ensurePlayerPlotAssigned(p),
      getAssignedSlotForPlayer: p => f.slots[f.state.plots.playerToSlot[p.id]],
      teleportPlayerToSlot(_player, id) { teleported = id; return { message: 'Teleported' }; } },
  });
  await ui.showPlotPlayerMenu({ id: 'p', isValid: true });
  assert.equal(f.state.plots.playerToSlot.p, 'a', 'My Plot must repair a missing assignment rather than just display no plot');
  assert.equal(body, 'Your plot: a');
  assert.equal(teleported, 'a');
  mutate = () => { f.slots.a.occupiedByPlayerId = 'other'; f.slots.b.occupiedByPlayerId = 'p'; f.state.plots.playerToSlot.p = 'b'; };
  await ui.showPlotPlayerMenu({ id: 'p', isValid: true });
  assert.equal(teleported, 'b', 'teleport must use current ownership after the form resolves');
  mutate = () => {}; teleported = undefined;
  f.state.plots.config.enabled = false;
  await ui.showPlotPlayerMenu({ id: 'new', isValid: true });
  assert.equal(body, 'Plots are disabled.');
  assert.equal(message, 'Plots are disabled.');
  assert.equal(teleported, undefined);
  console.log('PASS My Plot repairs assignment, refreshes ownership after forms and explains disabled configuration');
}
playerMenuAssignment().catch(error => { console.error(error); process.exitCode = 1; });
