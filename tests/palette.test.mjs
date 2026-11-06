import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAppearance, resolveDistrictColors } from '../src/palette.mjs';
import { ATLAS_DATA as woo } from '../atlases/woocommerce/atlas-data.mjs';
import { ATLAS_DATA as gumroad } from '../atlases/gumroad/atlas-data.mjs';

test('appearance normalization is shared by settings and renderer', () => {
  for (const name of ['luminous', 'matte', 'architectural']) assert.equal(normalizeAppearance(name), name);
  for (const value of [null, undefined, '', 'invalid']) assert.equal(normalizeAppearance(value), 'luminous');
});

test('curated packs keep all three palettes without changing district identity', () => {
  for (const pack of [woo, gumroad]) for (const district of pack.districts) {
    assert.equal(district.color, district.appearanceColors.luminous);
    assert.equal(new Set(Object.values(district.appearanceColors)).size, 3);
    for (const color of Object.values(district.appearanceColors)) assert.match(color, /^#[0-9a-f]{6}$/i);
  }
});

test('third-party literal colors are never replaced by the finish palette', () => {
  const [district] = resolveDistrictColors([{ id: 'custom', tone: 'rose', color: '#123456' }]);
  assert.equal(district.color, '#123456');
  assert.equal(district.appearanceColors, null);
});
