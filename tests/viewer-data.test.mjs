import assert from 'node:assert/strict';
import test from 'node:test';

import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ATLASES_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), '../atlases');
const PACKS = readdirSync(ATLASES_DIRECTORY, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/;

function uniqueIds(records, label) {
  const ids = records.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length, `${label} IDs must be unique`);
  assert.ok(ids.every((id) => SAFE_ID.test(id)), `${label} IDs must be safe slugs`);
  return new Set(ids);
}

for (const pack of PACKS) test(`atlas pack "${pack}" is internally consistent`, async () => {
  const { ATLAS_CONTRACT, ATLAS_DATA } = await import(pathToFileURL(resolve(ATLASES_DIRECTORY, pack, 'atlas-data.mjs')).href);
  assert.match(ATLAS_DATA.meta.repositoryRevision, /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
  assert.match(ATLAS_DATA.meta.repositoryUrl, /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);

  const districtIds = uniqueIds(ATLAS_DATA.districts, 'district');
  const nodeIds = uniqueIds(ATLAS_DATA.nodes, 'node');
  const edgeIds = uniqueIds(ATLAS_DATA.edges, 'edge');
  const flowIds = uniqueIds(ATLAS_DATA.flows, 'flow');
  const journeyIds = uniqueIds(ATLAS_DATA.journeys, 'journey');

  for (const node of ATLAS_DATA.nodes) {
    assert.ok(districtIds.has(node.district), `${node.id} references a missing district`);
    assert.ok(ATLAS_CONTRACT.nodeTypes.includes(node.type), `${node.id} has an unsupported type`);
    assert.ok(ATLAS_CONTRACT.statuses.includes(node.status), `${node.id} has an unsupported status`);
    assert.ok(node.paths.length > 0, `${node.id} needs at least one source path`);
    assert.ok(node.paths.every((path) => !path.startsWith('/') && !path.split('/').includes('..')), `${node.id} needs relative source paths`);
    assert.ok(['x', 'y', 'z'].every((axis) => Number.isFinite(node.position[axis])), `${node.id} needs finite coordinates`);
    for (const truthKind of ['repository', 'runtime', 'deployment']) {
      assert.ok(ATLAS_CONTRACT.truth[truthKind].includes(node.truth[truthKind]), `${node.id} has invalid ${truthKind} truth`);
    }
  }

  const edgeById = new Map(ATLAS_DATA.edges.map((edge) => [edge.id, edge]));
  for (const edge of ATLAS_DATA.edges) {
    assert.ok(nodeIds.has(edge.from) && nodeIds.has(edge.to), `${edge.id} has a missing endpoint`);
    assert.ok(ATLAS_CONTRACT.edgeTypes.includes(edge.type), `${edge.id} has an unsupported type`);
  }

  for (const flow of ATLAS_DATA.flows) {
    assert.ok(flow.nodeIds.length > 0, `${flow.id} needs nodes`);
    assert.equal(flow.edgeIds.length, flow.nodeIds.length - 1, `${flow.id} must describe each hop`);
    flow.nodeIds.forEach((id) => assert.ok(nodeIds.has(id), `${flow.id} references missing node ${id}`));
    flow.edgeIds.forEach((id, index) => {
      assert.ok(edgeIds.has(id), `${flow.id} references missing edge ${id}`);
      const edge = edgeById.get(id);
      assert.equal(edge.from, flow.nodeIds[index], `${flow.id} edge ${id} starts at the wrong node`);
      assert.equal(edge.to, flow.nodeIds[index + 1], `${flow.id} edge ${id} ends at the wrong node`);
    });
  }

  for (const journey of ATLAS_DATA.journeys) {
    assert.ok(flowIds.has(journey.flowId), `${journey.id} references a missing flow`);
    const flow = ATLAS_DATA.flows.find(({ id }) => id === journey.flowId);
    assert.ok(journey.steps.length > 0, `${journey.id} needs steps`);
    for (const step of journey.steps) {
      assert.ok(Number.isInteger(step.startHop) && Number.isInteger(step.endHop), `${step.id} needs integer hop bounds`);
      assert.ok(step.startHop >= 0 && step.startHop <= step.endHop && step.endHop < flow.nodeIds.length, `${step.id} has invalid hop bounds`);
      if (step.stageNodeId) assert.ok(nodeIds.has(step.stageNodeId), `${step.id} references a missing stage node`);
    }
  }

  assert.ok(flowIds.has(ATLAS_DATA.meta.defaultFlowId));
  assert.ok(journeyIds.has(ATLAS_DATA.meta.defaultJourneyId));
  assert.ok(nodeIds.has(ATLAS_DATA.meta.defaultNodeId));
  const defaultJourney = ATLAS_DATA.journeys.find(({ id }) => id === ATLAS_DATA.meta.defaultJourneyId);
  assert.equal(defaultJourney.flowId, ATLAS_DATA.meta.defaultFlowId);
});
