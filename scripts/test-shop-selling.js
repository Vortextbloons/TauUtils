const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
let inventory;
const mocks = {
  '@minecraft/server': {},
  '../ui': {},
  '../storage': { getInventoryContainer: () => inventory },
  '../shared/item-components': { readStackEnchantments: () => [] },
  '../shared/enchantments': {},
};
function load(file) {
  const module = { exports: {} };
  const { code } = esbuild.transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs' });
  vm.runInNewContext(code, { module, exports: module.exports, require(id) {
    if (id in mocks) return mocks[id];
    return load(path.resolve(path.dirname(file), id + '.ts'));
  } });
  return module.exports;
}
const utils = load(path.join(root, 'src/shop/utils.ts'));
const stack = { typeId: 'minecraft:iron_ingot', amount: 64, getLore: () => [], getDynamicProperty: () => undefined };
inventory = { size: 1, getItem: () => inventory.stack, setItem: (_slot, value) => { inventory.stack = value; }, stack };
const item = { itemId: 'iron_ingot', label: 'Iron Ingot' };
assert.equal(utils.getItemInstanceCount({}, item), 64, 'sell-all must count namespaced inventory iron for a short shop ID');
assert.equal(utils.itemMatchesDefinition(stack, utils.getItemInstanceDefinition(item)), true, 'bulk sell uses the same matching rule');
assert.equal(utils.itemMatchesDefinition({ ...stack, typeId: 'custom:iron_ingot' }, utils.getItemInstanceDefinition(item)), false, 'custom namespaces must remain distinct');
assert.equal(utils.removeItemInstance({}, item, 64), true);
assert.equal(inventory.stack, undefined);
console.log('PASS short shop IDs count, match and remove vanilla iron without matching custom namespaces');
