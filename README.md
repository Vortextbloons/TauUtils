# TauUtils

<p align="center">
  <img src="resource_pack/pack_icon.png" alt="TauUtils" width="128" height="128">
</p>

<p align="center">
  <b>Minecraft Bedrock server tools, menus, economy, gameplay systems, and moderation in one add-on.</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0--Beta-gold?style=for-the-badge" alt="Version">
  <img src="https://img.shields.io/badge/Minecraft-1.26.20%2B-blue?style=for-the-badge" alt="Minecraft">
  <img src="https://img.shields.io/badge/status-active-success?style=for-the-badge" alt="Status">
</p>

---

## Overview

TauUtils is a modular Bedrock add-on for running a server or world with less command spam and more in-game control. It combines creator tools, player systems, economy, land management, combat, moderation, and utility menus into one package.

### What It Covers

- Creator UI and bindings
- Configurable forms and menus
- Shops, player shops, market, and pay
- Ranks, chat formatting, stats, and profiles
- Sidebars and placeholder-driven HUD text
- Plots, custom areas, and loot chests
- TPA, homes, warps, teams, and player settings
- Generators, crates, Tau items, combat, and kill conditions
- Prune and moderation tools

---

## Highlights

| Area | What it does |
|:--|:--|
| **Creator** | Build menus visually with buttons, toggles, sliders, dropdowns, inputs, labels, and dividers. |
| **Bindings** | Bind menus to held items, item lore, entity interactions, or scriptevents. |
| **Help System** | In-game help topics for commands, shops, sidebars, ranks, stats, plots, generators, crates, items, and more. |
| **Shops** | Admin shop profiles plus player-run shops and a public marketplace. |
| **Land Systems** | Plot grids, custom areas, and loot chest management. |
| **Progression** | Ranks, stats, profiles, teams, and player settings. |
| **Gameplay** | Generators, crates, custom Tau items, combat tagging, and kill conditions. |
| **Ops Tools** | Prune, config menus, moderation controls, and admin utilities. |

---

## Feature Guide

### Creator And Admin Tools

- Build menus in-game with the Creator UI.
- Bind menus to items, lore, or entity tags.
- Toggle individual systems from the config menu.
- Manage ranks, shops, generators, crates, custom areas, loot chests, and more from the admin UI.

### Shops And Economy

- Admin-configured shop profiles with categories and buy/sell modes.
- Player shops with escrow-based earnings.
- Public marketplace browsing.
- Player-to-player payments with configurable tax.

### Ranks, Profiles, Stats

- Rank prefixes, suffixes, colors, and permissions.
- Chat formatting with placeholders.
- Custom profile cards.
- Stats for kills, deaths, blocks, play time, distance, and more.

### Plots, Areas, Loot Chests

- Plot grids with auto-build support.
- Plot snapshots that save and restore builds.
- Team-based plot sharing.
- Custom 3D areas with permission overrides and timed effects.
- Loot chest pools, bindings, settings, and refill systems.

### Social And Travel

- TPA requests.
- Homes.
- Warps with categories and cross-dimension teleportation.
- Teams with invites, joins, kicks, friendly fire, and plot sharing.
- Player settings for social preferences.

### Gameplay Systems

- Generators with tiers and auto-breakers.
- Crates with weighted rewards and reveal presets.
- Tau items with triggers, costs, cooldowns, and effects.
- Combat tagging and logout punishment.
- Kill conditions based on rank and stat filters.

### Maintenance And Moderation

- Data pruning for inactive players.
- Item restriction tools.
- Inventory inspection snapshots for rollback support.

---

## Help

Use the built-in help menu anytime:

```text
/tau:help
/tau:help <topic>
```

### Help Topics

| Topic | Covers |
|:--|:--|
| `commands` | Full command list |
| `shop` | Shop setup and player shops |
| `sidebar` | Sidebar setup and placeholders |
| `menus` | Form and menu building |
| `bindings` | Item, lore, entity, and scriptevent bindings |
| `ranks` | Rank and chat formatting |
| `stats` | Stats and profiles |
| `social` | TPA, homes, pay, and settings |
| `teams` | Team management |
| `warps` | Warp setup and usage |
| `plots` | Plot system overview |
| `generators` | Generator setup and upgrades |
| `crates` | Crate setup and rewards |
| `items` | Tau item creation |
| `prune` | Data pruning |
| `areas` | Custom areas |
| `placeholders` | Available placeholders |

---

## Commands

| Command | Description |
|:--|:--|
| `tau:help` | Open the help system |
| `tau:open` | Open a saved menu by ID |
| `tau:creator` | Open the form creator |
| `tau:config` | Open feature settings |
| `tau:sidebar` | Open the sidebar editor |
| `tau:shop` | Open a shop profile |
| `tau:myshop` | Manage your player shop |
| `tau:market` | Browse the player marketplace |
| `tau:shopadmin` | Open player shop admin tools |
| `tau:shopclaim` | Claim player shop earnings |
| `tau:warps` | Open the warp list |
| `tau:warpsadmin` | Open warp admin tools |
| `tau:warp` | Teleport to a warp |
| `tau:plot` | Open the plot menu |
| `tau:plots` | Open plot admin tools |
| `tau:lootchests` | Open loot chest admin tools |
| `tau:generatorsadmin` | Open generator admin tools |
| `tau:crate` | Open crate admin tools |
| `tau:item` | Open Tau item admin tools |
| `tau:rank` | Open rank tools |
| `tau:profile` | Open profile browser |
| `tau:stats` | View or edit stats |
| `tau:richest` | Show richest players |
| `tau:team` | Open the team menu |
| `tau:tpa` | Send a teleport request |
| `tau:tpaccept` | Accept a teleport request |
| `tau:tpdeny` | Deny a teleport request |
| `tau:sethome` | Set a home |
| `tau:home` | Go to a home |
| `tau:delhome` | Delete a home |
| `tau:homes` | List homes |
| `tau:pay` | Pay another player |
| `tau:settings` | Open player settings |
| `tau:prune` | Open prune tools |
| `tau:cleardata` | Clear Tau data |
| `tau:debugscore` | Debug a scoreboard value |

---

## Placeholders

Use these in sidebars, chat formats, menus, and similar text systems.

| Placeholder | Meaning |
|:--|:--|
| `[name]` | Player name |
| `[money]` | Currency score |
| `[ping]` | Player ping |
| `[pos]` | Player position |
| `[tps]` | Server TPS |
| `[health]` | Player health |
| `[health_color]` | Health color code |
| `[rank]` | Player rank |
| `[rank_prefix]` | Rank prefix |
| `[rank_suffix]` | Rank suffix |
| `[rank_tag]` | Rank tag |
| `[team]` | Team tag |
| `[message]` | Chat message |
| `[kills]` | Kill count |
| `[killstreak]` | Current killstreak |
| `[longest_killstreak]` | Best killstreak |

---

## Installation

1. Import both the behavior pack and resource pack into your world or server.
2. Make sure the packs are enabled.
3. Run `tau:help` or open `tau:creator` to start configuring the systems you want.

---

## Development

```bash
npm run typecheck
npm run build
```

- `typecheck` validates the TypeScript.
- `build` bundles the scripts and deploys the packs locally.

---

## Credits

Created by RCodE777.
