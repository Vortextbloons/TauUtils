# TauUi

`TauUi` is TauUtils' internal UI framework for Minecraft Bedrock Script API forms. It wraps `@minecraft/server-ui` with small, allocation-light builders that make menus easier to write and safer to maintain.

The framework lives in `src/ui/tau-ui/index.ts` and is exported from `src/ui/index.ts`.

## Goals

- Centralize form cancel/error handling.
- Use stable button IDs instead of raw selection indexes.
- Map modal values by field key instead of array index.
- Keep UI code local and explicit; no global UI registry.
- Avoid migrating existing menus all at once.
- Keep hot paths clean; forms are built only when shown.

## Import

```ts
import { TauUi } from "./ui";
```

or import individual helpers:

```ts
import { tauAction, tauModal, tauConfirm, tauPaginate } from "./ui";
```

## Action Menus

Use action menus for button-based navigation.

```ts
const response = await TauUi.action("Generator Admin")
  .body("Choose what to edit.")
  .button("definitions", "Definitions", { iconPath: ICONS.settings })
  .button("upgrades", "Upgrades", { iconPath: ICONS.item })
  .button("back", "Back", { iconPath: ICONS.back })
  .show(player);

if (response.canceled || response.id === "back") return;

switch (response.id) {
  case "definitions":
    await showGeneratorDefinitions(player);
    return;
  case "upgrades":
    await showGeneratorUpgradeMenu(player);
    return;
}
```

### Button Values

Buttons can carry a typed `value` so menus do not need to parse labels.

```ts
const result = await TauUi.action<{ id: string }>("Select Shop")
  .buttons(shops.map((shop) => ({
    id: "shop",
    text: shop.name,
    value: { id: shop.id },
  })))
  .button("back", "Back")
  .show(player);

if (!result.canceled && result.id === "shop" && result.value) {
  await openShopEditor(player, result.value.id);
}
```

## Modal Forms

Use modal forms for settings and edit screens. Values are returned by key.

```ts
const result = await TauUi.modal("Combat Settings")
  .toggle("enabled", "Enabled", settings.enabled)
  .slider("tagSeconds", "Tag seconds", 1, 120, {
    step: 1,
    defaultValue: settings.tagSeconds,
  })
  .text("blockedCommands", "Blocked commands", {
    placeholder: "spawn,home,tpa",
    defaultValue: settings.blockedCommands.join(","),
  })
  .submitButton("Save")
  .show(player);

if (result.canceled) return;

settings.enabled = result.values.enabled === true;
settings.tagSeconds = Number(result.values.tagSeconds ?? settings.tagSeconds);
settings.blockedCommands = String(result.values.blockedCommands ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
```

## Confirm Dialogs

Use `confirm` for destructive actions.

```ts
const confirmed = await TauUi.confirm(player, {
  title: "Delete Warp",
  body: `Delete ${warp.name}?`,
  confirmText: "Delete",
  cancelText: "Cancel",
});

if (!confirmed) return;
```

## Pagination

Use `paginate` before building forms with long lists. This avoids putting every item in one form and keeps selection mapping explicit.

```ts
let page = 0;
while (true) {
  const slice = TauUi.paginate(items, page, 20);
  const form = TauUi.action<{ index: number }>(`Items ${slice.page + 1}/${slice.pageCount}`);

  for (let i = 0; i < slice.items.length; i++) {
    const absoluteIndex = slice.startIndex + i;
    form.button("item", getItemLabel(slice.items[i]), { value: { index: absoluteIndex } });
  }

  if (slice.hasPrevious) form.button("previous", "Previous");
  if (slice.hasNext) form.button("next", "Next");
  form.button("back", "Back");

  const result = await form.show(player);
  if (result.canceled || result.id === "back") return;
  if (result.id === "previous") page--;
  if (result.id === "next") page++;
  if (result.id === "item" && result.value) await editItem(player, items[result.value.index]);
}
```

## Performance Notes

- `TauUi` has no global registry and does not retain player state.
- Builders store only the fields/buttons needed for one form.
- Native form objects are created inside `show()`, so builders can be created close to use and discarded.
- Prefer paginating lists over adding dozens of buttons.
- Avoid computing expensive body text before feature flags and permissions pass.
- Keep saves outside the framework; mutate state only after a non-canceled result.

## Recommended Patterns

- Use button IDs for control flow, not raw numeric selection indexes.
- Use modal keys for values, not `formValues[0]` indexes.
- Put `Back` / `Cancel` handling immediately after `show()`.
- Keep menus loop-based when users need to make repeated edits.
- Save after each successful admin edit with the correct storage save function.
- Do not migrate old UI code unless you are already editing that menu.
