import test from 'node:test';
import assert from 'node:assert/strict';
import { flatLayout, flatFlowLayout } from '../src/layout-flat.mjs';
import { ATLAS_DATA as woo } from '../atlases/woocommerce/atlas-data.mjs';
import { ATLAS_DATA as gumroad } from '../atlases/gumroad/atlas-data.mjs';

function assertCardsSeparated(layout) {
  const points = [...layout.positions].map(([id, p]) => ({id, x:70 + p.x * 9.65, y:635 - p.y * 5.55}));
  assert.ok(layout.fit > 0 && layout.fit <= 1);
  for (let a=0; a<points.length; a++) for (let b=a+1; b<points.length; b++) {
    assert.ok(Math.abs(points[a].x-points[b].x) >= 166 || Math.abs(points[a].y-points[b].y) >= 34, `${points[a].id} overlaps ${points[b].id}`);
  }
}

test('flat system and folder cards do not overlap in either curated pack', () => {
  for (const pack of [woo,gumroad]) for (const group of ['district','layout']) {
    const before = JSON.stringify(pack.nodes);
    const layout = flatLayout(pack.nodes,group);
    assert.equal(layout.positions.size,pack.nodes.length);
    assertCardsSeparated(layout);
    assert.equal(JSON.stringify(pack.nodes),before);
  }
});

test('flat walkthroughs retain flow order and separate cards', () => {
  for (const pack of [woo,gumroad]) for (const flow of pack.flows) {
    const layout = flatFlowLayout(flow.nodeIds);
    assert.deepEqual([...layout.positions.keys()], [...new Set(flow.nodeIds)]);
    assertCardsSeparated(layout);
  }
});
