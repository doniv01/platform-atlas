import { createHash } from 'node:crypto';
import { canonicalStringify } from './atlas-generate.mjs';
const HARD_MAX_VIEWER_NODES = 1000;
const EDGE_TYPE = Object.freeze({
  imports: 'read',
  includes: 'contains',
  requires: 'contains',
  'declares-dependency': 'deployment',
});

const DISTRICT_COLORS = Object.freeze([
  '#2563eb',
  '#7c3aed',
  '#0891b2',
  '#059669',
  '#ca8a04',
  '#dc2626',
  '#db2777',
  '#4f46e5',
]);

const ATLAS_CONTRACT = Object.freeze({
  edgeTypes: ['broadcast', 'contains', 'deployment', 'event', 'read', 'request', 'response', 'write'],
  nodeTypes: [
    'configuration',
    'controller',
    'database',
    'external-system',
    'policy',
    'provider',
    'route',
    'service',
    'surface',
  ],
  statuses: ['active-code', 'external', 'gated', 'parked'],
  truth: {
    deployment: ['unverified'],
    repository: ['observed', 'declared', 'heuristic'],
    runtime: ['unverified'],
  },
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hashNumber(value) {
  return Number.parseInt(sha256(value).slice(0, 8), 16) >>> 0;
}

function validateMaxViewerNodes(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > HARD_MAX_VIEWER_NODES) {
    throw new Error(`maxViewerNodes must be an integer from 1 to ${HARD_MAX_VIEWER_NODES}.`);
  }
}

function nodeRank(node, degree) {
  const connectionScore = (degree.get(node.id) ?? 0) * 100000;
  const manifestScore = node.kind === 'manifest' ? 50000 : 0;
  const packageScore = node.packageName ? 10000 : 0;
  const evidenceScore = Math.min(node.evidence.length, 20) * 100;
  const sizeScore = Math.min(node.bytes, 99999);
  return connectionScore + manifestScore + packageScore + evidenceScore + sizeScore;
}

function compareRanked(left, right) {
  return right.rank - left.rank
    || left.node.path.localeCompare(right.node.path, 'en')
    || left.node.id.localeCompare(right.node.id, 'en');
}

function selectViewerNodes(document, maxViewerNodes) {
  const degree = new Map(document.nodes.map((node) => [node.id, 0]));
  for (const edge of document.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  const ranked = document.nodes
    .map((node) => ({ node, rank: nodeRank(node, degree) }))
    .sort(compareRanked);

  const byDistrict = new Map();
  for (const item of ranked) {
    const list = byDistrict.get(item.node.districtId) ?? [];
    list.push(item);
    byDistrict.set(item.node.districtId, list);
  }
  const districtRepresentatives = [...byDistrict.entries()]
    .map(([districtId, items]) => ({ districtId, item: items[0] }))
    .sort((left, right) => compareRanked(left.item, right.item)
      || left.districtId.localeCompare(right.districtId, 'en'));

  const selectedIds = new Set();
  for (const { item } of districtRepresentatives.slice(0, maxViewerNodes)) selectedIds.add(item.node.id);
  for (const item of ranked) {
    if (selectedIds.size >= maxViewerNodes) break;
    selectedIds.add(item.node.id);
  }
  return {
    degree,
    ranked,
    selected: ranked.filter((item) => selectedIds.has(item.node.id)),
  };
}

function gridPositions(selected, districts) {
  const selectedByDistrict = new Map();
  for (const item of selected) {
    const list = selectedByDistrict.get(item.node.districtId) ?? [];
    list.push(item);
    selectedByDistrict.set(item.node.districtId, list);
  }
  for (const items of selectedByDistrict.values()) items.sort(compareRanked);

  const districtIds = districts
    .map((district) => district.id)
    .filter((id) => selectedByDistrict.has(id))
    .sort((left, right) => left.localeCompare(right, 'en'));
  const districtColumns = Math.max(1, Math.ceil(Math.sqrt(districtIds.length)));
  const districtRows = Math.max(1, Math.ceil(districtIds.length / districtColumns));
  const cellWidth = 90 / districtColumns;
  const cellHeight = 90 / districtRows;
  const positions = new Map();

  districtIds.forEach((districtId, districtIndex) => {
    const items = selectedByDistrict.get(districtId);
    const columns = Math.max(1, Math.ceil(Math.sqrt(items.length)));
    const rows = Math.max(1, Math.ceil(items.length / columns));
    const districtColumn = districtIndex % districtColumns;
    const districtRow = Math.floor(districtIndex / districtColumns);
    items.forEach((item, nodeIndex) => {
      const column = nodeIndex % columns;
      const row = Math.floor(nodeIndex / columns);
      positions.set(item.node.id, {
        x: Math.round((5 + districtColumn * cellWidth + ((column + 0.5) / columns) * cellWidth) * 10) / 10,
        y: Math.round((5 + districtRow * cellHeight + ((row + 0.5) / rows) * cellHeight) * 10) / 10,
        z: 8 + (hashNumber(item.node.id) % 15),
      });
    });
  });
  return positions;
}

function shortLabel(label) {
  return label.length > 20 ? `${label.slice(0, 19).trimEnd()}…` : label;
}

function pathDirectory(path) {
  const index = path.lastIndexOf('/');
  return index === -1 ? 'repository root' : path.slice(0, index);
}

function createRelationshipFlow(nodes, edges, rankById) {
  const edgePriority = (edge) => (
    (edge.confidence === 'high' ? 100000 : 0)
    + (edge.sourceType === 'declares-dependency' ? 10000 : 0)
    + (rankById.get(edge.from) ?? 0)
    + (rankById.get(edge.to) ?? 0)
  );
  const orderedEdges = [...edges].sort((left, right) => (
    edgePriority(right) - edgePriority(left)
    || left.id.localeCompare(right.id, 'en')
  ));
  const outgoing = new Map();
  for (const edge of orderedEdges) {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge);
    outgoing.set(edge.from, list);
  }
  const nodeIdsAvailable = new Set(nodes.map((node) => node.id));
  let start = nodes
    .filter((node) => outgoing.has(node.id))
    .sort((left, right) => (rankById.get(right.id) ?? 0) - (rankById.get(left.id) ?? 0)
      || left.id.localeCompare(right.id, 'en'))[0]?.id;
  if (!start) start = nodes[0].id;

  const nodeIds = [start];
  const edgeIds = [];
  const visited = new Set(nodeIds);
  let current = start;
  while (nodeIds.length < 12) {
    const edge = (outgoing.get(current) ?? []).find((candidate) => (
      nodeIdsAvailable.has(candidate.to) && !visited.has(candidate.to)
    ));
    if (!edge) break;
    edgeIds.push(edge.id);
    nodeIds.push(edge.to);
    visited.add(edge.to);
    current = edge.to;
  }
  if (edgeIds.length === 0 && orderedEdges.length > 0) {
    nodeIds.splice(0, nodeIds.length, orderedEdges[0].from, orderedEdges[0].to);
    edgeIds.push(orderedEdges[0].id);
  }

  return {
    id: 'representative-relationships',
    label: 'Representative source relationships',
    status: 'active-code',
    description: 'A deterministic sample of declared and inferred repository relationships. This is a graph-navigation aid, not an execution narrative.',
    nodeIds,
    edgeIds,
    cautions: [
      'Static imports and declarations do not prove that code executes at runtime.',
      'Runtime configuration, generated artifacts, and deployment state remain unverified.',
    ],
  };
}

export function createViewerData(document, maxViewerNodes = 180) {
  validateMaxViewerNodes(maxViewerNodes);
  if (!document.nodes.length) throw new Error('No supported source files were found; inspect scan diagnostics.');
  const selection = selectViewerNodes(document, maxViewerNodes);
  const selectedIds = new Set(selection.selected.map((item) => item.node.id));
  const selectedDistrictIds = new Set(selection.selected.map((item) => item.node.districtId));
  const selectedDistricts = document.districts.filter((district) => selectedDistrictIds.has(district.id));
  const positions = gridPositions(selection.selected, selectedDistricts);
  const districtById = new Map(document.districts.map((district) => [district.id, district]));

  const nodes = selection.selected.map(({ node }) => {
    const district = districtById.get(node.districtId);
    return {
      id: node.id,
      label: node.label,
      shortLabel: shortLabel(node.label),
      type: node.kind === 'manifest' ? 'configuration' : 'service',
      district: node.districtId,
      layout: district?.path || pathDirectory(node.path),
      status: node.truth.repository === 'heuristic' ? 'gated' : 'active-code',
      truth: { ...node.truth },
      position: positions.get(node.id),
      paths: [node.path],
      purpose: node.kind === 'manifest'
        ? `Tracked ${node.language} manifest${node.packageName ? ` for ${node.packageName}` : ''}.`
        : `Tracked ${node.language} module in ${district?.label ?? 'this repository'}.`,
      trace: node.evidence.map((evidence) => (
        `${evidence.extractor} observed at ${evidence.path}:${evidence.line}.`
      )),
      packet: {
        direction: 'source evidence',
        label: 'Exploratory scanner evidence',
        schema: {
          nodeId: node.id,
          bytes: node.bytes,
          language: node.language,
          ...(node.packageName ? { packageName: node.packageName } : {}),
          evidence: node.evidence.map((item) => ({ ...item })),
        },
      },
      risks: ['Static source relationships can over-approximate runtime behavior.'],
      boundaries: [
        `Repository evidence is ${node.truth.repository}; runtime and deployment remain unverified.`,
      ],
      tags: [node.language, node.kind, district?.kind ?? 'repository', ...(node.packageName ? [node.packageName] : [])],
      evidence: node.evidence.map((item) => ({ ...item })),
    };
  }).sort((left, right) => left.id.localeCompare(right.id, 'en'));

  const edges = document.edges
    .filter((edge) => selectedIds.has(edge.from) && selectedIds.has(edge.to))
    .map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      type: EDGE_TYPE[edge.kind] ?? 'contains',
      sourceType: edge.kind,
      label: `${edge.truth.repository === 'heuristic' ? 'Inferred' : 'Declared'}: ${edge.label}`,
      confidence: edge.confidence,
      truth: { ...edge.truth },
      evidence: edge.evidence.map((item) => ({ ...item })),
    }))
    .sort((left, right) => left.id.localeCompare(right.id, 'en'));

  const rankById = new Map(selection.ranked.map((item) => [item.node.id, item.rank]));
  const flow = createRelationshipFlow(nodes, edges, rankById);
  const repositoryName = document.source.repository;
  const displayName = repositoryName.split('/').filter(Boolean).at(-1) ?? repositoryName;
  const displayLabel = repositoryDisplayName(displayName);

  return {
    meta: {
      generatedFor: repositoryName,
      repositoryUrl: document.source.remoteUrl ?? '#',
      repositoryRevision: document.source.commit,
      displayName: `${displayLabel} · exploratory`,
      mark: './assets/repository-mark.svg',
      title: `${displayLabel} exploratory atlas`,
      evidenceMode: 'generated-exploratory',
      storageNamespace: `platform-atlas-${sha256(`${repositoryName}\0${document.source.commit}`).slice(0, 16)}`,
      defaultFlowId: flow.id,
      defaultNodeId: flow.nodeIds[0],
      updated: document.source.commit,
      sourceNodeCount: document.nodes.length,
      sourceEdgeCount: document.edges.length,
      scanIncomplete: document.scan.incomplete,
      viewerNodeCount: nodes.length,
      viewerEdgeCount: edges.length,
    },
    truthSemantics: [
      {
        label: 'Repository evidence',
        meaning: 'Paths and relationships come from deterministic manifest and static-source scanning at the displayed Git revision.',
      },
      {
        label: 'Runtime enablement',
        meaning: 'Static source presence does not prove that a module, import, branch, hook, or dependency executes at runtime.',
      },
      {
        label: 'Deployment truth',
        meaning: 'This atlas makes no claim about builds, generated artifacts, configuration, data, services, or deployment state.',
      },
    ],
    districts: selectedDistricts
      .map((district) => {
        const represented = nodes.filter((node) => node.district === district.id).length;
        return {
          id: district.id,
          label: district.label,
          color: DISTRICT_COLORS[hashNumber(district.id) % DISTRICT_COLORS.length],
          purpose: `${district.kind} group at ${district.path || 'repository root'}; ${represented} of ${district.nodeCount} scanned nodes shown.`,
          source: {
            kind: district.kind,
            path: district.path,
            ...(district.manifestPath ? { manifestPath: district.manifestPath } : {}),
          },
        };
      })
      .sort((left, right) => left.id.localeCompare(right.id, 'en')),
    nodes,
    edges,
    flows: [flow],
    journeys: [],
  };
}

function moduleLiteral(value) {
  return canonicalStringify(value)
    .trimEnd()
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function createAdapter(viewerData, inputHash) {
  return `/**
 * Exploratory pack generated deterministically from AtlasDocument v1.
 * Relationship heuristics are inferred; runtime and deployment are unverified.
 * Source document SHA-256: ${inputHash}
 * Do not edit this file; rebuild it with npm run atlas:generate.
 */
export const ATLAS_CONTRACT = Object.freeze(${moduleLiteral(ATLAS_CONTRACT)});

export const ATLAS_DATA = Object.freeze(${moduleLiteral(viewerData)});
`;
}

function repositoryDisplayName(value) {
  const name = String(value).trim();
  return name ? `${name[0].toUpperCase()}${name.slice(1)}` : 'Repository';
}
