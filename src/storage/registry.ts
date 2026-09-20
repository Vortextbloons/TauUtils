import { STORAGE_KEYS } from "../types";
import {
  CLAIMS_CLAIM_PREFIX,
  CLAIMS_CONFIG_KEY,
  CUSTOM_AREAS_AREA_PREFIX,
  CUSTOM_AREAS_CONFIG_KEY,
  LOOT_CHESTS_CHEST_PREFIX,
  LOOT_CHESTS_CONFIG_KEY,
  LOOT_CHESTS_POOL_PREFIX,
  LOOT_CHESTS_SNAPSHOT_PREFIX,
  PLAYER_SHOPS_CONFIG_KEY,
  PLAYER_SHOPS_EARNINGS_PREFIX,
  PLAYER_SHOPS_LISTING_PREFIX,
  PLAYER_SHOPS_SHOP_PREFIX,
  PLOTS_CONFIG_KEY,
  PLOTS_MIGRATION_MARKER_KEY,
  PLOTS_PLAYER_SLOT_PREFIX,
  PLOTS_SLOT_PREFIX,
  PLOTS_SNAPSHOT_PREFIX,
  STATS_PLAYER_IDS_KEY,
  STATS_PLAYER_PREFIX,
} from "./dynamic-json";
import { TPA_COOLDOWN_PREFIX, TPA_INBOX_PREFIX, TPA_OUTBOX_PREFIX } from "./split-keys/tpa";

export type StorageKeyKind = "single-blob" | "split-config" | "split-entry" | "marker" | "transient";

export type StorageKeyDescriptor = {
  key: string;
  kind: StorageKeyKind;
  owner: string;
  notes: string;
};

function single(key: string, owner: string, notes: string): StorageKeyDescriptor {
  return { key, kind: "single-blob", owner, notes };
}

// Intentional public API for audit tooling: imported by external checks and
// re-exported conceptually as the storage-key inventory (see Phase 2 registry).
// Excluded from dead-exports via the registry.ts ignore pattern.
export const STORAGE_KEY_REGISTRY: readonly StorageKeyDescriptor[] = [
  single(STORAGE_KEYS.forms, "forms", "Single blob; migrate to split keys if large."),
  single(STORAGE_KEYS.shops, "shops", "Single blob; split-key candidate."),
  single(STORAGE_KEYS.binds, "bindings", "Small blob."),
  single(STORAGE_KEYS.sidebars, "sidebars", "Single blob."),
  single(STORAGE_KEYS.config, "config", "Feature flags + global config."),
  single(STORAGE_KEYS.ranks, "ranks", "Rank defs + player ranks (name-keyed)."),
  single(STORAGE_KEYS.chat, "chat", "Chat config."),
  single("tau:stats", "stats", "Legacy blob; cleared only after successful split flush."),
  single("tau:profiles", "profiles", "Profile configs."),
  single(STORAGE_KEYS.plots, "plots", "Legacy blob; one-shot migration to split keys."),
  single(STORAGE_KEYS.tpa, "tpa", "Legacy blob; split inbox/outbox/cooldown preferred."),
  single(STORAGE_KEYS.homes, "homes", "Single blob; split-key candidate."),
  single(STORAGE_KEYS.pay, "pay", "Pay config."),
  single(STORAGE_KEYS.playerSettings, "playerSettings", "Per-player settings blob."),
  single(STORAGE_KEYS.teams, "teams", "Team defs; split-key candidate."),
  single("tau:prune", "prune", "Prune config."),
  single(STORAGE_KEYS.warps, "warps", "Warp defs."),
  single(STORAGE_KEYS.teamHomes, "teamHomes", "Team homes."),
  single(STORAGE_KEYS.rtp, "rtp", "RTP config."),
  single(STORAGE_KEYS.generators, "generators", "Generator defs + placed (high growth; split candidate)."),
  single(STORAGE_KEYS.moderation, "moderation", "Moderation config."),
  single(STORAGE_KEYS.crates, "crates", "Crate defs."),
  single(STORAGE_KEYS.tauItems, "tauItems", "Tau item defs."),
  single(STORAGE_KEYS.combat, "combat", "Combat config."),
  single(STORAGE_KEYS.commandBuilder, "commandBuilder", "Builder commands."),
  single(STORAGE_KEYS.customRewards, "customRewards", "Reward defs."),
  single(STORAGE_KEYS.referrals, "referrals", "Referral store."),
  single(STORAGE_KEYS.playerShops, "playerShops", "Legacy blob; split shops/listings/earnings preferred."),
  single(STORAGE_KEYS.customAreas, "customAreas", "Legacy blob; split areas preferred."),
  single(STORAGE_KEYS.lootChests, "lootChests", "Legacy blob; split pools/snapshots/chests preferred."),
  single(STORAGE_KEYS.claims, "claims", "Legacy blob; split claims preferred."),
  { key: PLAYER_SHOPS_CONFIG_KEY, kind: "split-config", owner: "playerShops", notes: "Split config." },
  { key: `${PLAYER_SHOPS_SHOP_PREFIX}*`, kind: "split-entry", owner: "playerShops", notes: "One key per shop." },
  { key: `${PLAYER_SHOPS_LISTING_PREFIX}*`, kind: "split-entry", owner: "playerShops", notes: "One key per listing (escrowed item)." },
  { key: `${PLAYER_SHOPS_EARNINGS_PREFIX}*`, kind: "split-entry", owner: "playerShops", notes: "One key per player earnings bucket." },
  { key: `${STATS_PLAYER_PREFIX}*`, kind: "split-entry", owner: "stats", notes: "One key per player." },
  { key: STATS_PLAYER_IDS_KEY, kind: "split-config", owner: "stats", notes: "Name -> id map." },
  { key: PLOTS_CONFIG_KEY, kind: "split-config", owner: "plots", notes: "Split config." },
  { key: `${PLOTS_SLOT_PREFIX}*`, kind: "split-entry", owner: "plots", notes: "One key per slot." },
  { key: `${PLOTS_PLAYER_SLOT_PREFIX}*`, kind: "split-entry", owner: "plots", notes: "One key per player slot." },
  { key: `${PLOTS_SNAPSHOT_PREFIX}*`, kind: "split-entry", owner: "plots", notes: "Build snapshots." },
  { key: PLOTS_MIGRATION_MARKER_KEY, kind: "marker", owner: "plots", notes: "One-shot migration marker; never delete except wipe." },
  { key: CLAIMS_CONFIG_KEY, kind: "split-config", owner: "claims", notes: "Split config." },
  { key: `${CLAIMS_CLAIM_PREFIX}*`, kind: "split-entry", owner: "claims", notes: "One key per claim." },
  { key: CUSTOM_AREAS_CONFIG_KEY, kind: "split-config", owner: "customAreas", notes: "Split config." },
  { key: `${CUSTOM_AREAS_AREA_PREFIX}*`, kind: "split-entry", owner: "customAreas", notes: "One key per area." },
  { key: LOOT_CHESTS_CONFIG_KEY, kind: "split-config", owner: "lootChests", notes: "Split config." },
  { key: `${LOOT_CHESTS_POOL_PREFIX}*`, kind: "split-entry", owner: "lootChests", notes: "One key per pool." },
  { key: `${LOOT_CHESTS_SNAPSHOT_PREFIX}*`, kind: "split-entry", owner: "lootChests", notes: "Chest snapshots." },
  { key: `${LOOT_CHESTS_CHEST_PREFIX}*`, kind: "split-entry", owner: "lootChests", notes: "Bound chest locations." },
  { key: `${TPA_INBOX_PREFIX}*`, kind: "split-entry", owner: "tpa", notes: "Inbox per player." },
  { key: `${TPA_OUTBOX_PREFIX}*`, kind: "split-entry", owner: "tpa", notes: "Outbox per player." },
  { key: `${TPA_COOLDOWN_PREFIX}*`, kind: "split-entry", owner: "tpa", notes: "Cooldown per player." },
  { key: "tau:combat:penalty:*", kind: "transient", owner: "combat", notes: "One-time rejoin marker; cleared on join." },
  { key: "tau:combat:logout:*", kind: "transient", owner: "combat", notes: "Durable logout loot; cleared after successful drop." },
  { key: "tau:corrupt:*", kind: "transient", owner: "storage", notes: "Quarantined corrupt blobs for admin review." },
  { key: "tau:manifest:*", kind: "transient", owner: "storage", notes: "Per-split-store generation+checksum manifest; warn+quarantine on mismatch." },
  { key: "tau:journal:*:head", kind: "transient", owner: "storage", notes: "Journal sequence head per store." },
  { key: "tau:journal:*:*", kind: "transient", owner: "storage", notes: "Journal envelopes; ring-capped, acked after verified flush." },
  { key: "tau:identity:aliases", kind: "transient", owner: "storage", notes: "Stable playerId <-> name aliases; additive, never renames existing keys." },
  { key: "tau:meta", kind: "marker", owner: "meta", notes: "Version/meta marker." },
];
