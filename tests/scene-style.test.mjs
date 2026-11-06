import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// Mirror the browser's import map so pure renderer helpers are tested from the
// actual module, with the actual vendored Three.js, without constructing WebGL.
const threeBase = new URL('../vendor/three/', import.meta.url).href;
const loader = `
  export async function resolve(specifier, context, nextResolve) {
    if (specifier === 'three') return { url: ${JSON.stringify(threeBase)} + 'three.module.js', shortCircuit: true };
    if (specifier.startsWith('three/addons/')) return { url: ${JSON.stringify(threeBase)} + specifier.slice(6), shortCircuit: true };
    return nextResolve(specifier, context);
  }
`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, import.meta.url);
const { towerProfile, sceneAppearance } = await import('../src/city-three.mjs');

test('architectural tiers preserve hit-test height and footprint throughout reveal', () => {
  const variants = new Set();
  for (let i = 0; i < 120; i += 1) {
    for (const height of [0.02, 0.8, 3, 12]) for (const footprint of [0.5, 1.08, 2.6]) {
      const profile = towerProfile(`module-${i}`, height, footprint);
      variants.add(profile.variant);
      assert.deepEqual(profile, towerProfile(`module-${i}`, height, footprint));
      assert.ok(profile.plinthHeight > 0 && profile.bodyHeight > 0 && profile.crownHeight > 0);
      assert.ok(Math.abs(profile.plinthHeight + profile.bodyHeight - profile.crownY) < 1e-12);
      assert.ok(Math.abs(profile.crownY + profile.crownHeight - height) < 1e-12);
      for (const dimension of ['bodyWidth', 'crownWidth', 'crownDepth']) {
        assert.ok(profile[dimension] > 0 && profile[dimension] <= footprint);
      }
    }
  }
  assert.equal(variants.size, 3, 'the roofline has three deterministic silhouettes');
});

test('three finishes preserve the rich default and the optional architectural treatment', () => {
  const luminous = sceneAppearance('luminous');
  const matte = sceneAppearance('matte');
  const architectural = sceneAppearance('architectural');
  assert.equal(luminous.name, 'luminous');
  assert.equal(luminous.matte, 0);
  assert.equal(luminous.architectural, 0);
  assert.equal(luminous.bloomStrength, 0.5);
  assert.equal(matte.name, 'matte');
  assert.equal(matte.matte, 1);
  assert.equal(matte.bloomStrength, 0);
  assert.equal(matte.architectural, 0);
  assert.equal(architectural.name, 'architectural');
  assert.equal(architectural.architectural, 1);
  assert.equal(architectural.bloomStrength, 0.16);
  assert.deepEqual(sceneAppearance('invalid'), luminous);
  assert.deepEqual(sceneAppearance(), luminous);
  assert.ok(Object.isFrozen(matte));
});
