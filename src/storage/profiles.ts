import { state } from "./state";
import { saveProfiles } from "./save";

export function getProfileConfig(playerId: string) {
  state.profiles.configs[playerId] ??= {
    enabled: true,
    sections: ["summary", "stats", "rank"],
    customFields: [],
  };
  return state.profiles.configs[playerId];
}

export function setProfileConfig(playerId: string, config: { enabled: boolean; sections: string[]; customFields: string[] }): void {
  state.profiles.configs[playerId] = {
    enabled: config.enabled,
    sections: config.sections as any,
    customFields: config.customFields,
  };
  saveProfiles();
}
