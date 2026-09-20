import { world } from "@minecraft/server";
import { shouldCancelRtpDamage } from "../rtp";
import { handleCombatDamage, handleCombatDeath, handleCombatKill, resolveCombatAttacker, resolveCombatProjectileAttacker } from "../combat";
import { shouldCancelAreaPvp } from "../custom-areas";
import { shouldCancelClaimPvp } from "../claims";
import { getPlayerTeam } from "../teams";
import { saveAssignedPlayerPlot } from "../plots";
import {
  asPlayer,
  getPlayerId,
  getPlayerStats,
  getPlayerStatsById,
  incrementStat,
  isFeatureEnabled,
} from "../storage";

export function registerCombatEvents(): void {
  world.afterEvents.entityDie.subscribe((event) => {
    const dead = asPlayer(event.deadEntity);
    if (dead) {
      if (isFeatureEnabled("combat")) handleCombatDeath(dead);
      const killer = resolveCombatAttacker(event.damageSource);
      if (isFeatureEnabled("stats")) {
        saveAssignedPlayerPlot(dead);
        void getPlayerStatsById(getPlayerId(dead));
        incrementStat(dead, "deaths", 1);
        const deadStats = getPlayerStats(dead);
        if (deadStats.longestKillstreak < deadStats.killstreak) deadStats.longestKillstreak = deadStats.killstreak;
        deadStats.killstreak = 0;
      }
      if (killer && killer.id !== dead.id) {
        if (isFeatureEnabled("stats")) {
          const streak = incrementStat(killer, "killstreak", 1);
          incrementStat(killer, "kills", 1);
          const killerStats = getPlayerStats(killer);
          if (streak > killerStats.longestKillstreak) killerStats.longestKillstreak = streak;
          if (isFeatureEnabled("combat")) handleCombatKill(killer, dead, { killerStats, killstreak: streak });
        } else if (isFeatureEnabled("combat")) {
          const killerStats = getPlayerStats(killer);
          handleCombatKill(killer, dead, { killerStats, killstreak: 0 });
        }
      }
      return;
    }

    if (!isFeatureEnabled("stats")) return;
    const killer = resolveCombatAttacker(event.damageSource);
    if (killer) {
      incrementStat(killer, "kills", 1);
      const streak = incrementStat(killer, "killstreak", 1);
      const killerStats = getPlayerStats(killer);
      if (streak > killerStats.longestKillstreak) killerStats.longestKillstreak = streak;
    }
  });

  world.beforeEvents.entityHurt.subscribe((event) => {
    const victim = asPlayer(event.hurtEntity);
    if (victim && shouldCancelRtpDamage(victim, event.damageSource.cause)) {
      event.cancel = true;
      return;
    }
    const attacker = resolveCombatAttacker(event.damageSource);
    if (!victim || !attacker) return;
    if (shouldCancelAreaPvp(victim, attacker)) {
      event.cancel = true;
      return;
    }
    if (shouldCancelClaimPvp(victim, attacker)) {
      event.cancel = true;
      return;
    }
    if (!isFeatureEnabled("teams")) return;

    const victimTeam = getPlayerTeam(victim);
    if (!victimTeam) return;
    if (victimTeam.ownerPlayerId !== getPlayerId(attacker) && !victimTeam.memberPlayerIds.includes(getPlayerId(attacker))) return;
    if (victimTeam.friendlyFire) return;

    event.cancel = true;
  });

  world.afterEvents.entityHurt.subscribe((event) => {
    if (!isFeatureEnabled("combat")) return;
    const victim = asPlayer(event.hurtEntity);
    if (!victim) return;
    const attacker = resolveCombatAttacker(event.damageSource);
    if (!attacker) return;
    handleCombatDamage(victim, attacker);
  });

  world.afterEvents.projectileHitEntity.subscribe((event) => {
    if (!isFeatureEnabled("combat")) return;
    const victim = asPlayer(event.getEntityHit().entity);
    if (!victim) return;
    const attacker = resolveCombatProjectileAttacker(event.projectile, event.source);
    if (!attacker) return;
    handleCombatDamage(victim, attacker);
  });
}

