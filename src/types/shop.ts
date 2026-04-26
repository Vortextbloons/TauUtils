export type ShopSortMode = "default" | "name" | "buyPrice" | "sellPrice" | "category";

export type ShopItemDefinition = {
  id?: string;
  itemId: string;
  label?: string;
  displayName?: string;
  category?: string;
  buyPrice: number;
  sellPrice: number;
  canBuy?: boolean;
  canSell?: boolean;
  quantities: number[];
  lore?: string[];
  enchantments?: { id: string; level: number }[];
  bundle?: ShopItemStackDefinition[];
  durability?: number;
  maxDurability?: number;
  exactDurability?: boolean;
  customData?: string;
  showEnchantsInPreview?: boolean;
};

export type ShopProfile = {
  id: string;
  currencyObjective: string;
  categories?: string[];
  items: ShopItemDefinition[];
  kitDraft?: ShopKitDraft;
  sortMode?: ShopSortMode;
};

export type ShopItemStackDefinition = {
  itemId: string;
  amount: number;
  label?: string;
  displayName?: string;
  lore?: string[];
  enchantments?: { id: string; level: number }[];
  durability?: number;
  maxDurability?: number;
  exactDurability?: boolean;
  customData?: string;
};

export type ShopKitDraft = {
  sourceItemId?: string;
  displayName: string;
  category: string;
  buyPrice: number;
  quantities: number[];
  bundle: ShopItemStackDefinition[];
};

export type SerializedVector3 = {
  x: number;
  y: number;
  z: number;
};

export type SerializedDynamicValue = boolean | number | string | SerializedVector3;

export type SerializedItemStack = {
  itemId: string;
  amount: number;
  nameTag?: string;
  lore?: string[];
  enchantments?: { id: string; level: number }[];
  durability?: number;
  maxDurability?: number;
  canDestroy?: string[];
  canPlaceOn?: string[];
  dynamicProperties?: Record<string, SerializedDynamicValue>;
  lockMode?: string;
  keepOnDeath?: boolean;
};

export type PlayerShopVisibility = "public" | "private";

export type PlayerShopConfig = {
  enabled: boolean;
  defaultCurrencyObjective: string;
  allowCustomItems: boolean;
  minPricePerUnit: number;
  maxPricePerUnit: number;
  taxPercent: number;
  maxListingsPerShop: number;
  defaultVisibility: PlayerShopVisibility;
  announceSales: boolean;
};

export type PlayerShop = {
  id: string;
  ownerPlayerId: string;
  ownerName: string;
  title: string;
  description?: string;
  visibility: PlayerShopVisibility;
  currencyObjective: string;
  listingIds: string[];
  createdAt: number;
  updatedAt: number;
};

export type PlayerShopListing = {
  id: string;
  shopId: string;
  sellerPlayerId: string;
  sellerName: string;
  title: string;
  category?: string;
  item: SerializedItemStack;
  quantity: number;
  pricePerUnit: number;
  currencyObjective: string;
  createdAt: number;
  updatedAt: number;
};

export type PlayerShopStore = {
  config: PlayerShopConfig;
  shops: Record<string, PlayerShop>;
  listings: Record<string, PlayerShopListing>;
  earningsByPlayerId: Record<string, Record<string, number>>;
};
