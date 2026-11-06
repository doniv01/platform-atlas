/**
 * Viewer pack for the curated WooCommerce source graph.
 *
 * `woo-source-data.mjs` is the frozen evidence model. This module projects that
 * evidence into the viewer contract (see docs/DATA_CONTRACT.md). It does not add
 * runtime or deployment claims.
 */
import { resolveDistrictColors } from '../../src/palette.mjs';
import {
  atlasMeta,
  districts as sourceDistricts,
  edges as sourceEdges,
  nodes as sourceNodes,
} from './woo-source-data.mjs';

export const ATLAS_CONTRACT = Object.freeze({
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
    repository: ['confirmed', 'documented-only'],
    runtime: ['unverified'],
  },
});

const truth = (repository = 'confirmed') => ({
  deployment: 'unverified',
  repository,
  runtime: 'unverified',
});

const STATUS_BY_VERIFICATION = Object.freeze({
  conditional: 'gated',
  extension: 'gated',
  external: 'external',
  generated: 'parked',
  verified: 'active-code',
});

const EDGE_TYPE = Object.freeze({
  build: 'deployment',
  call: 'contains',
  event: 'event',
  read: 'read',
  request: 'request',
  response: 'response',
  write: 'write',
});

const TYPE_BY_KIND = Object.freeze({
  adapter: 'provider',
  'adapter-registry': 'provider',
  adapters: 'provider',
  'api-bootstrap': 'route',
  'api-surface': 'controller',
  'async-adapters': 'provider',
  'client-application': 'surface',
  'client-navigation': 'surface',
  'client-orchestrator': 'controller',
  'client-state': 'database',
  'client-ui': 'surface',
  'conditional-api': 'route',
  controller: 'controller',
  'data-adapter': 'database',
  'domain-model': 'service',
  'domain-orchestrator': 'service',
  'domain-service': 'service',
  'domain-side-effect': 'service',
  entrypoint: 'route',
  'extension-boundary': 'external-system',
  'external-boundary': 'external-system',
  'feature-selector': 'policy',
  'legacy-orchestrator': 'service',
  'legacy-ui': 'surface',
  manifest: 'configuration',
  'module-group': 'service',
  orchestrator: 'service',
  'package-bootstrap': 'service',
  'package-composition': 'service',
  'package-group': 'provider',
  'persistence-abstraction': 'database',
  'public-api': 'provider',
  registry: 'provider',
  router: 'route',
  'runtime-shell': 'service',
  schema: 'database',
  'server-api': 'controller',
  tooling: 'service',
});

const SHORT_LABELS = Object.freeze({
  'admin-react': 'Woo Admin',
  'async-delivery': 'Async delivery',
  'block-data': 'Block data',
  'blocks-bootstrap': 'Blocks bootstrap',
  'blocks-integration-registry': 'Blocks registry',
  'builtin-gateways': 'Built-in gateways',
  'checkout-processor': 'Place order',
  'classic-storefront': 'Classic UI',
  'core-cart-session': 'Cart session',
  'data-store-router': 'Data-store router',
  'delivery-tooling': 'Release tooling',
  'external-gateways': 'Gateway extensions',
  'external-services': 'Remote systems',
  'inventory-coupons': 'Stock & coupons',
  'order-store-selector': 'Order-store switch',
  'payment-bridge': 'Payment bridge',
  'runtime-storage': 'Runtime storage',
  'store-api-bootstrap': 'Store API boot',
  'store-api-schemas': 'Schemas & auth',
});

function shortenedLabel(node) {
  const chosen = SHORT_LABELS[node.id] ?? node.label;
  return chosen.length > 20 ? `${chosen.slice(0, 19).trimEnd()}…` : chosen;
}

function sourceFolder(path = '') {
  if (!path.includes('/')) return 'repository root';
  const folders = [
    'packages/js',
    'packages/php',
    'plugins/woocommerce/client/blocks',
    'plugins/woocommerce/client/admin',
    'plugins/woocommerce/src/StoreApi',
    'plugins/woocommerce/src/Blocks',
    'plugins/woocommerce/src/Internal/DataStores',
    'plugins/woocommerce/src/Internal/Admin',
    'plugins/woocommerce/src/Admin',
    'plugins/woocommerce/src',
    'plugins/woocommerce/includes/rest-api',
    'plugins/woocommerce/includes',
    '.github',
    'tools',
  ];
  return folders.find((folder) => path === folder || path.startsWith(`${folder}/`)) ?? path.split('/').slice(0, 2).join('/');
}

function hash(value) {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function positionFor(node) {
  const centerX = node.x + (node.w ?? 0) / 2;
  const centerY = node.y + (node.h ?? 0) / 2;
  return {
    x: Math.round((5 + ((centerX - 40) / 1720) * 90) * 10) / 10,
    y: Math.round((95 - ((centerY - 40) / 1140) * 90) * 10) / 10,
    z: 8 + (hash(node.id) % 15),
  };
}

function evidenceShape(node) {
  return {
    nodeId: node.id,
    sourceClaims: (node.evidence ?? []).slice(0, 3).map((item) => ({
      path: item.path,
      line: item.line ?? '[directory evidence]',
      symbol: item.symbol ?? '[source surface]',
    })),
    runtime: 'not inferred from source presence',
    deployment: 'not inferred from source presence',
  };
}

const nodes = sourceNodes.map((node) => ({
  id: node.id,
  label: node.label,
  shortLabel: shortenedLabel(node),
  type: TYPE_BY_KIND[node.kind] ?? 'service',
  district: node.district,
  layout: sourceFolder(node.paths[0]),
  status: STATUS_BY_VERIFICATION[node.verification.status] ?? 'gated',
  truth: truth(node.verification.status === 'generated' ? 'documented-only' : 'confirmed'),
  position: positionFor(node),
  paths: [...node.paths],
  purpose: node.purpose,
  trace: [...node.howItWorks],
  packet: {
    direction: 'source evidence',
    label: 'Curated evidence shape',
    schema: evidenceShape(node),
  },
  risks: [...node.risks],
  boundaries: [
    node.verification.detail,
    node.verification.status === 'verified'
      ? 'The local relationship is verified; active runtime and deployment remain unverified.'
      : 'This source surface is conditional or external; the atlas does not claim it is active.',
  ],
  tags: [...node.tags, node.kind, node.verification.status],
}));

const sourceRelationshipEdges = sourceEdges.map((edge) => ({
  ...edge,
  type: EDGE_TYPE[edge.type] ?? 'contains',
  sourceType: edge.type,
}));

const journeyEdges = [
  {
    id: 'processor-router', from: 'checkout-processor', to: 'store-api-router', type: 'request',
    label: 'POST /wc/store/v1/checkout', confidence: 'high',
    evidence: ['plugins/woocommerce/client/blocks/assets/js/base/context/providers/cart-checkout/checkout-processor.ts:294'],
  },
  {
    id: 'cart-return', from: 'core-cart-session', to: 'checkout-api', type: 'response',
    label: 'validated cart and totals', confidence: 'high',
    evidence: ['plugins/woocommerce/src/StoreApi/Routes/V1/Checkout.php:608-619'],
  },
  {
    id: 'selector-return', from: 'order-store-selector', to: 'data-store-router', type: 'response',
    label: 'selected CPT or HPOS adapter', confidence: 'high',
    evidence: ['plugins/woocommerce/src/Internal/DataStores/Orders/CustomOrdersTableController.php:253-289'],
  },
  {
    id: 'store-return', from: 'data-store-router', to: 'order-model', type: 'response',
    label: 'save returns through selected store', confidence: 'high',
    evidence: ['plugins/woocommerce/includes/abstracts/abstract-wc-data.php:342-369'],
  },
  {
    id: 'model-return', from: 'order-model', to: 'order-controller', type: 'response',
    label: 'order aggregate ready', confidence: 'high',
    evidence: ['plugins/woocommerce/src/StoreApi/Utilities/OrderController.php:82-103'],
  },
  {
    id: 'order-return', from: 'order-controller', to: 'checkout-api', type: 'response',
    label: 'draft order ready', confidence: 'high',
    evidence: ['plugins/woocommerce/src/StoreApi/Routes/V1/Checkout.php:862-886'],
  },
  {
    id: 'gateway-return', from: 'gateway-registry', to: 'payment-bridge', type: 'response',
    label: 'gateway result or redirect', confidence: 'high',
    evidence: ['plugins/woocommerce/src/StoreApi/Legacy.php:56-82'],
  },
  {
    id: 'payment-return', from: 'payment-bridge', to: 'checkout-api', type: 'response',
    label: 'normalized payment result', confidence: 'high',
    evidence: ['plugins/woocommerce/src/StoreApi/Utilities/CheckoutTrait.php:28-41'],
  },
  {
    id: 'result-processor', from: 'checkout-result', to: 'checkout-processor', type: 'response',
    label: 'payment status and redirect', confidence: 'high',
    evidence: ['plugins/woocommerce/client/blocks/assets/js/base/context/providers/cart-checkout/checkout-processor.ts:309'],
  },
  {
    id: 'processor-ui', from: 'checkout-processor', to: 'checkout-ui', type: 'response',
    label: 'store result and navigate', confidence: 'high',
    evidence: ['plugins/woocommerce/client/blocks/packages/public-api/block-data/checkout/thunks.ts:54'],
  },
];

const edges = [...sourceRelationshipEdges, ...journeyEdges];

const flows = [
  {
    id: 'woocommerce-block-checkout',
    label: 'Checkout Block: place order and return result',
    status: 'active-code',
    description: 'The source-grounded Checkout Block request path through Store API validation, order materialization, selectable persistence, payment handling, and the browser result.',
    nodeIds: [
      'checkout-ui',
      'block-data',
      'checkout-processor',
      'store-api-router',
      'checkout-api',
      'core-cart-session',
      'checkout-api',
      'order-controller',
      'order-model',
      'data-store-router',
      'order-store-selector',
      'data-store-router',
      'order-model',
      'order-controller',
      'checkout-api',
      'payment-bridge',
      'gateway-registry',
      'payment-bridge',
      'checkout-api',
      'checkout-result',
      'checkout-processor',
      'checkout-ui',
    ],
    edgeIds: [
      'e-checkout-data',
      'e-data-processor',
      'processor-router',
      'e-router-checkout',
      'e-checkout-cart',
      'cart-return',
      'e-checkout-order',
      'e-order-model',
      'e-order-data-router',
      'e-router-selector',
      'selector-return',
      'store-return',
      'model-return',
      'order-return',
      'e-checkout-payment',
      'e-payment-gateways',
      'gateway-return',
      'payment-return',
      'e-checkout-response',
      'result-processor',
      'processor-ui',
    ],
    cautions: [
      'The walkthrough begins after the Checkout Block is already rendered; product discovery and cart creation are outside this focused trace.',
      'The runtime order store can be CPT or HPOS. This source checkout contains both and does not prove which one is authoritative.',
      'Extensions can handle the Store API payment hook before the legacy gateway fallback.',
      'A returned payment result or redirect is not proof of external authorization, capture, settlement, or deployment.',
    ],
  },
  {
    id: 'plugin-bootstrap',
    label: 'WordPress plugin bootstrap into Store API',
    status: 'gated',
    description: 'WordPress loads the plugin entry, which composes packages and conditionally initializes Blocks and Store API routing.',
    nodeIds: ['wordpress-host', 'wc-entry', 'package-loader', 'blocks-bootstrap', 'store-api-bootstrap', 'store-api-router'],
    edgeIds: ['e-wp-entry', 'e-entry-packages', 'e-packages-blocks', 'e-blocks-store-api', 'e-storeapi-routes'],
    cautions: ['Lifecycle, request context, generated packages, and options decide which branches initialize.'],
  },
  {
    id: 'cart-mutation',
    label: 'Cart Block add-item mutation',
    status: 'active-code',
    description: 'The browser submits an add-item request and the Store API returns a complete cart response.',
    nodeIds: ['cart-ui', 'cart-api', 'cart-ui'],
    edgeIds: ['e-cart-request', 'e-cart-response'],
    cautions: ['This is the Blocks cart path, not every classic AJAX or extension path.'],
  },
  {
    id: 'order-persistence-cpt',
    label: 'Order persistence: CPT branch',
    status: 'gated',
    description: 'The order model delegates through WC_Data_Store and the runtime selector can retain the default CPT store.',
    nodeIds: ['order-model', 'data-store-router', 'order-store-selector', 'order-cpt-store'],
    edgeIds: ['e-order-data-router', 'e-router-selector', 'e-selector-cpt'],
    cautions: ['Source presence does not establish that a site is using CPT order storage.'],
  },
  {
    id: 'order-persistence-hpos',
    label: 'Order persistence: HPOS branch',
    status: 'gated',
    description: 'The order model delegates through WC_Data_Store and the runtime selector can choose the HPOS adapter.',
    nodeIds: ['order-model', 'data-store-router', 'order-store-selector', 'order-hpos-store'],
    edgeIds: ['e-order-data-router', 'e-router-selector', 'e-selector-hpos'],
    cautions: ['Source presence does not establish that HPOS is enabled or authoritative.'],
  },
  {
    id: 'admin-rest-data',
    label: 'Woo Admin through authenticated REST',
    status: 'gated',
    description: 'The merchant React surface uses PHP and REST controllers that can read or mutate WooCommerce models.',
    nodeIds: ['admin-react', 'admin-api', 'wc-rest-api', 'data-store-router'],
    edgeIds: ['e-admin-api', 'e-admin-rest', 'e-rest-data'],
    cautions: ['Capabilities, features, current page, and installed extensions shape reachable endpoints.'],
  },
];

const journeys = [
  {
    id: 'woocommerce-checkout-journey',
    label: 'Start here: Checkout Block place order',
    status: 'active-code',
    flowId: 'woocommerce-block-checkout',
    description: 'A newcomer-friendly walkthrough from confirmed Checkout Block state to the browser receiving an order and payment result.',
    shortLabel: 'The checkout walkthrough',
    // Story stages read left to right, with the return path folding back toward the browser.
    positions: {
      'checkout-ui': { x: 4, y: 58, z: 12 },
      'block-data': { x: 15, y: 76, z: 10 },
      'checkout-processor': { x: 27, y: 54, z: 15 },
      'store-api-router': { x: 39, y: 75, z: 14 },
      'checkout-api': { x: 51, y: 50, z: 19 },
      'core-cart-session': { x: 63, y: 74, z: 12 },
      'order-controller': { x: 66, y: 47, z: 17 },
      'order-model': { x: 76, y: 65, z: 20 },
      'data-store-router': { x: 86, y: 78, z: 14 },
      'order-store-selector': { x: 96, y: 57, z: 18 },
      'payment-bridge': { x: 83, y: 31, z: 20 },
      'gateway-registry': { x: 95, y: 20, z: 14 },
      'checkout-result': { x: 52, y: 19, z: 11 },
    },
    entryBoundary: 'Scope begins with an already-rendered Checkout Block and populated client state. Product discovery, add-to-cart, page routing, and a site’s active configuration are not proven by this trace.',
    completionBoundary: 'Scope ends when local client code receives the Store API result and may navigate to its redirect. External authorization, capture, settlement, emails, webhooks, and the destination page remain outside this source-backed walkthrough.',
    steps: [
      {
        id: 'prepare',
        title: 'Prepare the place-order request',
        startHop: 0,
        endHop: 2,
        stageNodeId: 'checkout-ui',
        description: 'Checkout UI, cart/checkout stores, and the checkout processor coordinate validation and assemble the final request payload.',
        boundary: 'Browser state coordinates submission; it is not the server authority for totals, order state, inventory, or payment.',
      },
      {
        id: 'validate',
        title: 'Dispatch and validate in Store API',
        startHop: 3,
        endHop: 6,
        stageNodeId: 'store-api-router',
        description: 'WordPress REST routing dispatches the checkout endpoint, which reloads the cart/session, recalculates totals, and validates checkout input.',
        boundary: 'Route registration and validation calls are verified; an active WordPress request and site configuration are not.',
      },
      {
        id: 'materialize',
        title: 'Materialize and persist the order',
        startHop: 7,
        endHop: 14,
        stageNodeId: 'order-store-selector',
        description: 'OrderController creates or updates a WC_Order. Saving delegates through WC_Data_Store, where runtime state selects CPT or HPOS before control returns to checkout.',
        boundary: 'Both persistence implementations exist in source. The active authority, table contents, sync state, and database runtime are unverified.',
      },
      {
        id: 'pay-return',
        title: 'Process payment and return control',
        startHop: 15,
        endHop: 21,
        stageNodeId: 'payment-bridge',
        description: 'Checkout emits the Store API payment context, the configured handler returns a normalized result, and the browser stores the outcome or follows the redirect.',
        boundary: 'Extensions may intercept payment before fallback. A response is not evidence of provider authorization, capture, settlement, or redirect success.',
      },
    ],
  },
];

export const ATLAS_DATA = Object.freeze({
  meta: {
    generatedFor: 'woocommerce/woocommerce',
    repositoryUrl: 'https://github.com/woocommerce/woocommerce',
    repositoryRevision: '5d86d8f40b68039d16419049a40a3abf065ca71c',
    title: 'WooCommerce Platform Atlas',
    storageNamespace: 'platform-atlas-woocommerce',
    defaultFlowId: 'woocommerce-block-checkout',
    defaultJourneyId: 'woocommerce-checkout-journey',
    defaultNodeId: 'checkout-ui',
    journeyKicker: 'Checkout path',
    displayName: 'WooCommerce',
    updated: atlasMeta.commitDate,
    nodeIcons: {
  'workspace-root': 'git-branch',
    'js-packages': 'package',
    'php-packages': 'stack',
    'delivery-tooling': 'rocket-launch',
    'wordpress-host': 'globe-hemisphere-west',
    'wc-entry': 'play',
    'package-loader': 'arrows-split',
    'core-runtime': 'pulse',
    'blocks-bootstrap': 'cube',
    'blocks-hydration': 'arrows-clockwise',
    'cart-ui': 'shopping-cart',
    'checkout-ui': 'layout',
    'block-data': 'database',
    'checkout-processor': 'cursor-click',
    'checkout-result': 'flow-arrow',
    'classic-storefront': 'storefront',
    'js-extension-api': 'git-fork',
    'blocks-integration-registry': 'tree-structure',
    'wp-hooks': 'plugs',
    'external-gateways': 'cloud',
    'external-services': 'broadcast',
    'store-api-bootstrap': 'path',
    'store-api-router': 'graph',
    'store-api-schemas': 'lock',
    'cart-api': 'basket',
    'checkout-api': 'lightning',
    'wc-rest-api': 'brackets-curly',
    'experimental-apis': 'flask',
    'core-cart-session': 'shopping-bag',
    'checkout-fields': 'clipboard-text',
    'shipping-engine': 'truck',
    'product-model': 'tag',
    'order-controller': 'sliders',
    'classic-checkout': 'cash-register',
    'order-model': 'invoice',
    'payment-bridge': 'credit-card',
    'gateway-registry': 'plug',
    'builtin-gateways': 'wallet',
    'inventory-coupons': 'ticket',
    'admin-react': 'app-window',
    'admin-api': 'code',
    'admin-domains': 'squares-four',
    'data-store-router': 'swap',
    'order-store-selector': 'toggle-left',
    'order-cpt-store': 'database',
    'order-hpos-store': 'table',
    'async-delivery': 'queue',
    'runtime-storage': 'hard-drives',
    },
  },
  truthSemantics: [
    {
      label: 'Repository truth',
      meaning: 'Exact paths and the described local relationships are curated from this checked-out source revision.',
    },
    {
      label: 'Runtime enablement',
      meaning: 'Options, hooks, extensions, request context, and generated artifacts decide which code actually runs; this remains unverified.',
    },
    {
      label: 'Deployment truth',
      meaning: 'Source presence does not prove a built plugin, active site, database contents, configured provider, or deployed service.',
    },
  ],
  districts: resolveDistrictColors(sourceDistricts).map((district) => ({
    id: district.id,
    label: district.label,
    color: district.color,
    appearanceColors: district.appearanceColors,
    purpose: district.summary,
  })),
  nodes,
  edges,
  flows,
  journeys,
});
