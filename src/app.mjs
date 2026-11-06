import { iconSvg, registerNodeIcons, renderIconMarkup, resolveNodeIcon } from './icons.mjs';
import { createChrome } from './chrome.mjs';
import { flatLayout, flatFlowLayout } from './layout-flat.mjs';
import { animateObject, animateUi, prefersReducedMotion } from './motion-lite.mjs';

/**
 * Atlas packs live in ./atlases/<id>/atlas-data.mjs. The page's
 * <meta name="atlas-module"> names the default; ?atlas=<id> switches to any
 * pack listed in the #atlas-registry JSON. `npm run build -- --pack` adds a
 * generated exploratory pack to that registry and makes it the default.
 */
const ATLAS_REGISTRY = (() => {
  try {
    return JSON.parse(document.querySelector('#atlas-registry')?.textContent || '[]');
  } catch {
    return [];
  }
})();
const requestedAtlas = new URLSearchParams(window.location.search).get('atlas');
const ATLAS_ID = requestedAtlas && /^[a-z0-9][a-z0-9-]{0,63}$/.test(requestedAtlas) && ATLAS_REGISTRY.some((entry) => entry.id === requestedAtlas)
  ? requestedAtlas
  : null;
const ATLAS_MODULE = ATLAS_ID
  ? `./atlases/${ATLAS_ID}/atlas-data.mjs`
  : (document.querySelector('meta[name="atlas-module"]')?.getAttribute('content') || './atlas-data.mjs');
const { ATLAS_CONTRACT, ATLAS_DATA } = await import(new URL(ATLAS_MODULE, document.baseURI).href);
registerNodeIcons(ATLAS_DATA.meta.nodeIcons);

let gpuCity = null;
let chrome = null;

function isGpuDepth() {
  return Boolean(gpuCity?.ready) && state.mode === 'perspective';
}

const FLOWS = ATLAS_DATA.flows ?? [];
const JOURNEYS = ATLAS_DATA.journeys ?? [];
const nodeById = new Map(ATLAS_DATA.nodes.map((node) => [node.id, node]));
const districtById = new Map(ATLAS_DATA.districts.map((district) => [district.id, { ...district }]));
const flowById = new Map(FLOWS.map((flow) => [flow.id, flow]));
const journeyById = new Map(JOURNEYS.map((journey) => [journey.id, journey]));
const REPOSITORY_URL = ATLAS_DATA.meta.repositoryUrl ?? '#';
const ATLAS_TITLE = ATLAS_DATA.meta.title ?? 'Platform Atlas';
const REPOSITORY_NAME = ATLAS_DATA.meta.generatedFor?.split('/').at(-1) ?? 'repository';
const REPOSITORY_DISPLAY_NAME = ATLAS_DATA.meta.displayName
  ?? ATLAS_TITLE.replace(/\s+Platform Atlas$/i, '')
  ?? REPOSITORY_NAME;
const IS_GENERATED_ATLAS = Number.isFinite(ATLAS_DATA.meta.sourceNodeCount);
const SOURCE_COLLECTION_LABEL = IS_GENERATED_ATLAS ? 'ranked' : 'curated';
const STORAGE_NAMESPACE = ATLAS_DATA.meta.storageNamespace ?? `platform-atlas-${REPOSITORY_NAME}`;
const DEFAULT_FLOW_ID = ATLAS_DATA.meta.defaultFlowId ?? FLOWS[0]?.id ?? '';
const DEFAULT_JOURNEY_ID = ATLAS_DATA.meta.defaultJourneyId ?? JOURNEYS[0]?.id ?? '';
const DEFAULT_NODE_ID = ATLAS_DATA.meta.defaultNodeId ?? FLOWS[0]?.nodeIds?.[0] ?? ATLAS_DATA.nodes[0]?.id ?? '';
const ATLAS_ENTRY = ATLAS_REGISTRY.find((entry) => entry.id === ATLAS_ID)
  ?? ATLAS_REGISTRY.find((entry) => entry.repository === ATLAS_DATA.meta.generatedFor)
  ?? null;

/** Source status in reader-facing words. The raw values stay in the data. */
const STATUS_LABELS = {
  'active-code': 'Source present',
  external: 'External',
  gated: 'Conditional',
  parked: 'Declared',
};

function statusLabel(status) {
  return STATUS_LABELS[status] ?? titleCase(status);
}

const EDGE_COLORS = {
  broadcast: '#a78bfa',
  contains: '#94a3b8',
  deployment: '#7c8798',
  documents: '#94a3b8',
  event: '#a78bfa',
  guard: '#fbbf24',
  job: '#a78bfa',
  mutation: '#fb7185',
  read: '#60a5fa',
  request: '#38bdf8',
  response: '#34d399',
  write: '#fb7185',
};

/** Relationship class → line pattern in the 3D city (0 solid, 1 dashed, 2 dotted, 3 write). */
const EDGE_STYLE = {
  broadcast: 2,
  contains: 0,
  deployment: 0,
  documents: 0,
  event: 2,
  guard: 0,
  job: 2,
  mutation: 3,
  read: 0,
  request: 0,
  response: 1,
  write: 3,
};

const EDGE_CLASS_LABEL = {
  0: ['Solid', 'call, request, read, or build'],
  1: ['Dashed', 'response returning control'],
  2: ['Dotted', 'hook, event, or async job'],
  3: ['Rose pulse', 'write or mutation'],
};

const CAMERA_PRESETS = {
  overview: { bearing: -32, depth: 20, panX: -30, panY: 0, pitch: 42, zoom: 0.79 },
  flows: { bearing: -24, depth: 22, panX: 0, panY: 0, pitch: 46, zoom: 0.86 },
  boundaries: { bearing: -52, depth: 22, panX: 0, panY: 0, pitch: 50, zoom: 0.84 },
  journey: { bearing: -14, depth: 22, panX: -230, panY: 6, pitch: 46, zoom: 0.74 },
};

const VIEW_STORAGE_KEY = `${STORAGE_NAMESPACE}-saved-view`;
const GUIDE_STORAGE_KEY = `${STORAGE_NAMESPACE}-guide-seen`;
const INTRO_STORAGE_KEY = `${STORAGE_NAMESPACE}-intro-seen`;

const CAMERA_SNAPS = {
  front: { bearing: 0, depth: 22, panX: 0, panY: 0, pitch: 30, zoom: 0.92 },
  top: { bearing: -32, depth: 16, panX: 0, panY: 0, pitch: 86, zoom: 0.84 },
  side: { bearing: -88, depth: 22, panX: 0, panY: 0, pitch: 34, zoom: 0.9 },
  overview: null,
};

const ONBOARDING_STEPS = [
  {
    title: 'Pick a repository',
    body: 'Switch between the included atlases here. Each one is pinned to a single source revision, linked just below the name.',
    target: '#atlas-switch-button',
    placement: 'below-target',
  },
  {
    title: 'Map, Modules, Walkthrough',
    body: 'The rail switches between the 3D city, an index of every module, and a guided walkthrough of one real path through the code.',
    target: '.rail',
    placement: 'beside-target',
  },
  {
    title: 'Every tower is a module',
    body: 'Color is its district, height follows its number of source files, and a wider base means more connections. Select a tower to open its source panel.',
    target: '#map-viewport',
    placement: 'center',
  },
  {
    title: 'Pan, orbit, move',
    body: 'Drag empty space to slide the city, switch to Orbit to turn around it, or Move to rearrange towers and districts.',
    target: '#map-toolbar',
    placement: 'above-target',
  },
  {
    title: 'Angle and layers',
    body: 'Turn and tilt with the compass, snap to Front, Top, or Side, and show districts, modules, or both.',
    target: '#angle-toggle',
    placement: 'beside-target',
  },
  {
    title: 'Search',
    body: 'Press / to find a module, a file path, or a walkthrough. Choosing a result flies the camera to it.',
    target: '#omnibox',
    placement: 'below-target',
  },
];

// Walkthrough layout. A pack may place story nodes by hand (journey.positions);
// otherwise the default flow is laid out automatically in reading order.
const JOURNEY_POSITIONS = new Map(Object.entries(journeyById.get(DEFAULT_JOURNEY_ID)?.positions ?? {}));
const defaultJourneyNodes = [...new Set(flowById.get(DEFAULT_FLOW_ID)?.nodeIds ?? [])];
if (JOURNEY_POSITIONS.size === 0 && defaultJourneyNodes.length > 1) {
  // No authored layout: lay the path out as a snake, far row first, so a long
  // flow keeps room between neighboring names instead of crowding one line.
  const perRow = Math.max(4, Math.ceil(Math.sqrt(defaultJourneyNodes.length * 2.2)));
  const rows = Math.ceil(defaultJourneyNodes.length / perRow);
  defaultJourneyNodes.forEach((nodeId, index) => {
    const row = Math.floor(index / perRow);
    const column = row % 2 === 0 ? index % perRow : perRow - 1 - (index % perRow);
    JOURNEY_POSITIONS.set(nodeId, {
      x: 8 + column * (84 / (perRow - 1)),
      y: rows === 1 ? 50 : 82 - row * (64 / (rows - 1)),
      z: 10 + (index % 4) * 3,
    });
  });
} else {
  // Any flow node the authored layout leaves out joins a gentle left-to-right wave.
  defaultJourneyNodes.forEach((nodeId, index) => {
    if (JOURNEY_POSITIONS.has(nodeId)) return;
    const progress = defaultJourneyNodes.length <= 1 ? 0.5 : index / (defaultJourneyNodes.length - 1);
    JOURNEY_POSITIONS.set(nodeId, { x: 6 + progress * 88, y: 44 + (index % 2 === 0 ? 12 : -10), z: 10 + (index % 4) * 3 });
  });
}

function cameraPreset(presetName, flat = false) {
  const preset = { ...CAMERA_PRESETS[presetName] };
  if (flat) return { ...preset, panX: 0, panY: 0, zoom: 1 };
  if (window.matchMedia('(max-width: 760px)').matches) {
    if (presetName === 'overview') Object.assign(preset, { panX: 40, panY: -8, zoom: 0.92, pitch: 54 });
    if (presetName === 'journey') Object.assign(preset, { panX: 0, panY: -180, zoom: 1.04, pitch: 46 });
  } else if (presetName === 'journey' && !gpuCity?.ready) {
    // The SVG fallback pans the drawing rather than a camera, so the shift that
    // clears the walkthrough panel runs the other way.
    preset.panX = -preset.panX;
  }
  return preset;
}

/** The walkthrough camera: framed beside the panel where possible, otherwise the preset. */
function journeyCamera() {
  return framedJourneyCamera() ?? cameraPreset('journey', state.mode === 'flat');
}

/**
 * The preset walkthrough angle, zoomed and panned so the whole source flow sits
 * in the open area beside the walkthrough panel. Null when the 3D city is off
 * or the screen is too small to frame it.
 */
function framedJourneyCamera() {
  if (!isGpuDepth() || !gpuCity.fitView || window.matchMedia('(max-width: 760px)').matches) return null;
  const preset = cameraPreset('journey');
  const nodes = [...new Set(getActiveFlow()?.nodeIds ?? [])].map((id) => nodeById.get(id)).filter(Boolean);
  if (!nodes.length) return null;
  const points = nodes.flatMap((node) => {
    const ground = gpuCity.atlasToWorld({ ...getNodePosition(node), z: 0 });
    // The base, and the roof plus headroom for the name that floats above it.
    return [{ x: ground.x, y: 0, z: ground.z }, { x: ground.x, y: nodeHeight(node) + 1.2, z: ground.z }];
  });
  const view = dom.mapViewport.getBoundingClientRect();
  const panel = dom.journeyGuide.hidden ? null : dom.journeyGuide.getBoundingClientRect();
  const labelRoom = 96; // about half a name label, so names at the edges stay readable
  const rect = {
    left: (panel ? panel.right : view.left + 120) + labelRoom,
    right: view.right - 24 - labelRoom,
    top: view.top + 128,
    bottom: view.bottom - 150,
  };
  if (rect.right - rect.left < 240 || rect.bottom - rect.top < 200) return null;
  return { ...preset, ...gpuCity.fitView(preset, points, rect) };
}

function mapViewBox() {
  if (!window.matchMedia('(max-width: 760px)').matches) return '0 0 1120 700';
  return state.lens === 'journey' ? '80 0 960 700' : '190 0 740 700';
}

const dom = {
  announcer: document.querySelector('#atlas-announcer'),
  atlasArt: document.querySelector('#atlas-art'),
  atlasSwitchButton: document.querySelector('#atlas-switch-button'),
  atlasSwitchMenu: document.querySelector('#atlas-switch-menu'),
  brandName: document.querySelector('#brand-name'),
  atlasMain: document.querySelector('#atlas-main'),
  atlasMap: document.querySelector('#atlas-map'),
  atlasMapLayer: document.querySelector('#atlas-map-layer'),
  atlasSearch: document.querySelector('#atlas-search'),
  cameraBearing: document.querySelector('#camera-bearing'),
  cameraBearingValue: document.querySelector('#camera-bearing-value'),
  cameraDepth: document.querySelector('#camera-depth'),
  cameraDepthValue: document.querySelector('#camera-depth-value'),
  cameraPitch: document.querySelector('#camera-pitch'),
  cameraPitchValue: document.querySelector('#camera-pitch-value'),
  cameraReadout: document.querySelector('#camera-readout'),
  copyContext: document.querySelector('#copy-context'),
  copyStatus: document.querySelector('#copy-status'),
  drawerScrim: document.querySelector('#drawer-scrim'),
  edgeLegend: document.querySelector('#edge-legend'),
  explorerButton: document.querySelector('#explorer-button'),
  explorerReset: document.querySelector('#explorer-reset'),
  explorerPanel: document.querySelector('#explorer-panel'),
  flowCaution: document.querySelector('#flow-caution'),
  flowHud: document.querySelector('#flow-hud'),
  flowNext: document.querySelector('#flow-next'),
  flowPrevious: document.querySelector('#flow-previous'),
  flowProgress: document.querySelector('#flow-progress'),
  flowSelect: document.querySelector('#flow-select'),
  helpButton: document.querySelector('#help-button'),
  helpClose: document.querySelector('#help-close'),
  helpDialog: document.querySelector('#help-dialog'),
  inspectorBoundaries: document.querySelector('#inspector-boundaries'),
  inspectorClose: document.querySelector('#inspector-close'),
  inspectorMeta: document.querySelector('#inspector-meta'),
  sourceFilesTab: document.querySelector('#source-files-tab'),
  inspectorPanel: document.querySelector('#inspector-panel'),
  inspectorPacket: document.querySelector('#inspector-packet'),
  inspectorPaths: document.querySelector('#inspector-paths'),
  inspectorPurpose: document.querySelector('#inspector-purpose'),
  inspectorRisks: document.querySelector('#inspector-risks'),
  inspectorStatus: document.querySelector('#inspector-status'),
  inspectorTitle: document.querySelector('#inspector-heading'),
  inspectorTrace: document.querySelector('#inspector-trace'),
  inspectorType: document.querySelector('#inspector-type'),
  journeyCompletionBoundary: document.querySelector('#journey-completion-boundary'),
  journeyDetail: document.querySelector('#journey-detail'),
  journeyDetailBoundary: document.querySelector('#journey-detail-boundary'),
  journeyDetailDescription: document.querySelector('#journey-detail-description'),
  journeyDetailOverline: document.querySelector('#journey-detail-overline'),
  journeyDetailTitle: document.querySelector('#journey-detail-heading'),
  journeyEntryBoundary: document.querySelector('#journey-entry-boundary'),
  journeyFullMap: document.querySelector('#journey-full-map'),
  journeyGuide: document.querySelector('#checkout-journey'),
  journeyNext: document.querySelector('#journey-next'),
  journeyPrevious: document.querySelector('#journey-previous'),
  journeyStepPaths: document.querySelector('#journey-step-paths'),
  journeySteps: document.querySelector('#journey-steps'),
  journeySummary: document.querySelector('#journey-summary'),
  journeyTitle: document.querySelector('#journey-heading'),
  mapEmpty: document.querySelector('#map-empty'),
  mapHeading: document.querySelector('#map-heading'),
  mapInstructions: document.querySelector('#map-instructions'),
  mapKicker: document.querySelector('#map-kicker'),
  mapSubtitle: document.querySelector('#map-subtitle'),
  mapToolbar: document.querySelector('#map-toolbar'),
  mapViewport: document.querySelector('#map-viewport'),
  nodeIndex: document.querySelector('#node-index'),
  packetDirection: document.querySelector('#packet-direction'),
  repositoryLink: document.querySelector('#repository-link'),
  repositoryRevision: document.querySelector('#repository-revision'),
  layoutReset: document.querySelector('#layout-reset'),
  rotateLeft: document.querySelector('#rotate-left'),
  rotateRight: document.querySelector('#rotate-right'),
  sceneReadme: document.querySelector('#scene-readme'),
  sceneSummary: document.querySelector('#scene-summary'),
  searchCount: document.querySelector('#search-count'),
  searchResults: document.querySelector('#search-results'),
  mapEmptyReset: document.querySelector('#map-empty-reset'),
  statusFilter: document.querySelector('#status-filter'),
  statusReset: document.querySelector('#status-reset'),
  tiltDown: document.querySelector('#tilt-down'),
  tiltUp: document.querySelector('#tilt-up'),
  truthGrid: document.querySelector('#truth-grid'),
  truthSemantics: document.querySelector('#truth-semantics'),
  workspaceButton: document.querySelector('#workspace-button'),
  zoomIn: document.querySelector('#zoom-in'),
  zoomLevel: document.querySelector('#zoom-level'),
  zoomOut: document.querySelector('#zoom-out'),
  cameraReset: document.querySelector('#camera-reset'),
  gizmoHome: document.querySelector('#gizmo-home'),
  gizmoNeedle: document.querySelector('#gizmo-needle'),
  gizmoReadout: document.querySelector('#gizmo-readout'),
  gizmoRoot: document.querySelector('#orientation-gizmo'),
  gizmoTrackball: document.querySelector('#gizmo-trackball'),
  onboardingBody: document.querySelector('#onboarding-body'),
  onboardingCard: document.querySelector('.onboarding-card'),
  onboardingPrev: document.querySelector('#onboarding-prev'),
  onboardingNext: document.querySelector('#onboarding-next'),
  onboardingOverlay: document.querySelector('#onboarding-overlay'),
  onboardingSkip: document.querySelector('#onboarding-skip'),
  onboardingSpotlight: document.querySelector('#onboarding-spotlight'),
  onboardingStepLabel: document.querySelector('#onboarding-step-label'),
  onboardingTitle: document.querySelector('#onboarding-title'),
  tourStart: document.querySelector('#tour-start'),
  viewClearSave: document.querySelector('#view-clear-save'),
  viewReset: document.querySelector('#view-reset'),
  viewSave: document.querySelector('#view-save'),
};

const state = {
  activeStatuses: new Set(ATLAS_CONTRACT.statuses),
  camera: cameraPreset('overview'),
  customPositions: new Map(),
  dragging: false,
  drawerReturnFocus: null,
  guideVisible: false,
  hoveredNodeId: null,
  flowStep: 0,
  journeyStep: 0,
  labelsVisible: true,
  lens: 'system',
  mode: 'perspective',
  nativeFullscreen: false,
  inspectorVisible: false,
  inspectorReturnFocus: null,
  interactionMode: 'pan',
  openDrawer: null,
  query: '',
  repositoryLens: 'system',
  returnFocus: null,
  selectedFlowId: DEFAULT_FLOW_ID,
  selectedJourneyId: DEFAULT_JOURNEY_ID,
  selectedNodeId: DEFAULT_NODE_ID,
  spacingMode: 'distributed',
  mapDensity: 'all',
  journeyDensity: 'modules',
};

const pointer = {
  arrangingGroupKey: null,
  arrangingNodeId: null,
  gizmoDragging: false,
  gizmoRepositioning: false,
  lastX: 0,
  lastY: 0,
  startX: 0,
  startY: 0,
  moved: false,
  operation: null,
};

const onboarding = {
  active: false,
  step: 0,
};

let mapRenderFrame = 0;
// True while the SVG layer is being replaced, so its focus events are not mistaken for the user's.
let replacingMapLayer = false;
let mapRenderFlags = { lightweight: false, forceFull: false };

function scheduleRenderMap({ lightweight = false, forceFull = false } = {}) {
  if (forceFull) mapRenderFlags.forceFull = true;
  if (!lightweight) mapRenderFlags.lightweight = false;
  else if (!mapRenderFlags.forceFull) mapRenderFlags.lightweight = true;
  if (mapRenderFrame) return;
  mapRenderFrame = requestAnimationFrame(() => {
    mapRenderFrame = 0;
    const lightweightPass = mapRenderFlags.lightweight && !mapRenderFlags.forceFull;
    mapRenderFlags = { lightweight: false, forceFull: false };
    renderMap({ lightweight: lightweightPass });
  });
}

function flushRenderMap() {
  if (mapRenderFrame) {
    cancelAnimationFrame(mapRenderFrame);
    mapRenderFrame = 0;
  }
  mapRenderFlags = { lightweight: false, forceFull: false };
  renderMap({ lightweight: false });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function titleCase(value) {
  return value.replaceAll('-', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function repositoryFileUrl(path) {
  const encodedPath = path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  const kind = path.endsWith('/') ? 'tree' : 'blob';
  return `${REPOSITORY_URL}/${kind}/${ATLAS_DATA.meta.repositoryRevision}/${encodedPath}`;
}

function clamp(value, lower, upper) {
  return Math.min(Math.max(value, lower), upper);
}

function announce(message) {
  dom.announcer.textContent = message;
}

function clearSearch() {
  state.query = '';
  dom.atlasSearch.value = '';
}

function getActiveFlow() {
  return flowById.get(state.selectedFlowId) ?? FLOWS[0] ?? null;
}

function getActiveJourney() {
  return journeyById.get(state.selectedJourneyId) ?? ATLAS_DATA.journeys?.[0] ?? null;
}

function getJourneyStep(journey = getActiveJourney()) {
  if (!journey) return null;
  return journey.steps[clamp(state.journeyStep, 0, journey.steps.length - 1)] ?? null;
}

function journeyStepNodeIds(journey, step) {
  const flow = flowById.get(journey.flowId);
  if (!flow) return [];
  return flow.nodeIds.slice(step.startHop, step.endHop + 1);
}

function journeyStepEdgeIds(journey, step) {
  const flow = flowById.get(journey.flowId);
  if (!flow) return [];
  const firstEdge = step.startHop === 0 ? 0 : step.startHop - 1;
  return flow.edgeIds.slice(firstEdge, step.endHop);
}

function journeyStageNodes(journey = getActiveJourney()) {
  const flow = journey ? flowById.get(journey.flowId) : null;
  if (!journey || !flow) return [];
  return journey.steps.map((step, index) => {
    const nodeId = step.stageNodeId ?? flow.nodeIds[step.startHop];
    return { index: index + 1, nodeId, step };
  });
}

function renderJourneyStagePath(journey = getActiveJourney()) {
  // The flat layout already labels each module. Repeated chapter captions collide.
  if (state.mode === 'flat') return '';
  const stages = journeyStageNodes(journey)
    .map((stage) => {
      const node = nodeById.get(stage.nodeId);
      if (!node) return null;
      const position = getNodePosition(node);
      return {
        ...stage,
        point: projectPoint(position),
        ground: projectGroundPoint(position),
        label: node.shortLabel,
        active: stage.index - 1 === state.journeyStep,
      };
    })
    .filter(Boolean);
  if (stages.length < 2) return '';
  const path = stages
    .map((stage, index) => `${index === 0 ? 'M' : 'L'} ${stage.point.x} ${stage.point.y}`)
    .join(' ');
  const beads = stages
    .map((stage) => `
      <g class="journey-stage-anchor${stage.active ? ' is-active-stage' : ''}" data-stage="${stage.index}">
        <circle class="journey-stage-bead" cx="${stage.point.x}" cy="${stage.point.y}" r="${stage.active ? 5 : 3.5}"></circle>
        <text class="journey-stage-index" x="${stage.point.x}" y="${stage.point.y + 3.2}">${stage.index}</text>
        <text class="journey-stage-caption" x="${stage.point.x}" y="${stage.ground.y + 22}">${escapeHtml(stage.step.title)}</text>
      </g>`)
    .join('');
  return `<g class="journey-stage-path" aria-hidden="true"><path class="journey-stage-line" d="${path}"></path>${beads}</g>`;
}

function journeySearchText(journey) {
  return [
    journey.label,
    journey.status,
    journey.description,
    journey.entryBoundary,
    journey.completionBoundary,
    ...journey.steps.flatMap((step) => [step.title, step.description, step.boundary]),
  ]
    .join(' ')
    .toLocaleLowerCase();
}

function syncJourneyStepToFlow(flow = getActiveFlow()) {
  const journey = getActiveJourney();
  if (!journey || journey.flowId !== flow.id) return;
  const nextStep = journey.steps.findIndex(
    (step) => state.flowStep >= step.startHop && state.flowStep <= step.endHop,
  );
  if (nextStep >= 0) state.journeyStep = nextStep;
}

function nodeSearchText(node) {
  return [
    node.label,
    node.shortLabel,
    node.type,
    node.status,
    node.purpose,
    ...node.paths,
    ...node.tags,
    ...node.trace,
    ...node.boundaries,
  ]
    .join(' ')
    .toLocaleLowerCase();
}

function flowSearchText(flow) {
  return [flow.label, flow.status, flow.description, ...flow.cautions, ...flow.nodeIds]
    .join(' ')
    .toLocaleLowerCase();
}

function matchesFlow(flow, query = state.query) {
  return Boolean(query) && flowSearchText(flow).includes(query.toLocaleLowerCase());
}

function nodeMatchesQuery(node) {
  if (!state.query) return true;
  if (nodeSearchText(node).includes(state.query.toLocaleLowerCase())) return true;
  const query = state.query.toLocaleLowerCase();
  return (
    FLOWS.some((flow) => flow.nodeIds.includes(node.id) && matchesFlow(flow)) ||
    (ATLAS_DATA.journeys ?? []).some((journey) => {
      const flow = flowById.get(journey.flowId);
      return flow?.nodeIds.includes(node.id) && journeySearchText(journey).includes(query);
    })
  );
}

function getVisibleNodes() {
  const matchingNodes = ATLAS_DATA.nodes.filter(
    (node) => state.activeStatuses.has(node.status) && nodeMatchesQuery(node),
  );
  if (state.lens !== 'journey') return matchingNodes;
  const journey = getActiveJourney();
  const flow = journey ? flowById.get(journey.flowId) : null;
  if (!flow) return matchingNodes;
  const journeyNodeIds = new Set(flow.nodeIds);
  return matchingNodes.filter((node) => journeyNodeIds.has(node.id));
}

function organicJitter(seed, amount) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 33 + seed.charCodeAt(index)) >>> 0;
  }
  const x = ((hash % 1000) / 1000 - 0.5) * amount;
  const y = ((((hash / 1000) | 0) % 1000) / 1000 - 0.5) * amount;
  return { x, y };
}

function getRepositoryLayoutPositions() {
  const groups = [...new Set(ATLAS_DATA.nodes.map((node) => node.layout))].sort();
  const positionMap = new Map();
  groups.forEach((layout, groupIndex) => {
    const groupNodes = ATLAS_DATA.nodes.filter((node) => node.layout === layout);
    const column = groupIndex % 4;
    const row = Math.floor(groupIndex / 4);
    groupNodes.forEach((node, index) => {
      const localColumn = index % 2;
      const localRow = Math.floor(index / 2);
      const jitter = organicJitter(node.id, 3.2);
      positionMap.set(node.id, {
        x: 6 + column * 28 + localColumn * 11 + jitter.x,
        y: 88 - row * 28 - localRow * 12 + jitter.y,
        z: Math.max(6, node.position.z - 3),
      });
    });
  });
  return positionMap;
}

function getDistributedPositions(lens) {
  const groupKey = lens === 'system' ? 'district' : 'layout';
  const presentGroups = new Set(ATLAS_DATA.nodes.map((node) => node[groupKey]));
  const groups = lens === 'system'
    ? ATLAS_DATA.districts.map((district) => district.id).filter((id) => presentGroups.has(id))
    : [...presentGroups].sort();
  // Neighborhood anchors sit at the edges of the city so first paint is not a center pile
  const cityAnchors = [
    { x: 14, y: 84 }, { x: 50, y: 92 }, { x: 86, y: 84 },
    { x: 8, y: 52 }, { x: 50, y: 54 }, { x: 92, y: 52 },
    { x: 16, y: 18 }, { x: 50, y: 12 }, { x: 86, y: 20 },
  ];
  const columns = lens === 'system' ? 3 : 4;
  const rows = Math.max(1, Math.ceil(groups.length / columns));
  const marginX = 1;
  const marginY = 2;
  const cellWidth = (100 - marginX * 2) / columns;
  const cellHeight = (100 - marginY * 2) / rows;
  const positionMap = new Map();

  groups.forEach((group, groupIndex) => {
    const groupNodes = ATLAS_DATA.nodes
      .filter((node) => node[groupKey] === group)
      .sort((first, second) => second.position.y - first.position.y || first.shortLabel.localeCompare(second.shortLabel));
    const localColumns = Math.min(2, Math.max(1, Math.ceil(Math.sqrt(groupNodes.length))));
    const localRows = Math.ceil(groupNodes.length / localColumns);
    const groupColumn = groupIndex % columns;
    const groupRow = Math.floor(groupIndex / columns);
    const anchor = cityAnchors[groupIndex] ?? {
      x: marginX + cellWidth * (groupColumn + 0.5),
      y: 100 - marginY - cellHeight * (groupRow + 0.5),
    };
    const stepX = localColumns > 1 ? 15 : 0;
    const stepY = localRows > 1 ? 14 : 0;

    groupNodes.forEach((node, nodeIndex) => {
      const localColumn = nodeIndex % localColumns;
      const localRow = Math.floor(nodeIndex / localColumns);
      const jitter = organicJitter(node.id, 5.8);
      positionMap.set(node.id, {
        x: clamp(anchor.x + (localColumn - (localColumns - 1) / 2) * stepX + jitter.x, 2, 98),
        y: clamp(anchor.y + ((localRows - 1) / 2 - localRow) * stepY + jitter.y, 2, 98),
        z: clamp(6 + node.position.z * 0.55, 6, 22),
      });
    });
  });

  return positionMap;
}

const repositoryLayoutPositions = getRepositoryLayoutPositions();
const distributedPositions = {
  repository: getDistributedPositions('repository'),
  system: getDistributedPositions('system'),
};
const flatLayouts = {
  system: flatLayout(ATLAS_DATA.nodes),
  repository: flatLayout(ATLAS_DATA.nodes, 'layout'),
};
const flatFlowLayouts = new Map(FLOWS.map((flow) => [flow.id, flatFlowLayout(flow.nodeIds)]));
function currentFlatLayout() {
  return state.lens === 'journey' ? flatFlowLayouts.get(getActiveFlow()?.id) : flatLayouts[state.lens];
}

function positionKey(nodeId, lens = state.lens, spacingMode = state.spacingMode) {
  return `${lens}:${spacingMode}:${nodeId}`;
}

function getNodePosition(node) {
  if (state.mode === 'flat') return currentFlatLayout()?.positions.get(node.id) ?? node.position;
  const customPosition = state.customPositions.get(positionKey(node.id));
  if (customPosition) return customPosition;
  if (state.lens === 'journey') return JOURNEY_POSITIONS.get(node.id) ?? node.position;
  if (state.spacingMode === 'distributed') return distributedPositions[state.lens]?.get(node.id) ?? node.position;
  return state.lens === 'system' ? node.position : repositoryLayoutPositions.get(node.id) ?? node.position;
}

function getGroupKey(node) {
  if (state.lens === 'journey') return getActiveJourney()?.id ?? 'guided-journey';
  return state.lens === 'system' ? node.district : node.layout;
}

function getGroupLabel(groupKey) {
  if (state.lens === 'journey') return getActiveJourney()?.label ?? 'Walkthrough';
  if (state.lens === 'repository') return groupKey;
  return districtById.get(groupKey)?.label ?? groupKey;
}

function getGroupColor(groupKey) {
  if (state.lens === 'journey') return '#0057d9';
  if (state.lens === 'repository') return '#52606d';
  return districtById.get(groupKey)?.color ?? '#52606d';
}

function projectPoint(position) {
  if (isGpuDepth()) {
    const height = gpuCity.buildingHeight(position, {
      journey: state.lens === 'journey',
      selected: false,
    });
    const world = gpuCity.atlasToWorld({ ...position, z: 0 });
    return gpuCity.worldToViewBox({ x: world.x, y: height, z: world.z });
  }

  if (state.mode === 'flat') {
    return {
      x: 70 + position.x * 9.65,
      y: 635 - position.y * 5.55,
    };
  }

  const radians = ((state.camera.bearing + 45) * Math.PI) / 180;
  const deltaX = position.x - 50;
  const deltaY = position.y - 50;
  const rotatedX = deltaX * Math.cos(radians) - deltaY * Math.sin(radians);
  const rotatedY = deltaX * Math.sin(radians) + deltaY * Math.cos(radians);
  // Pitch morphs isometric → true top-down so orbit can level the low/high sides.
  const pitchT = clamp(state.camera.pitch / 90, 0, 1);
  const isoScale = 5.28;
  const topScale = 7.05;
  const groundPitch = 0.55 + pitchT * 3.15;
  const isoX = (rotatedX - rotatedY) * isoScale;
  const isoY = (rotatedX + rotatedY) * groundPitch;
  const topX = rotatedX * topScale;
  const topY = rotatedY * topScale;
  const height = position.z * (state.camera.depth / 24) * 1.88 * (1 - pitchT * 0.72);

  return {
    x: 560 + isoX + (topX - isoX) * pitchT,
    y: 388 + isoY + (topY - isoY) * pitchT - height,
  };
}

function projectGroundPoint(position) {
  return projectPoint({ ...position, z: 0 });
}

function flatFraming() {
  const layoutFit = currentFlatLayout()?.fit ?? 1;
  if (window.innerWidth <= 760) return { fit: layoutFit, offsetX: 0 };
  const bounds = dom.atlasMap.getBoundingClientRect();
  const scale = Math.min(bounds.width / 1120, bounds.height / 700) || 1;
  const guide = document.querySelector('#checkout-journey');
  const left = state.guideVisible ? (guide?.getBoundingClientRect().width || 356) + 40 : 0;
  const right = state.inspectorVisible ? (dom.inspectorPanel.getBoundingClientRect().width || 380) + 40 : 0;
  return {
    fit: layoutFit * Math.max(0.4, (bounds.width - left - right - 48) / bounds.width),
    offsetX: (left - right) / (2 * scale),
  };
}

function mapTransform() {
  if (isGpuDepth()) return '';
  const { panX, panY, zoom } = state.camera;
  const { fit, offsetX } = state.mode === 'flat' ? flatFraming() : { fit: 1, offsetX: 0 };
  return `translate(${panX + offsetX} ${panY}) translate(560 350) scale(${zoom * fit}) translate(-560 -350)`;
}

function screenPoint(point) {
  if (isGpuDepth()) return point;
  const { fit, offsetX } = state.mode === 'flat' ? flatFraming() : { fit: 1, offsetX: 0 };
  return {
    x: 560 + (point.x - 560) * state.camera.zoom * fit + state.camera.panX + offsetX,
    y: 350 + (point.y - 350) * state.camera.zoom * fit + state.camera.panY,
  };
}

function normalizeBearing(value) {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return Math.round(normalized * 10) / 10;
}

function svgDeltaFromPointer(deltaX, deltaY) {
  const bounds = dom.atlasMap.getBoundingClientRect();
  const viewBox = dom.atlasMap.viewBox.baseVal;
  const scale = Math.min(bounds.width / viewBox.width, bounds.height / viewBox.height) || 1;
  return { x: deltaX / scale, y: deltaY / scale };
}

function getNodeColor(node) {
  return districtById.get(node.district)?.color ?? '#52606d';
}

function relatedNodeIds(nodeId = state.selectedNodeId) {
  const related = new Set([nodeId]);
  if (!nodeId) return related;
  ATLAS_DATA.edges.forEach((edge) => {
    if (edge.from === nodeId) related.add(edge.to);
    if (edge.to === nodeId) related.add(edge.from);
  });
  return related;
}

function boundsForPoints(points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    height: Math.max(...ys) - Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
  };
}

function edgePath(fromPoint, toPoint) {
  const deltaX = toPoint.x - fromPoint.x;
  const deltaY = toPoint.y - fromPoint.y;
  const length = Math.max(Math.hypot(deltaX, deltaY), 1);
  const curve = clamp(length * 0.13, 18, 54);
  const controlX = (fromPoint.x + toPoint.x) / 2 - (deltaY / length) * curve;
  const controlY = (fromPoint.y + toPoint.y) / 2 + (deltaX / length) * curve;
  return `M ${fromPoint.x} ${fromPoint.y} Q ${controlX} ${controlY} ${toPoint.x} ${toPoint.y}`;
}

function polygonPath(points) {
  return `${points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')} Z`;
}

/** Soft elliptical neighborhood wash on the ground plane (no hard district box). */
function districtWashPath(minX, maxX, minY, maxY, { inflate = 1 } = {}) {
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rx = ((maxX - minX) / 2) * inflate;
  const ry = ((maxY - minY) / 2) * inflate;
  const points = [];
  const steps = 20;
  for (let index = 0; index < steps; index += 1) {
    const angle = (Math.PI * 2 * index) / steps;
    points.push(projectGroundPoint({
      x: cx + Math.cos(angle) * rx,
      y: cy + Math.sin(angle) * ry,
    }));
  }
  return polygonPath(points);
}

function renderGroundPlane() {
  if (isGpuDepth() || state.mode === 'flat') return '';
  // Wider city pad so first paint is not cramped into a tight diamond
  const min = -8;
  const max = 108;
  const corners = [
    projectGroundPoint({ x: min, y: min }),
    projectGroundPoint({ x: max, y: min }),
    projectGroundPoint({ x: max, y: max }),
    projectGroundPoint({ x: min, y: max }),
  ];
  const gridLines = [];
  for (let value = 0; value <= 100; value += 12) {
    const horizontalStart = projectGroundPoint({ x: min, y: value });
    const horizontalEnd = projectGroundPoint({ x: max, y: value });
    const verticalStart = projectGroundPoint({ x: value, y: min });
    const verticalEnd = projectGroundPoint({ x: value, y: max });
    gridLines.push(`M ${horizontalStart.x} ${horizontalStart.y} L ${horizontalEnd.x} ${horizontalEnd.y}`);
    gridLines.push(`M ${verticalStart.x} ${verticalStart.y} L ${verticalEnd.x} ${verticalEnd.y}`);
  }

  return `
    <g class="city-ground" aria-hidden="true">
      <path class="city-ground-fill" d="${polygonPath(corners)}"></path>
      <path class="city-ground-grid" d="${gridLines.join(' ')}"></path>
    </g>`;
}

function getMapDensity() {
  return state.lens === 'journey' ? state.journeyDensity : state.mapDensity;
}

function renderDistricts(visibleNodes) {
  if (getMapDensity() === 'modules') return '';
  const groupMap = new Map();
  visibleNodes.forEach((node) => {
    const key = getGroupKey(node);
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(node);
  });

  return [...groupMap.entries()]
    .map(([groupKey, nodes]) => {
      const color = getGroupColor(groupKey);
      const isActive = nodes.some((node) => node.id === state.selectedNodeId);
      const countLabel = String(nodes.length);
      if (isGpuDepth()) {
        // The pad itself is drawn by the immersive renderer; keep an invisible ground hit so Move can drag an area.
        const positions = nodes.map((node) => getNodePosition(node));
        const pad = 8.5;
        const bounds = {
          minX: Math.min(...positions.map((position) => position.x)) - pad,
          maxX: Math.max(...positions.map((position) => position.x)) + pad,
          minY: Math.min(...positions.map((position) => position.y)) - pad,
          maxY: Math.max(...positions.map((position) => position.y)) + pad,
        };
        return `
          <g class="district-group${isActive ? ' is-active-district' : ''}" data-group-key="${escapeHtml(groupKey)}" style="--district-color:${color}">
            <polygon class="gpu-district-hit" points="${gpuCity.groundPolygon(bounds)}"><title>${escapeHtml(`${getGroupLabel(groupKey)} · ${countLabel} modules`)}</title></polygon>
          </g>`;
      }
      if (state.mode === 'flat') {
        const bounds = boundsForPoints(nodes.map((node) => projectPoint(getNodePosition(node))));
        const x = bounds.minX - 98;
        const y = bounds.minY - 70;
        const width = Math.max(bounds.width + 196, 196);
        const height = Math.max(bounds.height + 104, 104);
        return `
          <g class="district-group${isActive ? ' is-active-district' : ''}" data-group-key="${escapeHtml(groupKey)}" style="--district-color:${color}">
            <rect class="district-hull-shadow" x="${x + 2}" y="${y + 4}" width="${width}" height="${height}" rx="32"></rect>
            <rect class="district-hull" x="${x}" y="${y}" width="${width}" height="${height}" rx="32"></rect>
            <rect class="district-hit" x="${x}" y="${y}" width="${width}" height="${height}" rx="32"></rect>
            <text class="district-label" x="${x + width / 2}" y="${y + 24}" text-anchor="middle">${escapeHtml(getGroupLabel(groupKey))}</text>
            <text class="district-count" x="${x + width / 2}" y="${y + 40}" text-anchor="middle">${countLabel} modules</text>
            <text class="district-move-hint" x="${x + width / 2}" y="${y + 54}" text-anchor="middle">Move area</text>
          </g>`;
      }

      const positions = nodes.map((node) => getNodePosition(node));
      const pad = getMapDensity() === 'districts' ? 11 : 9.5;
      const minX = Math.min(...positions.map((position) => position.x)) - pad;
      const maxX = Math.max(...positions.map((position) => position.x)) + pad;
      const minY = Math.min(...positions.map((position) => position.y)) - pad;
      const maxY = Math.max(...positions.map((position) => position.y)) + pad;
      const washOuter = districtWashPath(minX, maxX, minY, maxY, { inflate: 1.18 });
      const washInner = districtWashPath(minX, maxX, minY, maxY, { inflate: 0.9 });
      const labelPoint = projectGroundPoint({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
      return `
        <g class="district-group${isActive ? ' is-active-district' : ''}" data-group-key="${escapeHtml(groupKey)}" style="--district-color:${color}">
          <path class="district-plot-shadow" d="${washOuter}"></path>
          <path class="district-plot" d="${washInner}"></path>
          <path class="district-hit" d="${washOuter}"></path>
          <text class="district-label" x="${labelPoint.x}" y="${labelPoint.y - 4}" text-anchor="middle">${escapeHtml(getGroupLabel(groupKey))}</text>
          <text class="district-count" x="${labelPoint.x}" y="${labelPoint.y + 12}" text-anchor="middle">${countLabel}</text>
          <text class="district-move-hint" x="${labelPoint.x}" y="${labelPoint.y + 26}" text-anchor="middle">Move area</text>
        </g>`;
    })
    .join('');
}

function renderEdge(edge, visibleIds, flowEdgeIds, currentFlowEdgeId, chapterEdgeIds) {
  if (isGpuDepth()) return '';
  if (!visibleIds.has(edge.from) || !visibleIds.has(edge.to)) return '';
  if (state.lens === 'journey' && !flowEdgeIds.has(edge.id)) return '';
  const fromNode = nodeById.get(edge.from);
  const toNode = nodeById.get(edge.to);
  const from = projectPoint(getNodePosition(fromNode));
  const to = projectPoint(getNodePosition(toNode));
  const classes = ['atlas-edge', `is-${edge.type}-edge`];
  const isResponse = edge.type === 'response';
  if (flowEdgeIds.has(edge.id)) classes.push('is-flow-edge');
  if (chapterEdgeIds.has(edge.id)) classes.push('is-chapter-edge');
  if (edge.id === currentFlowEdgeId) classes.push('is-flow-step');
  if (state.lens === 'journey' && !chapterEdgeIds.has(edge.id) && edge.id !== currentFlowEdgeId) {
    classes.push('is-journey-muted');
  }
  const related = relatedNodeIds();
  if (related.has(edge.from) && related.has(edge.to) && state.selectedNodeId) classes.push('is-related-edge');
  const color = EDGE_COLORS[edge.type] ?? '#52606d';
  const marker = `url(#arrow-${edge.type})`;
  return `<path class="${classes.join(' ')}" data-edge-id="${escapeHtml(edge.id)}" data-edge-type="${escapeHtml(edge.type)}" d="${edgePath(from, to)}" style="--edge-color:${color};stroke:${color}" marker-end="${marker}"><title>${escapeHtml(`${titleCase(edge.type)}: ${edge.label}`)}</title></path>`;
}

const RELATIONSHIP_COUNT = new Map(ATLAS_DATA.nodes.map((node) => [
  node.id,
  ATLAS_DATA.edges.filter((edge) => edge.from === node.id || edge.to === node.id).length,
]));
const MAX_RELATIONSHIPS = Math.max(1, ...RELATIONSHIP_COUNT.values());
const MAX_PATHS = Math.max(1, ...ATLAS_DATA.nodes.map((node) => node.paths.length));

/**
 * Footprint encodes connection count and nothing else; node type is carried by
 * the label icon. The square root keeps hubs from dwarfing their neighbors.
 */
function nodeFootprintFactor(node) {
  const hub = Math.sqrt((RELATIONSHIP_COUNT.get(node.id) ?? 0) / MAX_RELATIONSHIPS);
  return 0.80 + 0.55 * hub;
}

/**
 * Tower height in world units, from source-file count alone. Layout `z` is a
 * placement coordinate and does not contribute. The exponent keeps the low end
 * legible, and the bounds hold every tower within [1.6, 5.0] world units so no
 * value can escape the label solver or the camera framing.
 */
function nodeHeight(node) {
  const span = Math.max(1, MAX_PATHS - 1);
  const t = Math.min(1, Math.max(0, (node.paths.length - 1) / span));
  return 1.6 + 3.4 * Math.pow(t, 0.75);
}

function renderNode(node, visibleIds, flowNodeIds, currentFlowNodeId, chapterNodeIds) {
  const position = getNodePosition(node);
  const point = projectPoint(position);
  const color = getNodeColor(node);
  const related = relatedNodeIds();
  const nodeClasses = ['atlas-node'];
  if (!visibleIds.has(node.id)) nodeClasses.push('is-dimmed');
  if (node.id === state.selectedNodeId) nodeClasses.push('is-selected');
  if (node.id === state.hoveredNodeId) nodeClasses.push('is-hovered');
  if (flowNodeIds.has(node.id)) nodeClasses.push('is-flow-node');
  if (chapterNodeIds.has(node.id)) nodeClasses.push('is-chapter-node');
  if (state.selectedNodeId && related.has(node.id)) nodeClasses.push('is-related');
  if (state.inspectorVisible && state.selectedNodeId && !related.has(node.id)) nodeClasses.push('is-unrelated');
  const iconId = resolveNodeIcon(node);
  if (isGpuDepth()) {
    const points = gpuCity.hitPolygon(position, { journey: state.lens === 'journey', footprint: nodeFootprintFactor(node), nodeId: node.id });
    return `
      <g class="${nodeClasses.join(' ')}" data-node-id="${escapeHtml(node.id)}" style="--node-color:${color}" aria-label="Inspect ${escapeHtml(node.label)}" role="button" tabindex="0">
        <title>${escapeHtml(`${node.label} · ${titleCase(node.type)} · ${node.paths.join(', ')}`)}</title>
        <polygon class="gpu-hit" points="${points}"></polygon>
      </g>`;
  }
  if (state.mode === 'flat') {
    const label = node.shortLabel.length > 18 ? `${node.shortLabel.slice(0, 17)}…` : node.shortLabel;
    const plateWidth = 166;
    const plateHeight = 34;
    const plateX = point.x - plateWidth / 2;
    const plateY = point.y - plateHeight / 2;
    const iconX = plateX + 16;
    const textX = plateX + 28;
    return `
      <g class="${nodeClasses.join(' ')}" data-node-id="${escapeHtml(node.id)}" style="--node-color:${color}" aria-label="Inspect ${escapeHtml(node.label)}" role="button" tabindex="0">
        <title>${escapeHtml(`${node.label} · ${node.paths.join(', ')}`)}</title>
        <rect class="node-focus-ring node-focus-ring-flat" x="${plateX - 5}" y="${plateY - 5}" width="${plateWidth + 10}" height="${plateHeight + 10}" rx="14"></rect>
        <rect class="node-flat" x="${plateX}" y="${plateY}" width="${plateWidth}" height="${plateHeight}" rx="10"></rect>
        ${renderIconMarkup(iconId, { x: iconX, y: point.y, size: 14, className: 'node-glyph node-glyph-flat' })}
        <text class="node-flat-label" x="${textX}" y="${point.y + 4}">${escapeHtml(label)}</text>
      </g>`;
  }

  const groundPoint = projectGroundPoint(position);
  const topY = point.y;
  const halfWidth = 29 * nodeFootprintFactor(node);
  const halfHeight = halfWidth * 0.41;
  const extrusion = clamp(groundPoint.y - topY, state.lens === 'journey' ? 14 : 20, state.lens === 'journey' ? 42 : 78);
  const scale = state.lens === 'journey' ? 0.86 : 1;
  const drawHalfWidth = halfWidth * scale;
  const drawHalfHeight = halfHeight * scale;
  const drawExtrusion = extrusion * (state.lens === 'journey' ? 0.72 : 1);
  const diamond = `M ${point.x} ${topY - drawHalfHeight} L ${point.x + drawHalfWidth} ${topY} L ${point.x} ${topY + drawHalfHeight} L ${point.x - drawHalfWidth} ${topY} Z`;
  const leftFace = `M ${point.x - drawHalfWidth} ${topY} L ${point.x} ${topY + drawHalfHeight} L ${point.x} ${topY + drawHalfHeight + drawExtrusion} L ${point.x - drawHalfWidth} ${topY + drawExtrusion} Z`;
  const rightFace = `M ${point.x + drawHalfWidth} ${topY} L ${point.x} ${topY + drawHalfHeight} L ${point.x} ${topY + drawHalfHeight + drawExtrusion} L ${point.x + drawHalfWidth} ${topY + drawExtrusion} Z`;
  const glyph = renderIconMarkup(iconId, {
    x: point.x,
    y: topY - drawHalfHeight * 0.08,
    size: state.lens === 'journey' ? 13 : 16,
    className: 'node-glyph node-glyph-top',
  });
  return `
    <g class="${nodeClasses.join(' ')}" data-node-id="${escapeHtml(node.id)}" style="--node-color:${color}" aria-label="Inspect ${escapeHtml(node.label)}" role="button" tabindex="0">
      <title>${escapeHtml(`${node.label} · ${titleCase(node.type)} · ${node.paths.join(', ')}`)}</title>
      <ellipse class="node-focus-ring" cx="${point.x}" cy="${groundPoint.y + drawHalfHeight + 3}" rx="${drawHalfWidth + 8}" ry="12"></ellipse>
      <ellipse class="node-shadow" cx="${point.x}" cy="${groundPoint.y + drawHalfHeight + 6}" rx="${drawHalfWidth * 0.84}" ry="7"></ellipse>
      <path class="node-left" d="${leftFace}"></path>
      <path class="node-right" d="${rightFace}"></path>
      <path class="node-top" d="${diamond}"></path>
      ${glyph}
    </g>`;
}

function getMarkerScale() {
  const bounds = dom.atlasMap.getBoundingClientRect();
  const viewportScale = Math.min(bounds.width / 1120, bounds.height / 700) || 1;
  return clamp(1 / viewportScale, 0.82, 1.8);
}

function shouldShowMarker(node) {
  // Stage numbers live on the story path; keep a quiet selection halo only.
  return node.id === state.selectedNodeId;
}

function renderMarkers(visibleNodes, currentFlowNodeId, chapterNodeIds) {
  if (isGpuDepth() || state.mode === 'flat') return '';
  const scale = getMarkerScale();
  const nodes = visibleNodes.filter((node) => shouldShowMarker(node));

  return nodes
    .map((node) => {
      const anchor = screenPoint(projectPoint(getNodePosition(node)));
      const classes = ['node-marker', 'is-selected'];
      if (node.id === currentFlowNodeId) classes.push('is-current');
      if (chapterNodeIds.has(node.id)) classes.push('is-chapter');
      if (node.id === state.hoveredNodeId) classes.push('is-hovered');
      const pinRadius = 5.5 * scale;
      return `
        <g class="${classes.join(' ')}" data-node-id="${escapeHtml(node.id)}" role="button" tabindex="0" aria-label="Inspect ${escapeHtml(node.label)}" style="--marker-scale:${scale}">
          <title>${escapeHtml(`${node.label} · ${titleCase(node.type)} · ${titleCase(node.status)}`)}</title>
          <circle class="marker-hit" cx="${anchor.x}" cy="${anchor.y}" r="${16 * scale}"></circle>
          <circle class="marker-halo" cx="${anchor.x}" cy="${anchor.y}" r="${pinRadius + 4 * scale}"></circle>
          <circle class="marker-pin" cx="${anchor.x}" cy="${anchor.y}" r="${pinRadius}"></circle>
        </g>`;
    })
    .join('');
}

function getLabelScale() {
  const bounds = dom.atlasMap.getBoundingClientRect();
  const viewBox = dom.atlasMap.viewBox.baseVal;
  const viewportScale = Math.min(bounds.width / viewBox.width, bounds.height / viewBox.height) || 1;
  return clamp(1 / viewportScale, 0.78, 2.9);
}

function labelBoxesOverlap(first, second, gap) {
  return !(
    first.x + first.width + gap <= second.x ||
    second.x + second.width + gap <= first.x ||
    first.y + first.height + gap <= second.y ||
    second.y + second.height + gap <= first.y
  );
}

function ambientLabelCandidates(anchor, width, height, scale, { lightweight = false } = {}) {
  const horizontalGap = 18 * scale;
  const verticalGap = 24 * scale;
  const viewBox = dom.atlasMap.viewBox.baseVal;
  const minX = viewBox.x + 8 * scale;
  const minY = viewBox.y + 8 * scale;
  const maxX = viewBox.x + viewBox.width - width - 8 * scale;
  const maxY = viewBox.y + viewBox.height - height - 8 * scale;
  const candidates = [
    { x: anchor.x + horizontalGap, y: anchor.y - height - verticalGap },
    { x: anchor.x - width - horizontalGap, y: anchor.y - height - verticalGap },
    { x: anchor.x + horizontalGap, y: anchor.y + verticalGap },
    { x: anchor.x - width - horizontalGap, y: anchor.y + verticalGap },
    { x: anchor.x - width / 2, y: anchor.y - height - verticalGap * 1.45 },
    { x: anchor.x - width / 2, y: anchor.y + verticalGap * 1.45 },
  ];
  if (lightweight) {
    return candidates
      .map((candidate) => ({
        x: clamp(candidate.x, minX, maxX),
        y: clamp(candidate.y, minY, maxY),
      }));
  }
  const angles = Array.from({ length: 24 }, (_, index) => -90 + index * 15);
  [42, 64, 88, 112, 136, 160, 188].forEach((radius) => {
    angles.forEach((angle) => {
      const radians = (angle * Math.PI) / 180;
      candidates.push({
        x: anchor.x + Math.cos(radians) * radius * scale - width / 2,
        y: anchor.y + Math.sin(radians) * radius * scale - height / 2,
      });
    });
  });
  return candidates
    .map((candidate) => ({
      x: clamp(candidate.x, minX, maxX),
      y: clamp(candidate.y, minY, maxY),
    }))
    .sort((first, second) => {
      const firstDistance = Math.hypot(first.x + width / 2 - anchor.x, first.y + height / 2 - anchor.y);
      const secondDistance = Math.hypot(second.x + width / 2 - anchor.x, second.y + height / 2 - anchor.y);
      return firstDistance - secondDistance;
    });
}

function adaptiveLabelNodes(visibleNodes, currentFlowNodeId, chapterNodeIds) {
  if (state.lens === 'journey') {
    const stageIds = new Set(journeyStageNodes().map((stage) => stage.nodeId));
    return visibleNodes.filter((node) =>
      node.id === state.selectedNodeId
      || node.id === currentFlowNodeId
      || chapterNodeIds?.has(node.id)
      || stageIds.has(node.id)
      || node.id === state.hoveredNodeId);
  }
  if (!window.matchMedia('(max-width: 760px)').matches) return visibleNodes;
  const labelIds = new Set([state.selectedNodeId]);
  const typePriority = new Map([
    ['surface', 0],
    ['route', 1],
    ['controller', 2],
    ['service', 3],
    ['provider', 4],
    ['policy', 5],
    ['database', 6],
    ['configuration', 7],
    ['external-system', 8],
    ['documentation', 9],
  ]);
  const groupedNodes = new Map();
  visibleNodes.forEach((node) => {
    const groupKey = getGroupKey(node);
    if (!groupedNodes.has(groupKey)) groupedNodes.set(groupKey, []);
    groupedNodes.get(groupKey).push(node);
  });
  groupedNodes.forEach((nodes) => {
    const representative = [...nodes].sort((first, second) =>
      (typePriority.get(first.type) ?? 99) - (typePriority.get(second.type) ?? 99)
      || first.shortLabel.length - second.shortLabel.length
      || first.shortLabel.localeCompare(second.shortLabel))[0];
    if (representative) labelIds.add(representative.id);
  });
  return visibleNodes.filter((node) => labelIds.has(node.id));
}

function renderLabels(visibleNodes, currentFlowNodeId, chapterNodeIds, { lightweight = false } = {}) {
  if (!state.labelsVisible || isGpuDepth()) return '';
  const scale = getLabelScale();
  const occupied = visibleNodes.map((node) => {
    const position = getNodePosition(node);
    const anchor = screenPoint(projectPoint(position));
    if (state.mode === 'flat') {
      return {
        x: anchor.x - 44 * state.camera.zoom,
        y: anchor.y - 24 * state.camera.zoom,
        width: 88 * state.camera.zoom,
        height: 48 * state.camera.zoom,
      };
    }
    const ground = screenPoint(projectGroundPoint(position));
    const halfWidth = 36 * nodeFootprintFactor(node) * state.camera.zoom;
    return {
      x: anchor.x - halfWidth,
      y: anchor.y - 20 * state.camera.zoom,
      width: halfWidth * 2,
      height: Math.max(54, ground.y - anchor.y + 34 * state.camera.zoom),
    };
  });
  const nodes = adaptiveLabelNodes(visibleNodes, currentFlowNodeId, chapterNodeIds).sort((first, second) => {
    const priority = (node) =>
      Number(node.id === state.selectedNodeId) * 4 +
      Number(node.id === currentFlowNodeId) * 3 +
      Number(chapterNodeIds.has(node.id)) * 2;
    const priorityDifference = priority(second) - priority(first);
    if (priorityDifference) return priorityDifference;
    const firstPoint = screenPoint(projectPoint(getNodePosition(first)));
    const secondPoint = screenPoint(projectPoint(getNodePosition(second)));
    return secondPoint.y - firstPoint.y || first.shortLabel.localeCompare(second.shortLabel);
  });

  return nodes
    .map((node) => {
      const anchor = screenPoint(projectPoint(getNodePosition(node)));
      const width = clamp(node.shortLabel.length * 5.7 + 20, 72, 142) * scale;
      const height = 24 * scale;
      const candidates = ambientLabelCandidates(anchor, width, height, scale, { lightweight });
      const collisionFreeBox = candidates.find((candidate) =>
        occupied.every((placed) => !labelBoxesOverlap({ ...candidate, width, height }, placed, 4 * scale)),
      );
      const isPriorityLabel = node.id === state.selectedNodeId
        || node.id === currentFlowNodeId
        || chapterNodeIds.has(node.id)
        || node.id === state.hoveredNodeId;
      const box = lightweight ? candidates[0] : collisionFreeBox ?? (isPriorityLabel ? candidates[0] : null);
      if (!box) return '';
      occupied.push({ ...box, width, height });
      const connectorX = clamp(anchor.x, box.x, box.x + width);
      const connectorY = clamp(anchor.y, box.y, box.y + height);
      const classes = ['node-label'];
      if (node.id === state.selectedNodeId) classes.push('is-selected');
      if (node.id === currentFlowNodeId) classes.push('is-current');
      if (chapterNodeIds.has(node.id)) classes.push('is-chapter');
      if (node.id === state.hoveredNodeId) classes.push('is-hovered');
      return `
        <g class="${classes.join(' ')}" data-node-id="${escapeHtml(node.id)}" aria-hidden="true" style="--label-scale:${scale}">
          <title>${escapeHtml(`${node.label} · ${node.paths.join(', ')}`)}</title>
          <path class="label-leader" d="M ${anchor.x} ${anchor.y} L ${connectorX} ${connectorY}"></path>
          <circle class="label-anchor" cx="${anchor.x}" cy="${anchor.y}" r="${2.2 * scale}"></circle>
          <rect class="label-plate" x="${box.x}" y="${box.y}" width="${width}" height="${height}" rx="${height / 2}"></rect>
          <text class="label-title" x="${box.x + width / 2}" y="${box.y + height / 2 + 3.2 * scale}">${escapeHtml(node.shortLabel)}</text>
        </g>`;
    })
    .join('');
}

/** Semantic scene description for the immersive renderer (positions stay in atlas units). */
function collectSceneData({ visibleNodes, visibleIds, flowEdgeIds, currentFlowEdgeId, chapterEdgeIds, currentFlowNodeId, chapterNodeIds }) {
  const journey = state.lens === 'journey';
  const focusId = !journey && state.inspectorVisible ? state.selectedNodeId : null;
  const related = focusId ? relatedNodeIds(focusId) : null;
  const showDistricts = getMapDensity() !== 'modules';
  const showModules = getMapDensity() !== 'districts';
  const stageByNode = new Map(journey ? journeyStageNodes().map((stage) => [stage.nodeId, stage.index]) : []);
  const activeStage = journey ? state.journeyStep + 1 : null;

  const nodes = showModules
    ? visibleNodes.map((node) => {
      const stage = stageByNode.get(node.id) ?? null;
      return {
        id: node.id,
        shortLabel: node.shortLabel,
        icon: resolveNodeIcon(node),
        position: getNodePosition(node),
        color: getNodeColor(node),
        footprint: nodeFootprintFactor(node),
        height: nodeHeight(node) * (journey ? 0.9 : 1),
        selected: node.id === state.selectedNodeId,
        hovered: node.id === state.hoveredNodeId,
        current: journey && node.id === currentFlowNodeId,
        chapter: journey && chapterNodeIds.has(node.id),
        stage,
        activeStage: stage !== null && stage === activeStage,
        dim: Boolean(related && !related.has(node.id)),
      };
    })
    : [];

  const edges = showModules
    ? ATLAS_DATA.edges
      .filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to))
      .map((edge) => {
        const inFlow = flowEdgeIds.has(edge.id);
        const hidden = journey && !inFlow;
        const isCurrent = journey && edge.id === currentFlowEdgeId;
        const isChapter = journey && chapterEdgeIds.has(edge.id);
        const touchesFocus = Boolean(focusId && (edge.from === focusId || edge.to === focusId));
        const touchesHover = Boolean(state.hoveredNodeId && (edge.from === state.hoveredNodeId || edge.to === state.hoveredNodeId));
        const emphasis = journey
          ? (isCurrent ? 1 : isChapter ? 0.72 : 0.3)
          : (touchesFocus ? 1 : touchesHover ? 0.7 : 0);
        return {
          id: edge.id,
          fromId: edge.from,
          toId: edge.to,
          from: getNodePosition(nodeById.get(edge.from)),
          to: getNodePosition(nodeById.get(edge.to)),
          type: edge.type,
          color: getNodeColor(nodeById.get(edge.from)),
          style: EDGE_STYLE[edge.type] ?? 0,
          emphasis,
          dim: !journey && focusId && !touchesFocus ? 1 : 0,
          current: isCurrent,
          hidden,
        };
      })
    : [];

  const districts = [];
  if (showDistricts) {
    const groupMap = new Map();
    visibleNodes.forEach((node) => {
      const key = getGroupKey(node);
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key).push(node);
    });
    groupMap.forEach((groupNodes, groupKey) => {
      const positions = groupNodes.map((node) => getNodePosition(node));
      const pad = 8.5;
      districts.push({
        key: groupKey,
        label: getGroupLabel(groupKey),
        count: groupNodes.length,
        color: getGroupColor(groupKey),
        active: groupNodes.some((node) => node.id === state.selectedNodeId),
        minX: Math.min(...positions.map((position) => position.x)) - pad,
        maxX: Math.max(...positions.map((position) => position.x)) + pad,
        minY: Math.min(...positions.map((position) => position.y)) - pad,
        maxY: Math.max(...positions.map((position) => position.y)) + pad,
      });
    });
  }

  return {
    journey,
    labelsVisible: state.labelsVisible,
    hoveredNodeId: state.hoveredNodeId,
    selectedNodeId: state.selectedNodeId,
    nodes,
    edges,
    districts,
  };
}

function syncGpuCity(sceneInputs) {
  const canvas = document.querySelector('#atlas-gpu');
  if (!gpuCity?.ready || !canvas) return;
  const enabled = state.mode === 'perspective' && ui.surface !== 'explore';
  dom.mapViewport.classList.toggle('is-gpu-city', enabled);
  gpuCity.setActive(enabled);
  if (!enabled) return;
  gpuCity.sync(collectSceneData(sceneInputs), state.camera);
}

function renderMap({ lightweight = false } = {}) {
  dom.atlasMap.setAttribute('viewBox', mapViewBox());
  if (isGpuDepth()) gpuCity.setCamera(state.camera);
  const visibleNodes = getVisibleNodes();
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const activeFlow = getActiveFlow();
  const isJourneyView = state.lens === 'journey';
  const flowNodeIds = new Set(isJourneyView ? activeFlow.nodeIds : []);
  const flowEdgeIds = new Set(isJourneyView ? activeFlow.edgeIds : []);
  const journey = isJourneyView ? getActiveJourney() : null;
  const chapter = journey ? getJourneyStep(journey) : null;
  const chapterNodeIds = new Set(journey && chapter ? journeyStepNodeIds(journey, chapter) : []);
  const chapterEdgeIds = new Set(journey && chapter ? journeyStepEdgeIds(journey, chapter) : []);
  const currentFlowEdgeId = isJourneyView
    ? activeFlow.edgeIds[Math.min(state.flowStep, activeFlow.edgeIds.length - 1)]
    : null;
  const currentFlowNodeId = isJourneyView
    ? activeFlow.nodeIds[Math.min(state.flowStep, activeFlow.nodeIds.length - 1)]
    : null;
  const showModules = getMapDensity() !== 'districts';
  const edgeMarkup = showModules
    ? ATLAS_DATA.edges
      .map((edge) => renderEdge(edge, visibleIds, flowEdgeIds, currentFlowEdgeId, chapterEdgeIds))
      .join('')
    : '';
  const stagePathMarkup = isJourneyView && !isGpuDepth() ? renderJourneyStagePath(journey) : '';
  const nodeMarkup = showModules
    ? visibleNodes
      .map((node) => renderNode(node, visibleIds, flowNodeIds, currentFlowNodeId, chapterNodeIds))
      .join('')
    : '';
  // Flat cards already contain their own names. The floating label pass used
  // to duplicate those names and could cover a different card's hit target.
  const labelMarkup = showModules && state.mode !== 'flat'
    ? renderLabels(visibleNodes, currentFlowNodeId, chapterNodeIds, { lightweight })
    : '';
  const markerMarkup = showModules
    ? renderMarkers(visibleNodes, currentFlowNodeId, chapterNodeIds)
    : '';

  // Rebuilding the layer drops keyboard focus; hand it to the same module's new element.
  const focused = document.activeElement;
  const focusedNodeId = focused && dom.atlasMapLayer.contains(focused) ? focused.closest('[data-node-id]')?.dataset.nodeId : null;
  replacingMapLayer = true;
  dom.atlasMapLayer.innerHTML = `<g class="map-world" transform="${mapTransform()}">${renderGroundPlane()}${renderDistricts(visibleNodes)}${edgeMarkup}${stagePathMarkup}${nodeMarkup}</g><g class="map-labels">${labelMarkup}</g><g class="map-markers">${markerMarkup}</g>`;
  if (focusedNodeId) dom.atlasMapLayer.querySelector(`[data-node-id="${CSS.escape(focusedNodeId)}"]`)?.focus({ preventScroll: true });
  replacingMapLayer = false;
  syncGpuCity({ visibleNodes, visibleIds, flowEdgeIds, currentFlowEdgeId, chapterEdgeIds, currentFlowNodeId, chapterNodeIds });
  dom.mapEmpty.hidden = visibleNodes.length !== 0;
  dom.atlasMain.dataset.mapDensity = getMapDensity();
  document.querySelectorAll('.gizmo-density [data-map-density]').forEach((button) => {
    const selected = button.dataset.mapDensity === getMapDensity();
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-checked', String(selected));
  });
  renderSceneSummary(visibleNodes, visibleIds);
}

/** The caption counts what is on the map, so search and status filters stay visible. */
function renderSceneSummary(visibleNodes, visibleIds) {
  const districtCount = new Set(visibleNodes.map((node) => node.district)).size;
  const connectionCount = ATLAS_DATA.edges.filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to)).length;
  const filtered = visibleNodes.length < ATLAS_DATA.nodes.length;
  const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
  dom.sceneSummary.textContent = [
    filtered ? `${visibleNodes.length} of ${plural(ATLAS_DATA.nodes.length, 'module')}` : plural(visibleNodes.length, 'module'),
    plural(districtCount, 'district'),
    plural(connectionCount, 'connection'),
  ].join(' · ');
}

function setHoveredNode(nodeId) {
  if (state.hoveredNodeId === nodeId) return;
  state.hoveredNodeId = nodeId;
  dom.atlasMapLayer.querySelectorAll('[data-node-id]').forEach((element) => {
    element.classList.toggle('is-hovered', element.dataset.nodeId === nodeId);
  });
  if (isGpuDepth()) scheduleRenderMap({ lightweight: true });
}

function nodeIdFromTarget(target) {
  return target instanceof Element ? target.closest('[data-node-id]')?.dataset.nodeId ?? null : null;
}

function makeListItem(text) {
  const item = document.createElement('li');
  item.textContent = text;
  return item;
}

function renderInspector() {
  const node = nodeById.get(state.selectedNodeId) ?? getVisibleNodes()[0] ?? ATLAS_DATA.nodes[0];
  if (!node) return;
  state.selectedNodeId = node.id;
  dom.inspectorPanel.dataset.nodeId = node.id;
  dom.inspectorType.textContent = `${titleCase(node.type)} · ${districtById.get(node.district)?.label ?? node.district}`;
  dom.inspectorTitle.textContent = node.label;
  dom.inspectorStatus.textContent = statusLabel(node.status);
  dom.inspectorStatus.title = `Source status: ${statusLabel(node.status)}. This is not a runtime health indicator.`;
  dom.inspectorStatus.dataset.status = node.status;
  dom.inspectorPurpose.textContent = node.purpose;
  dom.copyStatus.textContent = '';

  dom.inspectorMeta.replaceChildren();
  [
    ['District', districtById.get(node.district)?.label ?? node.district],
    ['Type', titleCase(node.type)],
    ['Files', String(node.paths.length)],
    ['Connections', String(RELATIONSHIP_COUNT.get(node.id) ?? 0)],
    ['Revision', ATLAS_DATA.meta.repositoryRevision.slice(0, 7), 'mono'],
  ].forEach(([label, value, className]) => {
    const wrapper = document.createElement('div');
    const term = document.createElement('dt');
    const description = document.createElement('dd');
    term.textContent = label;
    description.textContent = value;
    if (className) description.className = className;
    wrapper.append(term, description);
    dom.inspectorMeta.append(wrapper);
  });
  dom.sourceFilesTab.textContent = `Files (${node.paths.length})`;
  dom.truthGrid.replaceChildren();
  [
    ['Source', node.truth.repository],
    ['Runtime', node.truth.runtime],
    ['Deployment', node.truth.deployment],
  ].forEach(([label, value]) => {
    const wrapper = document.createElement('div');
    const term = document.createElement('dt');
    const description = document.createElement('dd');
    term.textContent = label;
    description.textContent = value === 'unverified' ? 'Not checked' : titleCase(value);
    description.dataset.truth = value;
    wrapper.append(term, description);
    dom.truthGrid.append(wrapper);
  });

  dom.inspectorTrace.replaceChildren(...node.trace.map(makeListItem));
  dom.packetDirection.textContent = titleCase(node.packet.direction);
  dom.inspectorPacket.textContent = JSON.stringify(node.packet.schema, null, 2);

  dom.inspectorRisks.replaceChildren(...node.risks.map(makeListItem));
  dom.inspectorBoundaries.replaceChildren(...node.boundaries.map(makeListItem));
  dom.inspectorPaths.replaceChildren();
  node.paths.forEach((path) => {
    const item = document.createElement('li');
    const code = document.createElement('code');
    const actions = document.createElement('div');
    const copy = document.createElement('button');
    const open = document.createElement('a');
    const cleanPath = path.replace(/\/$/, '');
    const separator = cleanPath.lastIndexOf('/');
    const filename = cleanPath.slice(separator + 1) + (path.endsWith('/') ? '/' : '');
    const name = document.createElement('strong');
    const folder = document.createElement('span');
    code.className = 'atlas-file-path';
    code.title = path;
    name.textContent = filename;
    folder.textContent = separator < 0 ? 'Repository root' : cleanPath.slice(0, separator + 1).replaceAll('/', '/\u200b');
    code.append(name, folder);
    actions.className = 'path-row-actions';
    copy.className = 'path-copy';
    copy.type = 'button';
    copy.dataset.copyPath = path;
    copy.setAttribute('aria-label', `Copy path for ${filename}`);
    copy.title = 'Copy path';
    copy.innerHTML = '<svg width="13" height="13" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><path fill="currentColor" d="M216 32H88a8 8 0 0 0-8 8v40H40a8 8 0 0 0-8 8v128a8 8 0 0 0 8 8h128a8 8 0 0 0 8-8v-40h40a8 8 0 0 0 8-8V40a8 8 0 0 0-8-8Zm-56 176H48V96h112Zm48-48h-32V96a8 8 0 0 0-8-8H96V48h112Z"/></svg>';
    open.className = 'path-open';
    open.href = repositoryFileUrl(path);
    open.target = '_blank';
    open.rel = 'noreferrer noopener';
    open.setAttribute('aria-label', `Open ${filename} in repository`);
    open.title = 'Open file';
    open.innerHTML = '<svg width="13" height="13" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><path fill="currentColor" d="M200 64v104a8 8 0 0 1-16 0V83.31L68.68 198.63a8 8 0 0 1-11.31-11.31L172.69 72H88a8 8 0 0 1 0-16h104a8 8 0 0 1 8 8Z"/></svg>';
    actions.append(copy, open);
    item.append(code, actions);
    dom.inspectorPaths.append(item);
  });
}

function buildSearchResults() {
  const query = state.query.toLocaleLowerCase();
  if (!query) return [];
  const journeys = (ATLAS_DATA.journeys ?? [])
    .filter((journey) => state.activeStatuses.has(journey.status) && journeySearchText(journey).includes(query))
    .map((journey) => ({
      id: journey.id,
      kind: 'journey',
      label: journey.label,
      meta: `Walkthrough · ${journey.steps.length} chapters`,
    }));
  const nodes = ATLAS_DATA.nodes
    .filter((node) => state.activeStatuses.has(node.status) && nodeSearchText(node).includes(query))
    .map((node) => ({
      id: node.id,
      kind: 'node',
      label: node.label,
      meta: node.paths[0],
    }));
  const flows = FLOWS
    .filter((flow) => state.activeStatuses.has(flow.status) && flowSearchText(flow).includes(query))
    .map((flow) => ({
      id: flow.id,
      kind: 'flow',
      label: flow.label,
      meta: `${flow.status === 'gated' ? 'Conditional flow' : 'Source flow'} · ${flow.nodeIds.length} calls`,
    }));
  return [...journeys, ...flows, ...nodes].slice(0, 24);
}

function renderSearch() {
  const results = buildSearchResults();
  const visibleNodeCount = getVisibleNodes().length;
  dom.searchCount.textContent = state.query
    ? `${results.length} match${results.length === 1 ? '' : 'es'}`
    : `${visibleNodeCount} visible`;
  dom.searchResults.replaceChildren();
  dom.searchResults.classList.toggle('is-open', results.length > 0);
  results.forEach((result) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    const title = document.createElement('span');
    const meta = document.createElement('span');
    item.className = 'result-item';
    button.type = 'button';
    button.dataset.resultKind = result.kind;
    button.dataset.resultId = result.id;
    title.className = 'result-title';
    meta.className = 'result-meta';
    title.textContent = result.label;
    meta.textContent = result.meta;
    button.append(title, meta);
    item.append(button);
    dom.searchResults.append(item);
  });
}

function renderStatusFilter() {
  const counts = Object.fromEntries(
    ATLAS_CONTRACT.statuses.map((status) => [
      status,
      ATLAS_DATA.nodes.filter((node) => node.status === status).length,
    ]),
  );
  dom.statusFilter.replaceChildren();
  ATLAS_CONTRACT.statuses.forEach((status) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    const text = document.createElement('span');
    label.className = `status-option${counts[status] === 0 ? ' is-empty' : ''}`;
    input.type = 'checkbox';
    input.value = status;
    input.checked = state.activeStatuses.has(status);
    input.dataset.status = status;
    text.textContent = `${statusLabel(status)} (${counts[status]})`;
    label.append(input, text);
    dom.statusFilter.append(label);
  });
}

function renderFlowNavigator() {
  const activeFlow = getActiveFlow();
  dom.flowSelect.replaceChildren();
  FLOWS.forEach((flow) => {
    const option = document.createElement('option');
    option.value = flow.id;
    option.textContent = flow.label;
    option.title = `${statusLabel(flow.status)} · ${flow.label}`;
    option.selected = flow.id === activeFlow.id;
    dom.flowSelect.append(option);
  });
  const currentNode = nodeById.get(activeFlow.nodeIds[state.flowStep]);
  dom.flowProgress.innerHTML = `<span class="flow-progress-step">Call ${state.flowStep + 1} of ${activeFlow.nodeIds.length}</span><span class="flow-progress-label">${escapeHtml(currentNode?.label ?? currentNode?.shortLabel ?? 'Unknown')}</span>`;
  dom.flowCaution.textContent = activeFlow.cautions[state.flowStep % activeFlow.cautions.length] ?? '';
  dom.flowPrevious.disabled = state.flowStep === 0;
  dom.flowNext.disabled = state.flowStep >= activeFlow.nodeIds.length - 1;
}

function renderJourneyGuide() {
  const journey = getActiveJourney();
  const shouldShowJourney = state.lens === 'journey' && Boolean(journey);
  dom.journeyDetail.hidden = !shouldShowJourney;
  if (!journey) return;

  const step = getJourneyStep(journey);
  if (!step) return;
  const stepNodeIds = journeyStepNodeIds(journey, step);
  const sourcePaths = [...new Set(stepNodeIds.flatMap((nodeId) => nodeById.get(nodeId)?.paths ?? []))];

  dom.journeyTitle.textContent = journey.label;
  const stageCount = dom.journeyGuide?.querySelector('.stage-count');
  if (stageCount) stageCount.textContent = `${journey.steps.length} ${journey.steps.length === 1 ? 'step' : 'steps'}`;
  dom.journeySummary.textContent = journey.description;
  dom.journeyEntryBoundary.textContent = `Start boundary: ${journey.entryBoundary}`;
  dom.journeyCompletionBoundary.textContent = `Completion boundary: ${journey.completionBoundary}`;

  dom.journeySteps.replaceChildren();
  journey.steps.forEach((journeyStep, index) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    const number = document.createElement('span');
    const title = document.createElement('span');
    const hint = document.createElement('span');
    const selected = index === state.journeyStep;
    button.type = 'button';
    button.className = `journey-step-button${selected ? ' is-selected' : ''}${index < state.journeyStep ? ' is-complete' : ''}`;
    button.dataset.journeyStep = String(index);
    button.setAttribute('aria-current', selected ? 'step' : 'false');
    button.setAttribute('aria-label', `Go to step ${index + 1}: ${journeyStep.title}`);
    number.className = 'journey-step-number';
    number.textContent = String(index + 1);
    title.className = 'journey-step-title';
    title.textContent = journeyStep.title;
    hint.className = 'journey-step-hint';
    hint.textContent = selected ? 'Now' : 'Open';
    hint.setAttribute('aria-hidden', 'true');
    button.append(number, title, hint);
    item.append(button);
    dom.journeySteps.append(item);
  });

  dom.journeyDetailOverline.textContent = `Step ${state.journeyStep + 1} of ${journey.steps.length}`;
  dom.journeyDetailTitle.textContent = step.title;
  dom.journeyDetailDescription.textContent = step.description;
  dom.journeyDetailBoundary.textContent = step.boundary;
  dom.journeyStepPaths.replaceChildren();
  sourcePaths.forEach((path) => {
    const item = document.createElement('li');
    const code = document.createElement('code');
    code.textContent = path;
    item.append(code);
    dom.journeyStepPaths.append(item);
  });
  dom.journeyPrevious.disabled = state.journeyStep === 0;
  dom.journeyNext.disabled = state.journeyStep >= journey.steps.length - 1;
  chrome?.renderJourney(journey, state.journeyStep);
}

function renderNodeIndex() {
  const visibleNodes = getVisibleNodes().sort((first, second) => first.label.localeCompare(second.label));
  dom.nodeIndex.replaceChildren();
  const indexCount = document.querySelector('#node-index-count');
  if (indexCount) indexCount.textContent = `${visibleNodes.length} visible`;
  visibleNodes.forEach((node) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    const label = document.createElement('span');
    const meta = document.createElement('span');
    button.type = 'button';
    button.dataset.nodeIndex = node.id;
    button.classList.toggle('is-selected', node.id === state.selectedNodeId);
    label.className = 'node-index-label';
    meta.className = 'node-index-meta';
    label.textContent = node.label;
    meta.textContent = node.paths[0];
    button.append(label, meta);
    item.append(button);
    dom.nodeIndex.append(item);
  });
}

function renderCamera() {
  dom.cameraPitch.value = String(state.camera.pitch);
  dom.cameraBearing.value = String(state.camera.bearing);
  dom.cameraDepth.value = String(state.camera.depth);
  dom.cameraPitchValue.textContent = `${Math.round(state.camera.pitch)}°`;
  dom.cameraBearingValue.textContent = `${Math.round(state.camera.bearing)}°`;
  dom.cameraDepthValue.textContent = `${Math.round(state.camera.depth)}px`;
  dom.zoomLevel.textContent = `${Math.round(state.camera.zoom * 100)}%`;
  dom.cameraReadout.textContent = `Zoom ${state.camera.zoom.toFixed(2)}× · pan ${Math.round(state.camera.panX)}, ${Math.round(state.camera.panY)}`;
  document.querySelectorAll('[data-camera]').forEach((button) => {
    button.classList.toggle('is-selected', Boolean(CAMERA_PRESETS[button.dataset.camera]) && cameraMatchesPreset(button.dataset.camera));
  });
  renderOrientationGizmo();
}

function cameraMatchesPreset(presetName) {
  const preset = cameraPreset(presetName, state.mode === 'flat');
  return Object.entries(preset).every(([key, value]) => Math.abs(state.camera[key] - value) < 0.01);
}

function renderLensAndMode() {
  document.querySelectorAll('[data-lens]').forEach((button) => {
    const selected = button.dataset.lens === state.repositoryLens;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  const isJourneyView = state.lens === 'journey';
  document.querySelectorAll('[data-view]').forEach((button) => {
    if (button.dataset.view === 'journey') button.hidden = JOURNEYS.length === 0;
    const selected = button.dataset.view === (isJourneyView ? 'journey' : 'repository');
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  document.querySelectorAll('[data-mode]').forEach((button) => {
    const selected = button.dataset.mode === state.mode;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  document.querySelectorAll('[data-label-toggle]').forEach((button) => {
    button.classList.toggle('is-selected', state.labelsVisible);
    button.setAttribute('aria-pressed', String(state.labelsVisible));
    // The dock control is an icon; only the Filters row carries its state in words.
    if (button.dataset.labelToggle === 'full') button.textContent = `Labels: ${state.labelsVisible ? 'visible' : 'hidden'}`;
  });
  document.querySelectorAll('[data-spacing-toggle]').forEach((button) => {
    const distributed = state.spacingMode === 'distributed';
    button.classList.toggle('is-selected', distributed);
    button.setAttribute('aria-pressed', String(distributed));
    button.disabled = isJourneyView;
    button.textContent = `Even spacing: ${distributed ? 'on' : 'off'}`;
  });
  dom.atlasMain.classList.toggle('are-labels-hidden', !state.labelsVisible);
  dom.atlasMain.classList.toggle('is-journey-view', isJourneyView);
  dom.atlasMain.classList.toggle('is-flat', state.mode === 'flat');
  dom.flowHud.hidden = !isJourneyView;
  if (isJourneyView) {
    const journey = getActiveJourney();
    const flow = getActiveFlow();
    dom.mapKicker.textContent = ATLAS_DATA.meta.journeyKicker ?? 'Guided flow';
    dom.mapHeading.textContent = journey?.mapHeading ?? journey?.label ?? flow?.label ?? 'Source path';
    dom.mapSubtitle.textContent = journey?.mapSummary ?? journey?.description ?? flow?.description ?? 'A focused, source-backed path through this repository.';
  } else {
    dom.mapKicker.textContent = 'Repository';
    dom.mapHeading.textContent = `${REPOSITORY_DISPLAY_NAME} repository`;
    dom.mapSubtitle.textContent = `${ATLAS_DATA.nodes.length} ${SOURCE_COLLECTION_LABEL} source modules grouped by ${state.repositoryLens === 'system' ? 'system domain' : 'source folder'}. Code presence is shown; runtime enablement and deployment remain unverified unless evidence says otherwise.`;
  }
}

function closeInspector({ restoreFocus = true } = {}) {
  state.inspectorVisible = false;
  renderPanelVisibility();
  scheduleRenderMap();
  if (restoreFocus) {
    // Return to whatever opened the panel; otherwise to the selected tower.
    const opener = state.inspectorReturnFocus;
    requestAnimationFrame(() => {
      const target = opener?.isConnected && opener.checkVisibility?.() ? opener
        : dom.atlasMapLayer.querySelector(`[data-node-id="${CSS.escape(state.selectedNodeId ?? '')}"]`) ?? dom.mapViewport;
      target.focus({ preventScroll: true });
    });
  }
  state.inspectorReturnFocus = null;
  announce('Source panel closed.');
}

function toggleInspector() {
  if (state.inspectorVisible) {
    closeInspector();
    return;
  }
  if (state.selectedNodeId) selectNode(state.selectedNodeId);
}

function renderPanelVisibility() {
  const isJourneyView = state.lens === 'journey';
  const showGuide = isJourneyView && state.guideVisible;
  const showInspector = state.inspectorVisible && !showGuide;
  dom.journeyGuide.hidden = !showGuide;
  dom.inspectorPanel.hidden = !showInspector;
  dom.inspectorPanel.setAttribute('aria-hidden', String(!showInspector));
  dom.atlasMain.classList.toggle('is-inspector-open', showInspector);
  chrome?.renderPanels({ showGuide, showInspector, isJourneyView });
}

function renderInteractionMode() {
  document.querySelectorAll('button[data-interaction]').forEach((button) => {
    const selected = button.dataset.interaction === state.interactionMode;
    const disabled = button.dataset.interaction !== 'pan' && state.mode === 'flat';
    button.disabled = disabled;
    button.classList.toggle('is-selected', selected && !disabled);
    button.setAttribute('aria-pressed', String(selected && !disabled));
  });
  [dom.rotateLeft, dom.rotateRight, dom.tiltUp, dom.tiltDown].forEach((button) => {
    button.disabled = state.mode === 'flat';
  });
  dom.mapViewport.dataset.interaction = state.interactionMode;
  dom.layoutReset.disabled = ![...state.customPositions.keys()].some((key) => key.startsWith(`${state.lens}:${state.spacingMode}:`));
  const instruction = {
    arrange: 'Drag a faded district pad to move a whole area, or drag a building to move one module.',
    orbit: 'Drag empty space to turn freely. Drag up to level the map (top-down); drag down for a side view. Spin left/right to walk around.',
    pan: 'Drag empty space to slide the map. Use Angle & layers to tilt without orbiting.',
  }[state.interactionMode];
  dom.mapInstructions.textContent = instruction;
  chrome?.renderInteraction(state.interactionMode);
}

function renderTruthSemantics() {
  dom.truthSemantics.replaceChildren();
  ATLAS_DATA.truthSemantics.forEach((item) => {
    const listItem = document.createElement('li');
    const title = document.createElement('strong');
    const description = document.createElement('span');
    title.textContent = item.label;
    description.textContent = item.meaning;
    listItem.append(title, description);
    dom.truthSemantics.append(listItem);
  });
}

function renderEdgeLegend() {
  const classes = [...new Set(ATLAS_DATA.edges.map((edge) => EDGE_STYLE[edge.type] ?? 0))].sort();
  dom.edgeLegend.replaceChildren();
  classes.forEach((style) => {
    const [label, meaning] = EDGE_CLASS_LABEL[style] ?? EDGE_CLASS_LABEL[0];
    const item = document.createElement('li');
    const line = document.createElement('span');
    const copy = document.createElement('span');
    line.className = `legend-line ${style === 1 ? 'is-dashed' : style === 2 ? 'is-dotted' : style === 3 ? 'is-write' : 'is-solid'}`;
    line.setAttribute('aria-hidden', 'true');
    copy.innerHTML = `<strong>${label}</strong>: ${escapeHtml(meaning)}`;
    item.append(line, copy);
    dom.edgeLegend.append(item);
  });
  const districtLegend = document.querySelector('#district-legend');
  if (districtLegend) {
    districtLegend.replaceChildren();
    districtById.forEach((district) => {
      const item = document.createElement('li');
      const swatch = document.createElement('span');
      const label = document.createElement('span');
      swatch.className = 'district-swatch';
      swatch.style.setProperty('--district-color', district.color);
      label.textContent = district.label;
      item.append(swatch, label);
      districtLegend.append(item);
    });
  }
}

function ensureSelectedNodeIsVisible() {
  const visibleNodes = getVisibleNodes();
  if (!visibleNodes.length) return;
  if (!visibleNodes.some((node) => node.id === state.selectedNodeId)) {
    state.selectedNodeId = visibleNodes[0].id;
  }
}

function renderAll({ rebuildStatus = false } = {}) {
  ensureSelectedNodeIsVisible();
  if (rebuildStatus) renderStatusFilter();
  renderLensAndMode();
  renderPanelVisibility();
  renderInteractionMode();
  renderSearch();
  renderFlowNavigator();
  renderJourneyGuide();
  renderNodeIndex();
  renderInspector();
  renderCamera();
  renderMap();
}

function focusNodeInCamera(nodeId, { zoom = false, weight = 0.55, duration = 950 } = {}) {
  if (state.mode === 'flat') return;
  const node = nodeById.get(nodeId);
  if (!node) return;
  if (isGpuDepth()) {
    // Fly the camera target toward the module; a click on a building also eases in.
    const pan = gpuCity.panForWorld(gpuCity.atlasToWorld(getNodePosition(node)));
    const targetCamera = {
      panX: state.camera.panX + (pan.panX - state.camera.panX) * weight,
      panY: state.camera.panY + (pan.panY - state.camera.panY) * weight,
    };
    if (zoom && state.camera.zoom < 1.15) targetCamera.zoom = 1.3;
    animateCameraTo(targetCamera, { duration });
    return;
  }
  const point = projectPoint(getNodePosition(node));
  state.camera.panX = clamp(state.camera.panX + (560 - point.x) * 0.38, -180, 180);
  state.camera.panY = clamp(state.camera.panY + (350 - point.y) * 0.3, -135, 135);
}

function selectNode(nodeId, { focusIndex = false, announceSelection = true, openInspector = true } = {}) {
  if (!nodeById.has(nodeId)) return;
  const journey = getActiveJourney();
  const journeyFlow = journey ? flowById.get(journey.flowId) : null;
  if (state.lens === 'journey' && !journeyFlow?.nodeIds.includes(nodeId)) {
    state.lens = state.repositoryLens;
    state.guideVisible = false;
  }
  state.selectedNodeId = nodeId;
  if (openInspector) {
    if (!state.inspectorVisible) {
      const opener = document.activeElement;
      state.inspectorReturnFocus = opener instanceof Element && opener !== document.body && !dom.inspectorPanel.contains(opener) ? opener : null;
    }
    setSurface('map');
    state.guideVisible = false;
    state.inspectorVisible = true;
    closeDrawer({ restoreFocus: false });
    if (isGpuDepth()) focusNodeInCamera(nodeId, { zoom: true, weight: 1, duration: 1050 });
  }
  renderAll();
  if (openInspector) {
    requestAnimationFrame(() => {
      const panel = dom.inspectorPanel;
      if (panel && !panel.hidden) {
        animateUi(panel, { opacity: [0.72, 1], y: [10, 0] }, { duration: 0.28 });
        panel.scrollTop = 0;
      }
    });
  }
  if (announceSelection) announce(`Selected ${nodeById.get(nodeId).label}. Inspector updated.`);
  if (focusIndex) {
    requestAnimationFrame(() => document.querySelector(`[data-node-index="${nodeId}"]`)?.focus());
  }
}

function selectRepositoryView({ lens = state.repositoryLens, announceSelection = true } = {}) {
  stopCameraAnimation();
  setSurface('map');
  clearSearch();
  state.repositoryLens = lens === 'repository' ? 'repository' : 'system';
  state.lens = state.repositoryLens;
  state.camera = cameraPreset('overview', state.mode === 'flat');
  state.guideVisible = false;
  state.inspectorVisible = false;
  syncViewHash();
  renderAll();
  if (announceSelection) announce(`Repository map selected, grouped by ${state.repositoryLens === 'system' ? 'system domain' : 'source folder'}.`);
}

function selectJourney(journeyId, { announceSelection = true } = {}) {
  const journey = journeyById.get(journeyId);
  const flow = journey ? flowById.get(journey.flowId) : null;
  if (!journey || !flow) return;
  stopCameraAnimation();
  setSurface('map');
  state.selectedJourneyId = journey.id;
  closeDrawer({ restoreFocus: false });
  closeOmnibox({ clear: true });
  clearSearch();
  state.selectedFlowId = flow.id;
  state.lens = 'journey';
  state.guideVisible = true;
  state.inspectorVisible = false;
  state.journeyStep = 0;
  state.flowStep = journey.steps[0]?.startHop ?? 0;
  state.selectedNodeId = flow.nodeIds[state.flowStep];
  // Show the panel first so the camera can frame the path beside it.
  renderPanelVisibility();
  state.camera = journeyCamera();
  syncViewHash();
  renderAll();
  if (announceSelection) announce(`Walkthrough opened. Chapter 1 of ${journey.steps.length}: ${journey.steps[0]?.title ?? 'start'}.`);
}

/**
 * Bring a walkthrough node into view. Where the whole path is framed beside the
 * panel, keep that frame (the highlight moves, the city does not); on small
 * screens, pan toward the node instead.
 */
function focusJourneyNode(nodeId) {
  const framed = framedJourneyCamera();
  if (framed) animateCameraTo(framed, { duration: 700 });
  else focusNodeInCamera(nodeId);
}

function selectJourneyStep(stepIndex, { focus = true, announceSelection = true } = {}) {
  const journey = getActiveJourney();
  const flow = journey ? flowById.get(journey.flowId) : null;
  if (!journey || !flow) return;
  const nextStep = clamp(stepIndex, 0, journey.steps.length - 1);
  const step = journey.steps[nextStep];
  state.journeyStep = nextStep;
  state.selectedFlowId = flow.id;
  state.flowStep = step.startHop;
  state.selectedNodeId = flow.nodeIds[step.startHop];
  if (focus) focusJourneyNode(state.selectedNodeId);
  renderAll();
  if (announceSelection) announce(`Walkthrough chapter ${nextStep + 1} of ${journey.steps.length}: ${step.title}.`);
}

function selectFlow(flowId, { focus = true, announceSelection = true } = {}) {
  const flow = flowById.get(flowId);
  if (!flow) return;
  clearSearch();
  state.selectedFlowId = flow.id;
  state.flowStep = 0;
  state.selectedNodeId = flow.nodeIds[0];
  const journey = getActiveJourney();
  if (state.lens === 'journey' && journey?.flowId !== flow.id) {
    state.lens = state.repositoryLens;
    state.guideVisible = false;
    state.inspectorVisible = true;
  }
  syncJourneyStepToFlow(flow);
  if (focus) focusNodeInCamera(state.selectedNodeId);
  renderAll();
  if (announceSelection) announce(`Flow selected: ${flow.label}. Hop 1 of ${flow.nodeIds.length}.`);
}

function moveFlow(delta) {
  if (state.lens !== 'journey') return;
  const flow = getActiveFlow();
  const nextStep = clamp(state.flowStep + delta, 0, flow.nodeIds.length - 1);
  if (nextStep === state.flowStep) return;
  state.flowStep = nextStep;
  state.selectedNodeId = flow.nodeIds[nextStep];
  syncJourneyStepToFlow(flow);
  focusJourneyNode(state.selectedNodeId);
  renderAll();
  announce(`Call ${nextStep + 1} of ${flow.nodeIds.length}: ${nodeById.get(state.selectedNodeId).label}.`);
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to a local selection fallback.
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  return copied;
}

function contextMarkdown(node) {
  const flow = getActiveFlow();
  const journey = getActiveJourney();
  const participatesInFlow = Boolean(flow?.nodeIds.includes(node.id));
  const lines = [
    `# ${ATLAS_TITLE} context: ${node.label}`,
    '',
    `- Type: ${node.type}`,
    `- Status: ${node.status}`,
    `- Repository truth: ${node.truth.repository}`,
    `- Runtime enablement: ${node.truth.runtime}`,
    `- Deployment truth: ${node.truth.deployment}`,
    '',
    '## Purpose',
    node.purpose,
    '',
    '## Repository paths',
    ...node.paths.map((path) => `- \`${path}\``),
    '',
    '## Boundaries and risks',
    ...node.boundaries.map((boundary) => `- Boundary: ${boundary}`),
    ...node.risks.map((risk) => `- Risk: ${risk}`),
    '',
    `## ${IS_GENERATED_ATLAS ? 'Generated' : 'Curated'} evidence shape`,
    '```json',
    JSON.stringify(node.packet.schema, null, 2),
    '```',
  ];
  if (participatesInFlow) {
    lines.push(
      '',
      `## Related ${IS_GENERATED_ATLAS ? 'relationship' : 'curated'} flow: ${flow.label}`,
      flow.description,
      ...flow.nodeIds.map((nodeId, index) => `${index + 1}. ${nodeById.get(nodeId).label}`),
      ...flow.cautions.map((caution) => `- Caution: ${caution}`),
    );
  }
  if (journey?.flowId === flow.id) {
    lines.push(
      '',
      `## Newcomer journey: ${journey.label}`,
      journey.entryBoundary,
      journey.completionBoundary,
    );
  }
  lines.push('', `_Generated locally by ${ATLAS_TITLE}. Paths are repository-grounded; no runtime or deployment state is asserted._`);
  return lines.join('\n');
}

function updateCamera(partial) {
  const nextCamera = { ...state.camera, ...partial };
  nextCamera.bearing = normalizeBearing(nextCamera.bearing);
  nextCamera.pitch = clamp(nextCamera.pitch, 8, 90);
  nextCamera.depth = clamp(nextCamera.depth, 10, 48);
  nextCamera.zoom = clamp(nextCamera.zoom, 0.45, 2.6);
  nextCamera.panX = clamp(nextCamera.panX, -720, 720);
  nextCamera.panY = clamp(nextCamera.panY, -520, 520);
  state.camera = nextCamera;
  renderCamera();
  scheduleRenderMap({ lightweight: state.dragging });
}

let activeCameraAnimation = null;

function stopCameraAnimation() {
  activeCameraAnimation?.stop();
  activeCameraAnimation = null;
}

function animateCameraTo(target, { duration = 1200, ease = 'inout' } = {}) {
  stopCameraAnimation();
  const from = { ...state.camera };
  activeCameraAnimation = animateObject(from, { ...from, ...target }, {
    duration,
    ease,
    onUpdate: (value) => {
      updateCamera(value);
    },
    onComplete: () => {
      activeCameraAnimation = null;
    },
  });
  return activeCameraAnimation;
}

/** Descend into the city as districts, towers, connections and labels arrive. */
function playEntranceZoom({ replay = false } = {}) {
  if (prefersReducedMotion()) return;
  const searchParams = new URLSearchParams(window.location.search);
  const forceIntro = replay || searchParams.has('intro');
  // ?intro=<ms> stretches the flight (preview aid); plain ?intro replays it at normal speed.
  const introDuration = clamp(Number(searchParams.get('intro')) || 0, 0, 60000);
  try {
    if (!forceIntro && sessionStorage.getItem(INTRO_STORAGE_KEY) === '1') return;
    sessionStorage.setItem(INTRO_STORAGE_KEY, '1');
  } catch {
    // sessionStorage may be blocked; still play once this session.
  }

  const immersive = isGpuDepth();
  const target = state.lens === 'journey' ? journeyCamera() : cameraPreset('overview', state.mode === 'flat');
  const start = immersive
    ? {
      // Begin high and pulled back, then descend into the tilted overview while the city rises.
      ...target,
      zoom: clamp(target.zoom * 0.56, 0.45, 1.1),
      pitch: clamp(target.pitch + 30, 8, 86),
      panY: target.panY + 42,
      bearing: target.bearing - 36,
    }
    : {
      ...target,
      zoom: clamp(target.zoom * 0.72, 0.52, 1.25),
      pitch: clamp(target.pitch + 10, 8, 78),
      panY: target.panY - 36,
      bearing: target.bearing - 10,
    };
  state.camera = start;
  renderCamera();
  scheduleRenderMap();
  if (immersive) gpuCity.playIntro();
  const flightDuration = introDuration || (immersive ? 2900 : 1450);
  if (immersive) gpuCity.setIntroSpeed(2900 / flightDuration);
  animateCameraTo(target, { duration: flightDuration });
  animateUi('.project-title, .topbar, .omnibox-wrap', { opacity: [0, 1], y: [-8, 0] }, { duration: 0.8 });
  animateUi('.rail', { opacity: [0, 1] }, { duration: 0.8, delay: 0.12 });
  // Opacity-only keeps independently positioned dock controls anchored.
  animateUi('.dock, .corner-stack', { opacity: [0, 1] }, { duration: 0.85, delay: 0.35 });
  animateUi('.scene-caption, .atlas-navigation-hint', { opacity: [0, 1], y: [8, 0] }, { duration: 0.9, delay: flightDuration / 1000 - 0.4 });
}

/** Orbit so drag-up tips toward top-down (levels the low/high sides) and cursor side rolls with you. */
function applyOrbitDelta(deltaX, deltaY, clientX, clientY, { bearingGain = 0.55, pitchGain = 0.48 } = {}) {
  const rect = dom.mapViewport.getBoundingClientRect();
  const nx = rect.width ? ((clientX - rect.left) / rect.width) * 2 - 1 : 0;
  const ny = rect.height ? ((clientY - rect.top) / rect.height) * 2 - 1 : 0;
  updateCamera({
    bearing: state.camera.bearing + deltaX * bearingGain + ny * deltaY * -0.12,
    // Drag up (negative deltaY) raises pitch toward a level top-down plane.
    pitch: state.camera.pitch - deltaY * pitchGain + nx * deltaX * 0.06,
  });
}

function arrangeNodeByDelta(nodeId, clientDeltaX, clientDeltaY) {
  const worldDelta = worldDeltaFromPointer(nodeId, clientDeltaX, clientDeltaY);
  if (!worldDelta) return;
  const position = getNodePosition(nodeById.get(nodeId));
  state.customPositions.set(positionKey(nodeId), {
    ...position,
    x: clamp(position.x + worldDelta.x, -8, 108),
    y: clamp(position.y + worldDelta.y, -8, 108),
  });
  scheduleRenderMap({ lightweight: true });
}

/** Convert a pointer movement into atlas units on the ground plane under a node. */
function worldDeltaFromPointer(nodeId, clientDeltaX, clientDeltaY) {
  const node = nodeById.get(nodeId);
  if (!node) return null;
  const position = getNodePosition(node);
  const origin = projectPoint(position);
  const xBasisPoint = projectPoint({ ...position, x: position.x + 1 });
  const yBasisPoint = projectPoint({ ...position, y: position.y + 1 });
  const xBasis = {
    x: (xBasisPoint.x - origin.x) * state.camera.zoom,
    y: (xBasisPoint.y - origin.y) * state.camera.zoom,
  };
  const yBasis = {
    x: (yBasisPoint.x - origin.x) * state.camera.zoom,
    y: (yBasisPoint.y - origin.y) * state.camera.zoom,
  };
  const delta = svgDeltaFromPointer(clientDeltaX, clientDeltaY);
  const determinant = xBasis.x * yBasis.y - yBasis.x * xBasis.y;
  if (Math.abs(determinant) < 0.001) return null;
  return {
    x: (delta.x * yBasis.y - yBasis.x * delta.y) / determinant,
    y: (xBasis.x * delta.y - delta.x * xBasis.y) / determinant,
  };
}

function arrangeGroupByDelta(groupKey, clientDeltaX, clientDeltaY) {
  const groupNodes = getVisibleNodes().filter((node) => getGroupKey(node) === groupKey);
  if (!groupNodes.length) return;
  const worldDelta = worldDeltaFromPointer(groupNodes[0].id, clientDeltaX, clientDeltaY);
  if (!worldDelta) return;
  groupNodes.forEach((node) => {
    const position = getNodePosition(node);
    state.customPositions.set(positionKey(node.id), {
      ...position,
      x: clamp(position.x + worldDelta.x, -8, 108),
      y: clamp(position.y + worldDelta.y, -8, 108),
    });
  });
  scheduleRenderMap({ lightweight: true });
}

function compassLabel(bearing) {
  const normalized = ((bearing % 360) + 360) % 360;
  const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(normalized / 45) % 8;
  return labels[index];
}

function renderOrientationGizmo() {
  if (!dom.gizmoNeedle || !dom.gizmoReadout) return;
  const bearing = state.camera.bearing;
  const pitch = state.camera.pitch;
  dom.gizmoNeedle.style.transform = `translate(-50%, -50%) rotate(${bearing}deg)`;
  dom.gizmoNeedle.style.setProperty('--pitch-scale', String(clamp(pitch / 90, 0.28, 1)));
  if (dom.gizmoTrackball) {
    dom.gizmoTrackball.setAttribute('aria-valuetext', `Facing ${compassLabel(bearing)}, ${Math.round(pitch)} degree tilt`);
    dom.gizmoTrackball.setAttribute('aria-valuenow', String(Math.round(bearing)));
  }
  dom.gizmoReadout.textContent = `${compassLabel(bearing)} · ${Math.round(pitch)}°`;
  document.querySelector('#angle-orb-needle')?.style.setProperty('--bearing', `${bearing}deg`);
}

function showToolbarToast(message, { tone = 'ok' } = {}) {
  let toast = document.querySelector('#toolbar-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toolbar-toast';
    toast.className = 'toolbar-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    (dom.mapToolbar?.parentElement || document.body).append(toast);
  }
  toast.textContent = message;
  toast.dataset.tone = tone;
  toast.classList.add('is-visible');
  clearTimeout(showToolbarToast._timer);
  showToolbarToast._timer = setTimeout(() => toast.classList.remove('is-visible'), 1800);
}

function saveCurrentView() {
  const payload = {
    camera: state.camera,
    customPositions: [...state.customPositions.entries()],
    labelsVisible: state.labelsVisible,
    lens: state.lens,
    mode: state.mode,
    repositoryLens: state.repositoryLens,
    selectedNodeId: state.selectedNodeId,
    spacingMode: state.spacingMode,
    mapDensity: state.mapDensity,
    journeyDensity: state.journeyDensity,
    savedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(payload));
    showToolbarToast('View saved');
    announce('View saved locally in this browser.');
  } catch {
    showToolbarToast('Save failed', { tone: 'warn' });
    announce('Could not save the view in this browser.');
  }
}

function clearSavedView() {
  try {
    localStorage.removeItem(VIEW_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
  showToolbarToast('Saved view cleared');
  announce('Saved view cleared.');
}

const SAVED_CAMERA_KEYS = ['bearing', 'pitch', 'zoom', 'panX', 'panY', 'depth'];

/** Saved views come from localStorage, which other pages on the same origin can write: keep only finite numbers. */
function savedCamera(camera) {
  if (!camera || typeof camera !== 'object') return null;
  return Object.fromEntries(SAVED_CAMERA_KEYS.filter((key) => Number.isFinite(camera[key])).map((key) => [key, camera[key]]));
}

function savedPositions(entries) {
  return entries.flatMap((entry) => {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !entry[1] || typeof entry[1] !== 'object') return [];
    const { x, y, z } = entry[1];
    if (!Number.isFinite(x) || !Number.isFinite(y) || (z !== undefined && !Number.isFinite(z))) return [];
    return [[entry[0], z === undefined ? { x, y } : { x, y, z }]];
  });
}

function loadSavedView({ announceRestore = false } = {}) {
  let raw = null;
  try {
    raw = localStorage.getItem(VIEW_STORAGE_KEY);
  } catch {
    return false;
  }
  if (!raw) return false;
  try {
    const payload = JSON.parse(raw);
    const camera = savedCamera(payload.camera);
    if (camera) state.camera = { ...cameraPreset('overview'), ...camera };
    if (Array.isArray(payload.customPositions)) state.customPositions = new Map(savedPositions(payload.customPositions));
    if (typeof payload.labelsVisible === 'boolean') state.labelsVisible = payload.labelsVisible;
    if (payload.mode === 'flat' || payload.mode === 'perspective') state.mode = payload.mode;
    if (payload.spacingMode === 'distributed' || payload.spacingMode === 'curated') state.spacingMode = payload.spacingMode;
    if (payload.mapDensity === 'all' || payload.mapDensity === 'districts' || payload.mapDensity === 'modules') {
      state.mapDensity = payload.mapDensity;
    }
    if (['all', 'districts', 'modules'].includes(payload.journeyDensity)) state.journeyDensity = payload.journeyDensity;
    if (payload.repositoryLens === 'system' || payload.repositoryLens === 'repository') state.repositoryLens = payload.repositoryLens;
    if (payload.lens === 'journey') state.lens = 'journey';
    else if (payload.lens === 'system' || payload.lens === 'repository') state.lens = state.repositoryLens;
    if (payload.selectedNodeId && nodeById.has(payload.selectedNodeId)) state.selectedNodeId = payload.selectedNodeId;
    if (announceRestore) announce('Restored your saved atlas view.');
    return true;
  } catch {
    return false;
  }
}

function resetViewCompletely() {
  state.camera = state.lens === 'journey' ? journeyCamera() : cameraPreset('overview', state.mode === 'flat');
  [...state.customPositions.keys()]
    .filter((key) => key.startsWith(`${state.lens}:${state.spacingMode}:`))
    .forEach((key) => state.customPositions.delete(key));
  renderInteractionMode();
  renderCamera();
  flushRenderMap();
  showToolbarToast('View reset');
  announce('View reset to the default camera and layout for this mode.');
}

function snapCamera(snapName) {
  const snap = CAMERA_SNAPS[snapName];
  state.camera = snap ? { ...cameraPreset('overview'), ...snap } : cameraPreset('overview');
  renderCamera();
  flushRenderMap();
  announce(`${titleCase(snapName)} orientation selected.`);
}

function markGuideSeen() {
  try {
    localStorage.setItem(GUIDE_STORAGE_KEY, '1');
  } catch {
    // Ignore storage failures.
  }
}

function hasSeenGuide() {
  try {
    if (new URLSearchParams(window.location.search).has('qa')) return true;
    return localStorage.getItem(GUIDE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function placeOnboardingCard(step) {
  const card = dom.onboardingCard || dom.onboardingOverlay?.querySelector('.onboarding-card');
  if (!card) return;
  const toolbarReserve = 108;
  const margin = 16;
  const cardWidth = Math.min(420, window.innerWidth - margin * 2);
  const cardHeight = Math.min(card.offsetHeight || 220, window.innerHeight - toolbarReserve - margin * 2);
  let top = Math.max(margin + 72, (window.innerHeight - toolbarReserve - cardHeight) / 2);
  let left = (window.innerWidth - cardWidth) / 2;

  const target = step?.target ? document.querySelector(step.target) : null;
  const placement = step?.placement || 'center';
  if (target && placement !== 'center') {
    const rect = target.getBoundingClientRect();
    if (placement === 'below-target') {
      top = Math.min(rect.bottom + 14, window.innerHeight - toolbarReserve - cardHeight - margin);
      left = clamp(rect.left + rect.width / 2 - cardWidth / 2, margin, window.innerWidth - cardWidth - margin);
    } else if (placement === 'beside-target') {
      const preferLeft = rect.left > window.innerWidth * 0.55;
      left = preferLeft
        ? clamp(rect.left - cardWidth - 16, margin, window.innerWidth - cardWidth - margin)
        : clamp(rect.right + 16, margin, window.innerWidth - cardWidth - margin);
      top = clamp(rect.top, margin + 64, window.innerHeight - toolbarReserve - cardHeight - margin);
    } else if (placement === 'above-target') {
      top = clamp(rect.top - cardHeight - 16, margin + 64, window.innerHeight - toolbarReserve - cardHeight - margin);
      left = clamp(rect.left + rect.width / 2 - cardWidth / 2, margin, window.innerWidth - cardWidth - margin);
    }
  }

  // Hard floor: never cover the bottom toolbar.
  top = Math.min(top, window.innerHeight - toolbarReserve - cardHeight - margin);
  top = Math.max(margin + 56, top);

  card.style.position = 'fixed';
  card.style.top = `${Math.round(top)}px`;
  card.style.left = `${Math.round(left)}px`;
  card.style.right = 'auto';
  card.style.bottom = 'auto';
  card.style.width = `${cardWidth}px`;
  card.style.margin = '0';
  card.style.transform = 'none';
}

function renderOnboardingStep() {
  const step = ONBOARDING_STEPS[onboarding.step];
  if (!step || !dom.onboardingOverlay) return;
  dom.onboardingStepLabel.textContent = `Step ${onboarding.step + 1} of ${ONBOARDING_STEPS.length}`;
  dom.onboardingTitle.textContent = step.title;
  dom.onboardingBody.textContent = step.body;
  const isLast = onboarding.step === ONBOARDING_STEPS.length - 1;
  const isFirst = onboarding.step === 0;
  dom.onboardingNext.textContent = isLast ? 'Done' : 'Next';
  if (dom.onboardingPrev) {
    dom.onboardingPrev.hidden = false;
    dom.onboardingPrev.disabled = isFirst;
    dom.onboardingPrev.setAttribute('aria-disabled', String(isFirst));
  }

  const target = document.querySelector(step.target);
  if (target && dom.onboardingSpotlight) {
    const rect = target.getBoundingClientRect();
    dom.onboardingSpotlight.style.display = 'block';
    dom.onboardingSpotlight.style.top = `${Math.max(8, rect.top - 8)}px`;
    dom.onboardingSpotlight.style.left = `${Math.max(8, rect.left - 8)}px`;
    dom.onboardingSpotlight.style.width = `${rect.width + 16}px`;
    dom.onboardingSpotlight.style.height = `${rect.height + 16}px`;
  } else if (dom.onboardingSpotlight) {
    dom.onboardingSpotlight.style.display = 'none';
  }

  // Place after paint so card height is known.
  requestAnimationFrame(() => placeOnboardingCard(step));
}

function openOnboarding({ force = false } = {}) {
  if (!dom.onboardingOverlay) return;
  if (!force && hasSeenGuide()) return;
  onboarding.active = true;
  onboarding.returnFocus = document.activeElement;
  onboarding.inertState = [...dom.atlasMain.children]
    .filter((element) => element !== dom.onboardingOverlay)
    .map((element) => [element, element.inert]);
  onboarding.inertState.forEach(([element]) => { element.inert = true; });
  onboarding.step = 0;
  dom.onboardingOverlay.hidden = false;
  document.body.classList.add('atlas-onboarding-open');
  renderOnboardingStep();
  dom.onboardingNext?.focus();
}

function closeOnboarding() {
  if (!dom.onboardingOverlay) return;
  onboarding.active = false;
  onboarding.inertState?.forEach(([element, inert]) => { element.inert = inert; });
  dom.onboardingOverlay.hidden = true;
  document.body.classList.remove('atlas-onboarding-open');
  markGuideSeen();
  const focus = onboarding.returnFocus?.checkVisibility?.() ? onboarding.returnFocus : dom.helpButton;
  focus?.focus();
}

function retreatOnboarding() {
  if (onboarding.step <= 0) return;
  onboarding.step -= 1;
  renderOnboardingStep();
}

function advanceOnboarding() {
  if (onboarding.step >= ONBOARDING_STEPS.length - 1) {
    closeOnboarding();
    announce('First-time guide finished. Open Help anytime to replay it.');
    return;
  }
  onboarding.step += 1;
  renderOnboardingStep();
}

function resetCurrentLayout() {
  [...state.customPositions.keys()]
    .filter((key) => key.startsWith(`${state.lens}:${state.spacingMode}:`))
    .forEach((key) => state.customPositions.delete(key));
  renderInteractionMode();
  flushRenderMap();
  announce('Moved modules restored to the current layout.');
}

function toggleLabels() {
  state.labelsVisible = !state.labelsVisible;
  if (!state.labelsVisible) setHoveredNode(null);
  renderLensAndMode();
  renderMap();
  announce(`Module labels ${state.labelsVisible ? 'shown' : 'hidden'}.`);
}

function toggleSpacing() {
  if (state.lens === 'journey') return;
  state.spacingMode = state.spacingMode === 'distributed' ? 'curated' : 'distributed';
  state.camera = cameraPreset('overview');
  renderAll();
  announce(state.spacingMode === 'distributed' ? 'Even spacing on.' : 'Curated spacing restored.');
}

function resetCamera() {
  state.camera = state.lens === 'journey' ? journeyCamera() : cameraPreset('overview', state.mode === 'flat');
  renderCamera();
  flushRenderMap();
  announce(`Camera fitted to the ${state.lens === 'journey' ? 'walkthrough' : 'map'}.`);
}

function isWorkspaceFocused() {
  return dom.atlasMain.classList.contains('is-focus-workspace');
}

function getDrawer(drawerId) {
  return drawerId === 'explorer' ? dom.explorerPanel : null;
}

function openDrawer(drawerId, { focus = true } = {}) {
  const panel = getDrawer(drawerId);
  if (!panel) return;
  if (!state.openDrawer) {
    state.drawerReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  state.openDrawer = drawerId;
  if (state.guideVisible) {
    state.guideVisible = false;
    renderPanelVisibility();
    scheduleRenderMap();
  }
  panel.classList.add('is-open');
  panel.setAttribute('aria-hidden', 'false');
  panel.inert = false;
  dom.drawerScrim.hidden = false;
  dom.explorerButton.setAttribute('aria-expanded', String(drawerId === 'explorer'));
  document.querySelector('#omnibox-filters')?.setAttribute('aria-expanded', String(drawerId === 'explorer'));
  if (focus) {
    requestAnimationFrame(() => {
      panel.querySelector('button, input, [tabindex="0"]')?.focus({ preventScroll: true });
    });
  }
}

function closeDrawer({ restoreFocus = true } = {}) {
  const returnFocus = state.drawerReturnFocus;
  state.openDrawer = null;
  state.drawerReturnFocus = null;
  dom.explorerPanel.classList.remove('is-open');
  dom.explorerPanel.setAttribute('aria-hidden', 'true');
  dom.explorerPanel.inert = true;
  dom.drawerScrim.hidden = true;
  dom.explorerButton.setAttribute('aria-expanded', 'false');
  document.querySelector('#omnibox-filters')?.setAttribute('aria-expanded', 'false');
  if (restoreFocus) {
    const canRestoreReturnFocus = returnFocus instanceof HTMLElement
      && returnFocus !== document.body
      && !returnFocus.closest('[inert], [hidden], dialog:not([open])');
    const focusTarget = canRestoreReturnFocus
      ? returnFocus
      : dom.explorerButton;
    focusTarget.focus();
  }
}

function renderWorkspace() {
  const focused = isWorkspaceFocused();
  dom.workspaceButton.innerHTML = `${iconSvg(focused ? 'corners-in' : 'corners-out', { size: 20 })}<span>${focused ? 'Exit focus mode' : 'Focus mode'}</span>`;
  dom.workspaceButton.setAttribute('aria-pressed', String(focused));
}

function setWorkspaceFocused(focused, { restoreFocus = false } = {}) {
  dom.atlasMain.classList.toggle('is-focus-workspace', focused);
  renderWorkspace();
  if (!focused && restoreFocus) {
    requestAnimationFrame(() => state.returnFocus?.focus?.());
  }
}

async function toggleWorkspace() {
  if (isWorkspaceFocused()) {
    if (document.fullscreenElement === dom.atlasMain && document.exitFullscreen) {
      try {
        await document.exitFullscreen();
      } catch {
        // The CSS workspace still exits even if native fullscreen has already changed.
      }
    }
    state.nativeFullscreen = false;
    setWorkspaceFocused(false, { restoreFocus: true });
    announce('Full-screen workspace closed.');
    return;
  }

  state.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  setWorkspaceFocused(true);
  if (dom.atlasMain.requestFullscreen) {
    try {
      await dom.atlasMain.requestFullscreen();
      state.nativeFullscreen = true;
    } catch {
      state.nativeFullscreen = false;
      announce('Focus workspace opened in the local page view; native fullscreen was unavailable.');
      return;
    }
  }
  announce('Full-screen workspace open. The atlas now fills the display.');
}


function resetExplorerFilters() {
  state.query = '';
  if (dom.atlasSearch) dom.atlasSearch.value = '';
  state.repositoryLens = 'system';
  if (state.lens !== 'journey') state.lens = 'system';
  state.activeStatuses = new Set(ATLAS_CONTRACT.statuses);
  state.labelsVisible = true;
  state.spacingMode = 'distributed';
  state.camera = cameraPreset('overview');
  renderAll({ rebuildStatus: true });
  announce('Filters reset to the default map.');
  showToolbarToast('Filters reset');
}

function bindEvents() {
  closeDrawer({ restoreFocus: false });

  dom.explorerButton.addEventListener('click', () => {
    if (state.openDrawer === 'explorer') closeDrawer();
    else openDrawer('explorer');
  });
  dom.explorerReset?.addEventListener('click', () => resetExplorerFilters());
  document.querySelectorAll('[data-drawer-close]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeDrawer();
    });
  });
  dom.drawerScrim.addEventListener('click', () => closeDrawer());

  dom.workspaceButton.addEventListener('click', () => {
    void toggleWorkspace();
  });

  dom.layoutReset.addEventListener('click', resetCurrentLayout);
  dom.mapEmptyReset.addEventListener('click', () => {
    clearSearch();
    closeOmnibox();
    state.activeStatuses = new Set(ATLAS_CONTRACT.statuses);
    renderAll({ rebuildStatus: true });
    announce('Search and status filters cleared.');
  });
  dom.inspectorClose?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeInspector({ restoreFocus: true });
  });

  document.querySelectorAll('button[data-interaction]').forEach((button) => {
    button.addEventListener('click', () => {
      state.interactionMode = button.dataset.interaction;
      renderInteractionMode();
      announce(`${titleCase(state.interactionMode)} drag mode selected.`);
    });
  });
  dom.rotateLeft.addEventListener('click', () => updateCamera({ bearing: state.camera.bearing - 15 }));
  dom.rotateRight.addEventListener('click', () => updateCamera({ bearing: state.camera.bearing + 15 }));
  dom.tiltUp.addEventListener('click', () => updateCamera({ pitch: state.camera.pitch + 5 }));
  dom.tiltDown.addEventListener('click', () => updateCamera({ pitch: state.camera.pitch - 5 }));

  document.querySelectorAll('[data-label-toggle]').forEach((button) => button.addEventListener('click', toggleLabels));

  document.querySelectorAll('[data-spacing-toggle]').forEach((button) => {
    button.addEventListener('click', toggleSpacing);
  });

  document.addEventListener('fullscreenchange', () => {
    const inAtlasFullscreen = document.fullscreenElement === dom.atlasMain;
    if (inAtlasFullscreen) {
      state.nativeFullscreen = true;
      if (!isWorkspaceFocused()) setWorkspaceFocused(true);
      return;
    }
    if (state.nativeFullscreen) {
      state.nativeFullscreen = false;
      setWorkspaceFocused(false, { restoreFocus: true });
    }
  });

  dom.atlasSearch.addEventListener('input', (event) => {
    state.query = event.target.value.trim();
    renderAll();
  });

  const chooseResult = (button) => {
    const { resultKind, resultId } = button.dataset;
    closeOmnibox({ clear: true });
    setSurface('map');
    if (resultKind === 'journey') selectJourney(resultId);
    else if (resultKind === 'flow') selectFlow(resultId);
    else selectNode(resultId);
  };
  dom.searchResults.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-result-id]');
    if (button) chooseResult(button);
  });
  document.querySelector('#omnibox')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const first = dom.searchResults.querySelector('button[data-result-id]');
    if (first) chooseResult(first);
  });
  dom.atlasSearch.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeOmnibox({ clear: true });
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      dom.searchResults.querySelector('button[data-result-id]')?.focus();
    }
  });
  dom.searchResults.addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const buttons = [...dom.searchResults.querySelectorAll('button[data-result-id]')];
    const index = buttons.indexOf(document.activeElement);
    event.preventDefault();
    const next = clamp(index + (event.key === 'ArrowDown' ? 1 : -1), 0, buttons.length - 1);
    buttons[next]?.focus();
  });

  dom.statusFilter.addEventListener('change', (event) => {
    const input = event.target.closest('input[data-status]');
    if (!input) return;
    if (input.checked) state.activeStatuses.add(input.dataset.status);
    else state.activeStatuses.delete(input.dataset.status);
    renderAll({ rebuildStatus: true });
    announce(`${titleCase(input.dataset.status)} ${input.checked ? 'shown' : 'hidden'}.`);
  });

  dom.statusReset.addEventListener('click', () => {
    state.activeStatuses = new Set(ATLAS_CONTRACT.statuses);
    renderAll({ rebuildStatus: true });
    announce('All status labels shown.');
  });

  document.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => {
      setSurface('map');
      if (button.dataset.view === 'journey') {
        if (DEFAULT_JOURNEY_ID) selectJourney(getActiveJourney()?.id ?? DEFAULT_JOURNEY_ID);
        return;
      }
      selectRepositoryView();
    });
  });

  document.querySelectorAll('[data-lens]').forEach((button) => {
    button.addEventListener('click', () => {
      selectRepositoryView({ lens: button.dataset.lens });
      // Keep Find open so grouping can be compared without dismissing the panel.
    });
  });

  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextMode = button.dataset.mode;
      const previousMode = state.mode;
      state.mode = nextMode;
      if (state.mode === 'flat') state.interactionMode = 'pan';
      if (state.mode === 'flat' && previousMode !== 'flat') {
        // Orient to a calm top-down reading plane when entering Labels/Flat.
        animateCameraTo({
          ...state.camera,
          pitch: 78,
          bearing: state.camera.bearing,
          zoom: 1,
          panX: 0,
          panY: 0,
        }, { duration: 700 });
        animateUi('#atlas-map', { opacity: [0.55, 1], scale: [0.985, 1] }, { duration: 0.45 });
      } else if (state.mode === 'perspective' && previousMode === 'flat') {
        animateCameraTo({
          ...state.camera,
          pitch: 52,
          zoom: clamp(state.camera.zoom, 0.7, 1.05),
        }, { duration: 700 });
      }
      renderAll();
      announce(`${state.mode === 'perspective' ? 'Depth' : 'Flat'} view selected.`);
    });
  });

  dom.flowSelect.addEventListener('change', (event) => selectFlow(event.target.value));
  dom.flowPrevious.addEventListener('click', () => moveFlow(-1));
  dom.flowNext.addEventListener('click', () => moveFlow(1));
  dom.journeyFullMap.addEventListener('click', () => selectRepositoryView());
  dom.journeySteps.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-journey-step]');
    if (!button) return;
    selectJourneyStep(Number(button.dataset.journeyStep));
  });
  dom.journeyPrevious.addEventListener('click', () => selectJourneyStep(state.journeyStep - 1));
  dom.journeyNext.addEventListener('click', () => selectJourneyStep(state.journeyStep + 1));

  dom.nodeIndex.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-node-index]');
    if (button) selectNode(button.dataset.nodeIndex);
  });

  dom.nodeIndex.addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const current = event.target.closest('button[data-node-index]');
    if (!current) return;
    const buttons = [...dom.nodeIndex.querySelectorAll('button[data-node-index]')];
    const index = buttons.indexOf(current);
    const targetIndex = clamp(index + (event.key === 'ArrowDown' ? 1 : -1), 0, buttons.length - 1);
    event.preventDefault();
    selectNode(buttons[targetIndex].dataset.nodeIndex, { focusIndex: true, openInspector: false });
  });

  // The viewport delegates clicks for both SVG towers and HTML labels. A
  // second click listener here selected SVG nodes twice.

  dom.atlasMapLayer.addEventListener('keydown', (event) => {
    if (!['Enter', ' '].includes(event.key)) return;
    const nodeGroup = event.target.closest('[data-node-id]');
    if (!nodeGroup) return;
    event.preventDefault();
    selectNode(nodeGroup.dataset.nodeId);
  });

  dom.atlasMapLayer.addEventListener('pointerover', (event) => {
    const nodeId = nodeIdFromTarget(event.target);
    if (!nodeId || nodeId === nodeIdFromTarget(event.relatedTarget)) return;
    setHoveredNode(nodeId);
  });

  dom.atlasMapLayer.addEventListener('pointerout', (event) => {
    const nodeId = nodeIdFromTarget(event.target);
    if (!nodeId || nodeId === nodeIdFromTarget(event.relatedTarget)) return;
    const relatedNodeId = nodeIdFromTarget(event.relatedTarget);
    setHoveredNode(relatedNodeId);
  });

  dom.atlasMapLayer.addEventListener('focusin', (event) => {
    if (replacingMapLayer) return;
    const nodeId = nodeIdFromTarget(event.target);
    if (nodeId) setHoveredNode(nodeId);
  });

  dom.atlasMapLayer.addEventListener('focusout', (event) => {
    if (replacingMapLayer) return;
    const relatedNodeId = nodeIdFromTarget(event.relatedTarget);
    setHoveredNode(relatedNodeId);
  });


  dom.mapViewport.addEventListener('click', (event) => {
    if (pointer.moved || event.target.closest('#map-empty')) return;
    const nodeGroup = event.target.closest('[data-node-id]');
    if (nodeGroup?.dataset.nodeId) selectNode(nodeGroup.dataset.nodeId);
  });

  dom.mapViewport.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('#map-empty')) return;
    // The gesture hint has done its job once someone touches the map.
    dom.atlasMain.classList.add('has-navigated');
    // Reset before the early return for nodes: a previous pan/orbit must not
    // suppress the next name click. A drag suppresses only its own click.
    pointer.moved = false;
    pointer.startX = event.clientX;
    pointer.startY = event.clientY;
    const nodeGroup = event.target.closest('[data-node-id]');
    const districtGroup = event.target.closest('[data-group-key]');
    if (nodeGroup && state.interactionMode !== 'arrange') return;
    pointer.lastX = event.clientX;
    pointer.lastY = event.clientY;
    pointer.moved = false;
    pointer.arrangingNodeId = null;
    pointer.arrangingGroupKey = null;
    if (state.interactionMode === 'arrange') {
      if (nodeGroup?.dataset.nodeId) pointer.arrangingNodeId = nodeGroup.dataset.nodeId;
      else if (districtGroup?.dataset.groupKey) pointer.arrangingGroupKey = districtGroup.dataset.groupKey;
    }
    pointer.operation = pointer.arrangingNodeId || pointer.arrangingGroupKey
      ? 'arrange'
      : state.interactionMode === 'orbit' && state.mode === 'perspective'
        ? 'orbit'
        : 'pan';
    stopCameraAnimation();
    state.dragging = true;
    event.preventDefault();
    dom.mapViewport.classList.add('is-dragging');
    dom.mapViewport.classList.add(`is-${pointer.operation}`);
    dom.mapViewport.setPointerCapture?.(event.pointerId);
  });

  dom.mapViewport.addEventListener('pointermove', (event) => {
    if (!state.dragging) return;
    const deltaX = event.clientX - pointer.lastX;
    const deltaY = event.clientY - pointer.lastY;
    if (Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) > 4) pointer.moved = true;
    pointer.lastX = event.clientX;
    pointer.lastY = event.clientY;
    if (pointer.operation === 'orbit') {
      applyOrbitDelta(deltaX, deltaY, event.clientX, event.clientY);
    } else if (pointer.operation === 'arrange' && pointer.arrangingNodeId) {
      arrangeNodeByDelta(pointer.arrangingNodeId, deltaX, deltaY);
    } else if (pointer.operation === 'arrange' && pointer.arrangingGroupKey) {
      arrangeGroupByDelta(pointer.arrangingGroupKey, deltaX, deltaY);
    } else if (isGpuDepth()) {
      const delta = gpuCity.panDeltaFromScreen(state.camera, deltaX, deltaY);
      updateCamera({
        panX: state.camera.panX + delta.x,
        panY: state.camera.panY + delta.y,
      });
    } else {
      const delta = svgDeltaFromPointer(deltaX, deltaY);
      updateCamera({
        panX: state.camera.panX + delta.x,
        panY: state.camera.panY + delta.y,
      });
    }
  });

  const stopDragging = (event) => {
    if (!state.dragging) return;
    const shouldOpenInspector = event?.type === 'pointerup' && pointer.operation === 'arrange'
      && pointer.arrangingNodeId
      && !pointer.moved;
    const clickedNodeId = pointer.arrangingNodeId;
    state.dragging = false;
    pointer.arrangingNodeId = null;
    pointer.arrangingGroupKey = null;
    pointer.operation = null;
    dom.mapViewport.classList.remove('is-dragging');
    dom.mapViewport.classList.remove('is-orbit');
    dom.mapViewport.classList.remove('is-pan');
    dom.mapViewport.classList.remove('is-arrange');
    if (event?.pointerId !== undefined && dom.mapViewport.hasPointerCapture?.(event.pointerId)) {
      dom.mapViewport.releasePointerCapture(event.pointerId);
    }
    flushRenderMap();
    if (shouldOpenInspector) selectNode(clickedNodeId);
  };
  dom.mapViewport.addEventListener('pointerup', stopDragging);
  dom.mapViewport.addEventListener('pointercancel', stopDragging);

  dom.mapViewport.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      stopCameraAnimation();
      dom.atlasMain.classList.add('has-navigated');
      if (isGpuDepth()) {
        // Smooth, proportional zoom that keeps the ground point under the cursor fixed.
        const factor = Math.exp(-clamp(event.deltaY, -160, 160) * (event.ctrlKey ? 0.012 : 0.0022));
        const nextZoom = clamp(state.camera.zoom * factor, 0.5, 2.6);
        const rect = dom.mapViewport.getBoundingClientRect();
        updateCamera(gpuCity.zoomAtScreen(state.camera, event.clientX - rect.left, event.clientY - rect.top, nextZoom));
        return;
      }
      const direction = event.deltaY > 0 ? -0.08 : 0.08;
      updateCamera({ zoom: clamp(state.camera.zoom + direction, 0.62, 2.15) });
    },
    { passive: false },
  );

  dom.zoomIn.addEventListener('click', () => updateCamera({ zoom: clamp(state.camera.zoom + 0.14, 0.62, 2.15) }));
  dom.zoomOut.addEventListener('click', () => updateCamera({ zoom: clamp(state.camera.zoom - 0.14, 0.62, 2.15) }));
  dom.cameraReset.addEventListener('click', resetCamera);
  document.querySelectorAll('[data-camera]').forEach((button) => {
    button.addEventListener('click', () => {
      state.camera = cameraPreset(button.dataset.camera);
      renderCamera();
      renderMap();
      announce(`${button.textContent.trim()} camera preset selected.`);
    });
  });

  dom.cameraPitch.addEventListener('input', (event) => updateCamera({ pitch: Number(event.target.value) }));
  dom.cameraBearing.addEventListener('input', (event) => updateCamera({ bearing: Number(event.target.value) }));
  dom.cameraDepth.addEventListener('input', (event) => updateCamera({ depth: Number(event.target.value) }));

  dom.inspectorPaths.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-copy-path]');
    if (!button) return;
    const copied = await copyText(button.dataset.copyPath);
    dom.copyStatus.textContent = copied ? 'Copied' : 'Copy unavailable';
  });

  dom.copyContext?.addEventListener('click', async () => {
    const node = nodeById.get(state.selectedNodeId);
    const copied = await copyText(contextMarkdown(node));
    dom.copyStatus.textContent = copied ? 'Copied' : 'Copy unavailable';
    announce(dom.copyStatus.textContent);
  });

  dom.helpButton.addEventListener('click', () => dom.helpDialog.showModal());
  dom.helpClose.addEventListener('click', () => dom.helpDialog.close());
  dom.helpDialog.addEventListener('close', () => dom.helpButton.focus());

  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const editing = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
    if (onboarding.active && event.key === 'Tab') {
      const buttons = [...dom.onboardingOverlay.querySelectorAll('button:not([disabled])')].filter((button) => !button.hidden);
      const index = buttons.indexOf(document.activeElement);
      event.preventDefault();
      buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      return;
    }
    if (event.key === 'Escape') {
      if (onboarding.active) {
        closeOnboarding();
        return;
      }
      if (dom.helpDialog.open) {
        dom.helpDialog.close();
        return;
      }
      if (state.inspectorVisible) {
        closeInspector();
        return;
      }
      if (state.openDrawer) {
        closeDrawer();
        return;
      }
      if (isWorkspaceFocused() && !state.query) {
        void toggleWorkspace();
        return;
      }
      if (state.query) {
        clearSearch();
        renderAll();
        announce('Search cleared.');
      }
      return;
    }
    if (editing || dom.helpDialog.open || onboarding.active || event.defaultPrevented) return;
    if (event.key === '/') {
      event.preventDefault();
      openOmnibox();
    } else if (event.key.toLocaleLowerCase() === 'e') {
      event.preventDefault();
      setSurface(ui.surface === 'explore' ? 'map' : 'explore');
    } else if (event.key.toLocaleLowerCase() === 'i') {
      event.preventDefault();
      toggleInspector();
    } else if (event.key.toLocaleLowerCase() === 'j') {
      event.preventDefault();
      if (DEFAULT_JOURNEY_ID) selectJourney(getActiveJourney()?.id ?? DEFAULT_JOURNEY_ID);
    } else if (event.key.toLocaleLowerCase() === 'r') {
      event.preventDefault();
      selectRepositoryView();
    } else if (event.key.toLocaleLowerCase() === 'l') {
      event.preventDefault();
      toggleLabels();
    } else if (event.key.toLocaleLowerCase() === 'm') {
      event.preventDefault();
      void toggleWorkspace();
    } else if (['o', 'p', 'a'].includes(event.key.toLocaleLowerCase())) {
      event.preventDefault();
      const interactionByKey = { a: 'arrange', o: 'orbit', p: 'pan' };
      state.interactionMode = interactionByKey[event.key.toLocaleLowerCase()];
      if (state.interactionMode !== 'pan' && state.mode === 'flat') state.mode = 'perspective';
      renderAll();
      announce(`${titleCase(state.interactionMode)} drag mode selected.`);
    } else if (event.key === '?') {
      event.preventDefault();
      dom.helpDialog.showModal();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveFlow(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveFlow(1);
    }
  });

  // Dragging the compass turns and tilts the camera.
  const gizmoPointer = { lastX: 0, lastY: 0, dragging: false };

  const stopGizmoPointer = (event) => {
    if (!gizmoPointer.dragging) return;
    gizmoPointer.dragging = false;
    if (event?.pointerId !== undefined && dom.gizmoRoot?.hasPointerCapture?.(event.pointerId)) {
      dom.gizmoRoot.releasePointerCapture(event.pointerId);
    }
  };

  dom.gizmoTrackball?.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    gizmoPointer.dragging = true;
    gizmoPointer.lastX = event.clientX;
    gizmoPointer.lastY = event.clientY;
    dom.gizmoRoot.setPointerCapture?.(event.pointerId);
  });
  dom.gizmoTrackball?.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Home') { snapCamera('overview'); return; }
    updateCamera({
      bearing: state.camera.bearing + (event.key === 'ArrowLeft' ? -10 : event.key === 'ArrowRight' ? 10 : 0),
      pitch: state.camera.pitch + (event.key === 'ArrowUp' ? 5 : event.key === 'ArrowDown' ? -5 : 0),
    });
  });

  dom.gizmoRoot?.addEventListener('pointermove', (event) => {
    if (!gizmoPointer.dragging) return;
    const deltaX = event.clientX - gizmoPointer.lastX;
    const deltaY = event.clientY - gizmoPointer.lastY;
    gizmoPointer.lastX = event.clientX;
    gizmoPointer.lastY = event.clientY;
    applyOrbitDelta(deltaX, deltaY, event.clientX, event.clientY, { bearingGain: 0.68, pitchGain: 0.52 });
  });

  dom.gizmoRoot?.addEventListener('pointerup', stopGizmoPointer);
  dom.gizmoRoot?.addEventListener('pointercancel', stopGizmoPointer);
  dom.gizmoHome?.addEventListener('click', () => {
    snapCamera('overview');
    announce('Home angle restored.');
  });

  document.querySelectorAll('[data-camera-snap]').forEach((button) => {
    button.addEventListener('click', () => snapCamera(button.dataset.cameraSnap));
  });
  document.querySelectorAll('[data-map-density]').forEach((button) => {
    button.addEventListener('click', () => {
      const next = button.dataset.mapDensity;
      if (next !== 'all' && next !== 'districts' && next !== 'modules') return;
      if (state.lens === 'journey') state.journeyDensity = next;
      else state.mapDensity = next;
      renderMap();
      const label = next === 'districts' ? 'Districts only' : next === 'modules' ? 'Modules only' : 'All layers';
      announce(`Map layers: ${label}.`);
    });
  });
  dom.viewReset?.addEventListener('click', resetViewCompletely);
  dom.viewSave?.addEventListener('click', saveCurrentView);
  dom.viewClearSave?.addEventListener('click', clearSavedView);
  dom.tourStart?.addEventListener('click', () => {
    dom.helpDialog.close();
    openOnboarding({ force: true });
  });
  dom.helpButton?.addEventListener('click', () => closePopovers());
  dom.onboardingPrev?.addEventListener('click', retreatOnboarding);
  dom.onboardingNext?.addEventListener('click', advanceOnboarding);
  dom.onboardingSkip?.addEventListener('click', () => {
    closeOnboarding();
    announce('Guide skipped. Open Help to replay the first-time use guide.');
  });

  if ('ResizeObserver' in window) {
    let resizeFrame = 0;
    const mapObserver = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        renderMap();
        if (onboarding.active) renderOnboardingStep();
      });
    });
    mapObserver.observe(dom.mapViewport);
  } else {
    window.addEventListener('resize', () => {
      renderMap();
      if (onboarding.active) renderOnboardingStep();
    });
  }
}

/** Build the immersive Three.js city; fall back to the SVG city if WebGL2 is unavailable. */
async function createCityRenderer() {
  const canvas = document.querySelector('#atlas-gpu');
  const labelLayer = document.querySelector('#atlas-labels');
  if (!canvas || !labelLayer) return null;
  try {
    const { createCity } = await import('./city-three.mjs');
    return await createCity({
      canvas,
      viewport: dom.mapViewport,
      svg: dom.atlasMap,
      labelLayer,
      onHover: (nodeId) => setHoveredNode(nodeId),
    });
  } catch (error) {
    console.warn('Immersive renderer unavailable; using the SVG city instead.', error);
    canvas.hidden = true;
    labelLayer.hidden = true;
    return null;
  }
}

/**
 * Render every [data-icon] placeholder as a local Phosphor SVG. `data-icon-fill`
 * adds a filled twin that CSS shows while the control is selected.
 */
function decorateChrome() {
  document.querySelectorAll('[data-icon]').forEach((element) => {
    if (element.querySelector(':scope > svg')) return;
    const size = Number(element.dataset.iconSize) || 18;
    const weight = element.dataset.iconWeight || (element.hasAttribute('data-icon-fill') ? 'regular' : 'bold');
    if (element.hasAttribute('data-icon-fill')) {
      // Regular at rest, filled when selected; CSS swaps them.
      element.insertAdjacentHTML('afterbegin', iconSvg(element.dataset.icon, { size, weight: 'fill', className: 'ph-icon icon-fill' }));
      element.insertAdjacentHTML('afterbegin', iconSvg(element.dataset.icon, { size, weight, className: 'ph-icon icon-regular' }));
      return;
    }
    element.insertAdjacentHTML('afterbegin', iconSvg(element.dataset.icon, { size, weight }));
  });
}

/* ------------------------------------------- module index, popovers, sharing */
const EXPLORE_GROUPS = [
  { id: 'all', label: 'All modules', types: null },
  { id: 'surface', label: 'Surfaces', types: ['surface'] },
  { id: 'route', label: 'Routes & APIs', types: ['route', 'controller'] },
  { id: 'service', label: 'Services', types: ['service'] },
  { id: 'data', label: 'Data', types: ['database'] },
  { id: 'provider', label: 'Providers & hooks', types: ['provider'] },
  { id: 'external', label: 'External', types: ['external-system'] },
  { id: 'policy', label: 'Config & policy', types: ['policy', 'configuration'] },
];
const ui = { surface: 'map', exploreFilter: 'all' };
const uiDom = {
  exploreView: document.querySelector('#explore-view'),
  exploreButton: document.querySelector('#explore-button'),
  exploreFilters: document.querySelector('#explore-filters'),
  exploreGrid: document.querySelector('#explore-grid'),
  exploreSubtitle: document.querySelector('#explore-subtitle'),
  presetsButton: document.querySelector('#presets-button'),
  presetsMenu: document.querySelector('#presets-menu .menu'),
  surpriseButton: document.querySelector('#surprise-button'),
  screenshotButton: document.querySelector('#screenshot-button'),
  shareButton: document.querySelector('#share-button'),
  angleToggle: document.querySelector('#angle-toggle'),
  angleClose: document.querySelector('#angle-close'),
  infoButton: document.querySelector('#info-button'),
  legendPopover: document.querySelector('#legend-popover'),
  legendClose: document.querySelector('#legend-close'),
  shortcutsButton: document.querySelector('#shortcuts-button'),
  shortcutsPopover: document.querySelector('#shortcuts-popover'),
  shortcutsClose: document.querySelector('#shortcuts-close'),
  omniboxFilters: document.querySelector('#omnibox-filters'),
  omniboxWrap: document.querySelector('#omnibox-wrap'),
  omniboxLaunch: document.querySelector('#omnibox-launch'),
  omniboxClose: document.querySelector('#omnibox-close'),
  journeyClose: document.querySelector('#journey-close'),
  exploreClose: document.querySelector('#explore-close'),
};

function openOmnibox() {
  if (!uiDom.omniboxWrap) return;
  setSurface('map');
  uiDom.omniboxWrap.classList.add('is-open');
  uiDom.omniboxWrap.classList.remove('is-collapsed');
  dom.atlasSearch.tabIndex = 0;
  requestAnimationFrame(() => {
    dom.atlasSearch.focus({ preventScroll: true });
    dom.atlasSearch.select();
  });
}

function closeOmnibox({ clear = false } = {}) {
  if (!uiDom.omniboxWrap || !uiDom.omniboxWrap.classList.contains('is-open')) return;
  if (clear && state.query) {
    clearSearch();
    renderAll();
  }
  if (state.query) return;
  uiDom.omniboxWrap.classList.remove('is-open');
  uiDom.omniboxWrap.classList.add('is-collapsed');
  dom.atlasSearch.tabIndex = -1;
  dom.atlasSearch.blur();
}

function setSurface(surface) {
  const next = surface === 'explore' ? 'explore' : 'map';
  if (ui.surface === next) return;
  ui.surface = next;
  dom.atlasMain.dataset.surface = next;
  if (uiDom.exploreView) uiDom.exploreView.hidden = next !== 'explore';
  uiDom.exploreButton?.setAttribute('aria-pressed', String(next === 'explore'));
  uiDom.exploreButton?.classList.toggle('is-selected', next === 'explore');
  document.querySelectorAll('.rail [data-view]').forEach((button) => {
    if (next === 'explore') {
      button.classList.remove('is-selected');
      button.setAttribute('aria-pressed', 'false');
    }
  });
  if (next === 'explore') {
    closeDrawer({ restoreFocus: false });
    closeOmnibox({ clear: true });
    state.guideVisible = false;
    state.inspectorVisible = false;
    renderPanelVisibility();
    renderExplore();
    gpuCity?.setActive(false);
    announce('Module index opened.');
  } else {
    renderLensAndMode();
    gpuCity?.setActive(state.mode === 'perspective');
    scheduleRenderMap();
  }
}

function exploreCard({ classes = '', color, icon, title, kicker, path, foot, dataset = {} }) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = `explore-card ${classes}`.trim();
  card.style.setProperty('--card-color', color);
  Object.entries(dataset).forEach(([key, value]) => { card.dataset[key] = value; });
  card.innerHTML = `
    <span class="explore-card-top">
      <span class="explore-card-icon">${iconSvg(icon, { size: 20, weight: 'bold' })}</span>
      ${foot?.chip ? `<span class="status-chip" data-status="${escapeHtml(foot.chipStatus ?? '')}">${escapeHtml(foot.chip)}</span>` : ''}
    </span>
    <span>
      <span class="explore-card-title">${escapeHtml(title)}</span>
      <span class="explore-card-kicker">${escapeHtml(kicker)}</span>
      ${path ? `<code class="explore-card-path">${escapeHtml(path)}</code>` : ''}
    </span>
    <span class="explore-card-foot"><span>${escapeHtml(foot?.left ?? '')}</span><span>${escapeHtml(foot?.right ?? '')}</span></span>`;
  return card;
}

function renderExplore() {
  if (!uiDom.exploreGrid) return;
  const group = EXPLORE_GROUPS.find((entry) => entry.id === ui.exploreFilter) ?? EXPLORE_GROUPS[0];
  uiDom.exploreFilters.replaceChildren();
  EXPLORE_GROUPS.forEach((entry) => {
    const count = entry.types ? ATLAS_DATA.nodes.filter((node) => entry.types.includes(node.type)).length : ATLAS_DATA.nodes.length;
    if (count === 0) return;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `chip${entry.id === group.id ? ' is-selected' : ''}`;
    chip.dataset.exploreFilter = entry.id;
    chip.setAttribute('aria-pressed', String(entry.id === group.id));
    chip.textContent = `${entry.label} · ${count}`;
    uiDom.exploreFilters.append(chip);
  });
  uiDom.exploreSubtitle.textContent = `${ATLAS_DATA.nodes.length} ${SOURCE_COLLECTION_LABEL} modules across ${ATLAS_DATA.districts.length} districts. Browse by responsibility, then open a module to see its source. ${IS_GENERATED_ATLAS ? 'Generated relationships are inferred, not verified.' : 'The map follows a pinned source revision, not a running system.'}`;

  const grid = uiDom.exploreGrid;
  grid.replaceChildren();
  const heading = (text) => {
    const title = document.createElement('p');
    title.className = 'explore-section-title';
    title.textContent = text;
    grid.append(title);
  };

  if (group.id === 'all') {
    if (JOURNEYS.length) heading('Walkthrough');
    JOURNEYS.forEach((journey) => {
      const flow = flowById.get(journey.flowId);
      grid.append(exploreCard({
        classes: 'is-journey is-wide',
        color: '#b7d9be',
        icon: 'path',
        title: journey.label,
        kicker: journey.description,
        foot: { left: `${journey.steps.length} chapters · ${flow?.nodeIds.length ?? 0} calls`, right: 'Start the walkthrough' },
        dataset: { journeyId: journey.id },
      }));
    });
    heading('Districts');
    districtById.forEach((district) => {
      const members = ATLAS_DATA.nodes.filter((node) => node.district === district.id);
      const card = exploreCard({
        classes: 'is-district',
        color: district.color,
        icon: 'buildings',
        title: district.label,
        kicker: district.purpose,
        foot: { left: `${members.length} modules`, right: 'Fly to district' },
        dataset: { districtId: district.id },
      });
      const swatches = document.createElement('span');
      swatches.className = 'explore-card-swatches';
      members.slice(0, 4).forEach((node) => {
        const pill = document.createElement('span');
        pill.innerHTML = `${iconSvg(resolveNodeIcon(node), { size: 12, weight: 'bold' })}${escapeHtml(node.shortLabel)}`;
        swatches.append(pill);
      });
      card.querySelector('.explore-card-foot').before(swatches);
      grid.append(card);
    });
    heading('Modules');
  }

  const nodes = ATLAS_DATA.nodes
    .filter((node) => !group.types || group.types.includes(node.type))
    .sort((first, second) => first.district.localeCompare(second.district) || first.label.localeCompare(second.label));
  nodes.forEach((node) => {
    const district = districtById.get(node.district);
    grid.append(exploreCard({
      color: district?.color ?? '#94a3b8',
      icon: resolveNodeIcon(node),
      title: node.label,
      kicker: `${titleCase(node.type)} · ${district?.label ?? node.district}`,
      path: node.paths[0],
      foot: { left: `${RELATIONSHIP_COUNT.get(node.id) ?? 0} connections`, right: `${node.paths.length} ${node.paths.length === 1 ? 'file' : 'files'}`, chip: statusLabel(node.status), chipStatus: node.status },
      dataset: { nodeId: node.id },
    }));
  });
}

function focusDistrict(districtId) {
  const members = ATLAS_DATA.nodes.filter((node) => node.district === districtId);
  if (!members.length) return;
  setSurface('map');
  if (state.lens === 'journey') selectRepositoryView({ announceSelection: false });
  const positions = members.map((node) => getNodePosition(node));
  const center = {
    x: positions.reduce((sum, position) => sum + position.x, 0) / positions.length,
    y: positions.reduce((sum, position) => sum + position.y, 0) / positions.length,
    z: 0,
  };
  state.selectedNodeId = members[0].id;
  state.inspectorVisible = false;
  renderAll();
  if (isGpuDepth()) {
    const pan = gpuCity.panForWorld(gpuCity.atlasToWorld(center));
    animateCameraTo({ panX: pan.panX, panY: pan.panY, zoom: 1.25, pitch: 40 }, { duration: 1100 });
  }
  announce(`${districtById.get(districtId)?.label ?? 'District'} in view.`);
}

function closePopovers(except = null) {
  const popovers = [
    [dom.gizmoRoot, uiDom.angleToggle],
    [uiDom.legendPopover, uiDom.infoButton],
    [uiDom.shortcutsPopover, uiDom.shortcutsButton],
    [uiDom.presetsMenu, uiDom.presetsButton],
    [document.querySelector('#atlas-switch-menu'), document.querySelector('#atlas-switch-button')],
    [document.querySelector('#project-menu .menu'), document.querySelector('#project-menu-button')],
    [document.querySelector('#share-menu .menu'), document.querySelector('#share-open')],
  ];
  popovers.forEach(([panel, trigger]) => {
    if (!panel || panel === except) return;
    panel.hidden = true;
    trigger?.setAttribute('aria-expanded', 'false');
  });
}

function togglePopover(panel, trigger, { focus = false } = {}) {
  if (!panel) return;
  const open = panel.hidden;
  closePopovers(panel);
  panel.hidden = !open;
  trigger?.setAttribute('aria-expanded', String(open));
  if (open && focus) requestAnimationFrame(() => panel.querySelector('button, [tabindex="0"], input')?.focus({ preventScroll: true }));
}

function surpriseMe() {
  const candidates = getVisibleNodes().filter((node) => node.id !== state.selectedNodeId);
  const pick = candidates[Math.floor(Math.random() * candidates.length)] ?? ATLAS_DATA.nodes[0];
  if (pick) selectNode(pick.id);
}

function downloadScreenshot() {
  if (!gpuCity?.ready || state.mode !== 'perspective' || ui.surface !== 'map') {
    showToolbarToast('Open the 3D city to save a PNG', { tone: 'warn' });
    return;
  }
  const url = gpuCity.capture();
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${ATLAS_ENTRY?.id ?? REPOSITORY_NAME}-atlas-${state.lens === 'journey' ? 'walkthrough' : state.selectedNodeId || 'overview'}.png`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  showToolbarToast('PNG saved');
}

async function copyShareLink() {
  const url = new URL(window.location.href);
  url.search = '';
  if (ATLAS_ID) url.searchParams.set('atlas', ATLAS_ID);
  if (state.selectedNodeId) url.searchParams.set('node', state.selectedNodeId);
  url.hash = state.lens === 'journey' ? '#journey' : '#repository';
  const copied = await copyText(url.toString());
  showToolbarToast(copied ? 'Link copied' : 'Copy unavailable', { tone: copied ? 'ok' : 'warn' });
}

function bindImmersiveChrome() {
  uiDom.exploreButton?.addEventListener('click', () => setSurface(ui.surface === 'explore' ? 'map' : 'explore'));
  uiDom.exploreFilters?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-explore-filter]');
    if (!chip) return;
    ui.exploreFilter = chip.dataset.exploreFilter;
    renderExplore();
  });
  uiDom.exploreGrid?.addEventListener('click', (event) => {
    const card = event.target.closest('.explore-card');
    if (!card) return;
    if (card.dataset.nodeId) selectNode(card.dataset.nodeId);
    else if (card.dataset.journeyId) {
      setSurface('map');
      selectJourney(card.dataset.journeyId);
    } else if (card.dataset.districtId) focusDistrict(card.dataset.districtId);
  });

  uiDom.presetsButton?.addEventListener('click', (event) => togglePopover(uiDom.presetsMenu, uiDom.presetsButton, { focus: event.detail === 0 }));
  const projectMenuButton = document.querySelector('#project-menu-button');
  const projectMenu = document.querySelector('#project-menu .menu');
  projectMenuButton?.addEventListener('click', (event) => togglePopover(projectMenu, projectMenuButton, { focus: event.detail === 0 }));
  const shareOpen = document.querySelector('#share-open');
  const shareMenu = document.querySelector('#share-menu .menu');
  shareOpen?.addEventListener('click', (event) => togglePopover(shareMenu, shareOpen, { focus: event.detail === 0 }));
  [projectMenu, shareMenu].forEach((menu) => menu?.addEventListener('click', (event) => {
    if (event.target.closest('button.menu-item, a.menu-item')) closePopovers();
  }));
  document.querySelector('#tour-menu')?.addEventListener('click', () => openOnboarding({ force: true }));
  const atlasSwitchButton = document.querySelector('#atlas-switch-button');
  const atlasSwitchMenu = document.querySelector('#atlas-switch-menu');
  atlasSwitchButton?.addEventListener('click', (event) => togglePopover(atlasSwitchMenu, atlasSwitchButton, { focus: event.detail === 0 }));
  uiDom.presetsMenu?.addEventListener('click', (event) => {
    if (event.target.closest('[data-camera], [data-camera-snap]')) closePopovers();
  });
  uiDom.surpriseButton?.addEventListener('click', surpriseMe);
  uiDom.screenshotButton?.addEventListener('click', downloadScreenshot);
  uiDom.shareButton?.addEventListener('click', () => { void copyShareLink(); });
  uiDom.angleToggle?.addEventListener('click', (event) => togglePopover(dom.gizmoRoot, uiDom.angleToggle, { focus: event.detail === 0 }));
  uiDom.angleClose?.addEventListener('click', () => closePopovers());
  uiDom.infoButton?.addEventListener('click', (event) => togglePopover(uiDom.legendPopover, uiDom.infoButton, { focus: event.detail === 0 }));
  uiDom.legendClose?.addEventListener('click', () => closePopovers());
  uiDom.shortcutsButton?.addEventListener('click', (event) => togglePopover(uiDom.shortcutsPopover, uiDom.shortcutsButton, { focus: event.detail === 0 }));
  uiDom.shortcutsClose?.addEventListener('click', () => closePopovers());
  uiDom.omniboxLaunch?.addEventListener('click', () => openOmnibox());
  uiDom.omniboxClose?.addEventListener('click', () => closeOmnibox({ clear: true }));
  dom.atlasSearch.addEventListener('blur', () => {
    window.setTimeout(() => {
      const active = document.activeElement;
      if (active && (active === dom.atlasSearch || uiDom.omniboxWrap?.contains(active))) return;
      if (!state.query) closeOmnibox();
    }, 160);
  });
  uiDom.journeyClose?.addEventListener('click', () => {
    state.guideVisible = false;
    renderPanelVisibility();
    scheduleRenderMap();
    announce('Walkthrough panel closed. The path stays highlighted; press J to reopen it.');
  });
  uiDom.exploreClose?.addEventListener('click', () => setSurface('map'));
  dom.sceneReadme.addEventListener('click', () => togglePopover(uiDom.legendPopover, uiDom.infoButton));
  uiDom.omniboxFilters?.addEventListener('click', () => {
    if (state.openDrawer === 'explorer') closeDrawer();
    else openDrawer('explorer');
  });

  document.addEventListener('pointerdown', (event) => {
    const inside = event.target.closest('.popover, .chip-menu, .corner-stack, .topbar, .scene-caption, #shortcuts-button');
    if (!inside) closePopovers();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (ui.surface === 'explore' && !state.openDrawer && !dom.helpDialog.open) setSurface('map');
      closePopovers();
      if (document.activeElement !== dom.atlasSearch) closeOmnibox({ clear: true });
    }
  }, true);

  // Deep link: ?node=<id> reopens a module.
  const nodeParam = new URLSearchParams(window.location.search).get('node');
  if (nodeParam && nodeById.has(nodeParam)) {
    requestAnimationFrame(() => selectNode(nodeParam, { announceSelection: false }));
  }
}

if (new URLSearchParams(window.location.search).has('noblur')) document.body.classList.add('no-blur');

/** Repository identity, artwork, and the atlas switcher come from the loaded pack and the registry. */
function applyAtlasBranding() {
  const revision = ATLAS_DATA.meta.repositoryRevision;
  document.title = `${REPOSITORY_DISPLAY_NAME} · Platform Atlas`;
  dom.brandName.textContent = REPOSITORY_DISPLAY_NAME;
  dom.atlasArt.src = ATLAS_ENTRY?.art ?? ATLAS_ENTRY?.mark ?? './assets/repository-mark.svg';
  dom.repositoryLink.href = `${REPOSITORY_URL}/tree/${revision}`;
  dom.repositoryLink.title = `${ATLAS_DATA.meta.generatedFor ?? REPOSITORY_NAME} · mapped revision ${revision}`;
  dom.repositoryRevision.textContent = revision.slice(0, 7);

  // The repository name doubles as the switcher whenever more than one atlas is registered.
  const switchable = ATLAS_REGISTRY.length > 1;
  dom.atlasSwitchButton.disabled = !switchable;
  dom.atlasSwitchButton.setAttribute('aria-label', switchable
    ? `Repository: ${REPOSITORY_DISPLAY_NAME}. Switch repository`
    : `Repository: ${REPOSITORY_DISPLAY_NAME}`);
  if (!switchable) return;
  ATLAS_REGISTRY.forEach((entry) => {
    const current = entry.id === ATLAS_ENTRY?.id;
    const item = document.createElement('a');
    item.className = `menu-item atlas-option${current ? ' is-selected' : ''}`;
    item.setAttribute('role', 'menuitem');
    if (current) item.setAttribute('aria-current', 'page');
    item.href = `?atlas=${encodeURIComponent(entry.id)}`;
    item.title = entry.summary ?? '';
    item.innerHTML = `<img src="${escapeHtml(entry.art ?? entry.mark ?? './assets/repository-mark.svg')}" alt="" width="32" height="32" decoding="async" /><span><strong>${escapeHtml(entry.title)}</strong><small>${escapeHtml(entry.repository)}</small></span>`;
    dom.atlasSwitchMenu.append(item);
  });
}

gpuCity = await createCityRenderer();
applyAtlasBranding();
decorateChrome();
bindImmersiveChrome();

const restoredSavedView = loadSavedView({ announceRestore: true });
renderStatusFilter();
renderEdgeLegend();
renderTruthSemantics();
bindEvents();
chrome = createChrome({
  onAppearance: (look) => {
    districtById.forEach((district) => {
      if (district.appearanceColors) district.color = district.appearanceColors[look];
    });
    gpuCity?.setAppearance?.(look);
    renderAll();
    renderEdgeLegend();
    if (ui.surface === 'explore') renderExplore();
  },
});
if (window.location.hash === '#journey' && DEFAULT_JOURNEY_ID) {
  selectJourney(getActiveJourney()?.id ?? DEFAULT_JOURNEY_ID, { announceSelection: false });
} else {
  renderAll();
}
renderWorkspace();
window.addEventListener('hashchange', () => {
  const nextView = window.location.hash === '#journey' ? 'journey' : 'repository';
  if (nextView === 'journey' && state.lens !== 'journey') {
    if (DEFAULT_JOURNEY_ID) selectJourney(getActiveJourney()?.id ?? DEFAULT_JOURNEY_ID, { announceSelection: false });
  } else if (nextView === 'repository' && state.lens === 'journey') {
    selectRepositoryView({ announceSelection: false });
  }
});
if (!restoredSavedView) requestAnimationFrame(() => playEntranceZoom());
document.body.dataset.atlasRenderer = gpuCity?.ready ? 'three' : 'svg';
announce(`${ATLAS_TITLE} ready: ${ATLAS_DATA.nodes.length} ${SOURCE_COLLECTION_LABEL} modules, ${FLOWS.length} source ${FLOWS.length === 1 ? 'flow' : 'flows'}, and ${JOURNEYS.length} ${JOURNEYS.length === 1 ? 'walkthrough' : 'walkthroughs'}.`);

function syncViewHash() {
  const nextHash = state.lens === 'journey' ? '#journey' : '#repository';
  if (window.location.hash !== nextHash) {
    history.replaceState(null, '', nextHash);
  }
}
