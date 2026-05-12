<p align="center">
  <img src="resource_pack/pack_icon.png" alt="TauUtils" width="128" height="128">
</p>

<h1 align="center">TauUtils</h1>

<p align="center">
  <b>A comprehensive Minecraft Bedrock add-on for server management</b>
</p>

<p align="center">
  Creator UI · Forms · Shops · Sidebars · Bindings · Ranks · Stats · Profiles<br>
  Plots · TPA · Homes · Pay · Teams · Warps · Prune · Generators<br>
  Crates · Custom Items · Combat · Kill Conditions · Custom Areas · Moderation
</p>

<br>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.9.7--Beta-gold?style=for-the-badge" alt="Version">
  <img src="https://img.shields.io/badge/Minecraft-1.26.20%2B-blue?style=for-the-badge" alt="Minecraft">
  <img src="https://img.shields.io/badge/status-active-success?style=for-the-badge" alt="Status">
</p>

---

## Table of Contents

- [Admin & Creator Tools](#admin--creator-tools)
- [Ranks, Stats & Profiles](#ranks-stats--profiles)
- [Shops & Economy](#shops--economy)
- [Plots & Land Management](#plots--land-management)
- [Teleportation & Social](#teleportation--social)
- [Gameplay Enhancements](#gameplay-enhancements)
- [Maintenance & Moderation](#maintenance--moderation)
- [Commands](#commands)
- [Sidebar Placeholders](#sidebar-placeholders)
- [Installation](#installation)
- [Credits](#credits)

---

## Admin & Creator Tools

<div align="center">

| Feature | Description |
|:--------|:------------|
| **Creator** | A visual drag-and-drop form editor. Build custom menus with buttons, toggles, sliders, dropdowns, inputs, labels, and dividers. Assign icons, set actions, and reorder elements freely. |
| **Bindings** | Bind any menu to a held item, item lore, or entity interaction. Trigger menus seamlessly from gameplay. |
| **Config** | Every feature can be toggled on or off individually through the admin config menu. Full control over what's active. |

</div>

---

## Ranks, Stats & Profiles

| Feature | Description |
|:--------|:------------|
| **Ranks** | A full rank system with permissions, chat formatting, and color support. Assign or remove ranks through an intuitive UI. |
| **Profiles** | Player profile cards with customizable visible sections. Browse and edit profiles in-game. |
| **Stats** | Track detailed player statistics: kills, deaths, blocks broken and placed, time played, and distance traveled. |
| **Chat Formatting** | Configure chat message format with rank prefixes, colors, and full placeholder support. Everything is customizable. |

---

## Shops & Economy

> **Info** — Shops support both admin-configured and player-run setups.

| Feature | Description |
|:--------|:------------|
| **Shops** | Admin-configured shop profiles with categories, buy/sell/kill/buy-kill modes, quantity selection, kit items, and enchantment parsing. |
| **Player Shops** | Players create their own shops by setting up a shop block, listing items from their inventory, and earning money through escrow-based purchases. Browse the marketplace and claim earnings anytime. |
| **Pay** | Players can send money to each other with configurable tax. Simple and straightforward. |

---

## Plots & Land Management

| Feature | Description |
|:--------|:------------|
| **Plots** | A complete plot system with configurable grid layout, auto-building with borders/floor/roof, queued fill jobs, plot snapshots that save and restore structures and generators, slime chunk loading, and team-based ownership sharing. |
| **Custom Areas** | Define 3D regions with enter/leave messages (chat or global), permission overrides for PvP, block breaking, block placing, item use, and entity interaction. Add periodic effects, periodic commands, and ticking area support. |

---

## Teleportation & Social

<div align="center">

| Feature | Description |
|:--------|:------------|
| **TPA** | Send, accept, and deny teleport requests between players. Simple request-based teleportation. |
| **Homes** | Set named home locations, list all your homes, delete homes, and teleport back to them. |
| **Warps** | Create server warps with categories and cross-dimension teleportation support. |
| **Teams** | Create teams, invite and manage members, toggle friendly fire, share plot ownership with personal plot suspension and restoration. |

</div>

---

## Gameplay Enhancements

| Feature | Description |
|:--------|:------------|
| **Generators** | Placeable block generators that produce items automatically. Supports tiered upgrades, auto-breakers, and custom info lines. |
| **Crates** | Crate key system with weighted rewards — items, scoreboard scores, tags, commands. Four animated reveal presets: Arcane, Ember, Frost, and Void. Particle effects and rare win broadcasts. |
| **Custom Items** | Create Tau items with triggers (use in air, use on block, melee hit, mine block), actions (commands, sounds, particles, effects, projectiles, AOE), costs (money, XP, health), cooldowns, and max uses. |
| **Combat** | Combat tagging with duration, logout loot dropping, command blocking while tagged, killstreak tracking, and kill conditions with rank/stat filters that run scoreboard operations or commands. |
| **Sidebars** | Configurable HUD actionbar text with placeholders, scrolling, priority, and per-player tag support. |

---

## Maintenance & Moderation

| Feature | Description |
|:--------|:------------|
| **Prune** | Automatically remove stale player data — stats, profiles, teams, plots, homes, and settings — based on inactivity period (default 30 days). |
| **Moderation** | Ban specific items from being used. Take inventory inspection snapshots for rollback support. |

---

## Commands

<details>
<summary><b>Click to expand full command list</b></summary>

<br>

| Command | Description |
|:--------|:------------|
| `tau:help` | Show help information |
| `tau:open` | Open a menu by ID |
| `tau:crate` | Open crate admin menu |
| `tau:item` | Open Tau items admin menu |
| `tau:generatorsadmin` | Open generator admin menu |
| `tau:warps` | Open warp menu |
| `tau:warpsadmin` | Open warp admin menu |
| `tau:warp` | Quick teleport to a warp |
| `tau:plot` | Open plot player menu |
| `tau:plots` | Open plot manager |
| `tau:prune` | Open prune data menu |
| `tau:team` | Open team menu |
| `tau:tpa` | Send a teleport request |
| `tau:tpaccept` | Accept a teleport request |
| `tau:tpdeny` | Deny a teleport request |
| `tau:sethome` | Set a home |
| `tau:home` | Teleport to a home |
| `tau:delhome` | Delete a home |
| `tau:homes` | List homes |
| `tau:pay` | Pay another player |
| `tau:settings` | Open player settings |
| `tau:stats` | View your stats |
| `tau:creator` | Open the form creator |
| `tau:sidebar` | Open sidebar editor |
| `tau:shop` | Open the shop |
| `tau:myshop` | Open your player shop |
| `tau:market` | Open player marketplace |
| `tau:shopadmin` | Open shop admin menu |
| `tau:shopclaim` | Claim player shop earnings |
| `tau:cleardata` | Clear all data |
| `tau:config` | Open config menu |
| `tau:debugscore` | Debug scoreboard values |
| `tau:credits` | Show credits |
| `tau:richest` | Show richest players |
| `tau:rank` | Open rank menu |
| `tau:profile` | Open profile browser |

</details>

---

## Sidebar Placeholders

Customize your sidebars and chat format with these placeholders:

| Placeholder | Description |
|:-----------|:------------|
| `[name]` | Player name |
| `[money]` | Player money / score |
| `[ping]` | Player ping |
| `[pos]` | Player position |
| `[tps]` | Server TPS |
| `[health]` | Player health |
| `[health_color]` | Health-based color code |
| `[rank]` | Player rank |
| `[kills]` | Player kill count |
| `[killstreak]` | Current killstreak |
| `[longest_killstreak]` | Best killstreak |

---

## Installation

Apply the behavior pack and resource pack to your world or Minecraft Bedrock server.

Once installed, use `tau:creator` or any admin command to start configuring features. Everything is ready to go.

---

<p align="center">
  <b>Created by RCodE777</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.9.7--Beta-gold?style=flat-square" alt="Version">
  <img src="https://img.shields.io/badge/Minecraft-1.26.20%2B-blue?style=flat-square" alt="Minecraft">
</p>
