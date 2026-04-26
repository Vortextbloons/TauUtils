export type PlotVector = {
  x: number;
  y: number;
  z: number;
};

export type PlotSize = {
  x: number;
  y: number;
  z: number;
};

export type PlotSlot = {
  id: string;
  min: PlotVector;
  max: PlotVector;
  manual: boolean;
  occupiedByPlayerId?: string;
};

export type PlotConfig = {
  enabled: boolean;
  activePlotCount: number;
  size: PlotSize;
  spacing: number;
  dimensionId: string;
  origin?: PlotVector;
  saveIntervalTicks: number;
  autoBuild: {
    clearBase: boolean;
    addBorders: boolean;
    borderBlock: string;
    borderHeight: number;
    floorBlock?: string;
    roofBlock: string;
    roofHeight: number;
    showEnterTitle: boolean;
    titleRadius: number;
    titleMode: "owner" | "plot";
  };
};

import type { PlacedGenerator } from "./game";

export type PlotSnapshotGenerator = {
  definitionId: string;
  ownerPlayerId: string;
  dx: number;
  dy: number;
  dz: number;
  tier: number;
  nextSpawnAt: number;
};

export type PlotSnapshot = {
  slotId?: string;
  structureId: string;
  savedAt: number;
  sourceMin?: PlotVector;
  generators?: Array<
    PlotSnapshotGenerator | PlacedGenerator
  >;
};

export type PlotStore = {
  config: PlotConfig;
  slots: Record<string, PlotSlot>;
  playerToSlot: Record<string, string>;
  snapshots: Record<string, PlotSnapshot>;
};
