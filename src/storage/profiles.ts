import { state } from "./state";

export function getProfileConfig(playerId: string) {
  state.profiles.configs[playerId] ??= {
    enabled: true,
    sections: ["summary", "stats", "rank"],
    customFields: [],
  };
  return state.profiles.configs[playerId];
}
