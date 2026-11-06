import { resolveDistrictColors } from '../../src/palette.mjs';
/**
 * Curated, source-only architecture atlas for antiwork/gumroad.
 * Repository claims are pinned; runtime and deployment claims are not inferred.
 */

const REVISION = '29bb68b1c37884b66a07062c7dcf9e19a71766d8';

export const ATLAS_CONTRACT = Object.freeze({
  edgeTypes: ['broadcast', 'contains', 'deployment', 'event', 'read', 'request', 'response', 'write'],
  nodeTypes: [
    'configuration', 'controller', 'database', 'external-system', 'policy',
    'provider', 'route', 'service', 'surface',
  ],
  statuses: ['active-code', 'external', 'gated', 'parked'],
  truth: {
    deployment: ['unverified'],
    repository: ['confirmed', 'documented-only'],
    runtime: ['unverified'],
  },
});

const SOURCE_TRUTH = Object.freeze({
  repository: 'confirmed',
  runtime: 'unverified',
  deployment: 'unverified',
});

const DISTRICT_ANCHORS = Object.freeze({
  gateway: { x: 10, y: 88 },
  identity: { x: 35, y: 89 },
  product: { x: 68, y: 88 },
  storefront: { x: 91, y: 78 },
  discovery: { x: 10, y: 54 },
  checkout: { x: 36, y: 56 },
  orders: { x: 68, y: 56 },
  settlement: { x: 91, y: 48 },
  fulfillment: { x: 27, y: 19 },
  ledger: { x: 76, y: 18 },
});

const LOCAL_OFFSETS = Object.freeze([
  { x: -7, y: 8 }, { x: 7, y: 8 }, { x: -7, y: -7 },
  { x: 7, y: -7 }, { x: 0, y: 0 }, { x: 0, y: 15 }, { x: 0, y: -15 },
]);

function stableHash(value) {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function positionFor(district, order, id) {
  const anchor = DISTRICT_ANCHORS[district];
  const offset = LOCAL_OFFSETS[order % LOCAL_OFFSETS.length];
  const ring = Math.floor(order / LOCAL_OFFSETS.length);
  return {
    x: anchor.x + offset.x + ring * 3,
    y: anchor.y + offset.y - ring * 3,
    z: 9 + (stableHash(id) % 14),
  };
}

function compactLabel(label) {
  return label.length > 20 ? `${label.slice(0, 19).trimEnd()}…` : label;
}

function sourceLayout(path) {
  const parts = path.split('/');
  return parts[0] === 'app' ? parts.slice(0, 3).join('/') : parts.slice(0, 2).join('/');
}

function claim(path, line, symbol, statement) {
  return { path, line, symbol, statement };
}

function node({
  id, label, shortLabel = compactLabel(label), type, district, order, purpose,
  evidence, trace = evidence.map(({ statement }) => statement),
  risks = ['Checked-in code does not prove that this path is enabled or exercised at runtime.'],
  boundaries = [], tags = [], status = 'active-code',
}) {
  const paths = [...new Set(evidence.map(({ path }) => path))];
  return {
    id,
    label,
    shortLabel,
    type,
    district,
    layout: sourceLayout(paths[0]),
    status,
    truth: { ...SOURCE_TRUTH },
    position: positionFor(district, order, id),
    paths,
    purpose,
    trace,
    packet: {
      direction: 'source evidence',
      label: 'Pinned source claims',
      schema: { repository: 'antiwork/gumroad', revision: REVISION, sourceClaims: evidence },
    },
    risks,
    boundaries: [
      `Repository claims are pinned to ${REVISION}.`,
      'Runtime reachability and deployment are unverified.',
      ...boundaries,
    ],
    tags: [...tags, district, status],
  };
}

const districts = resolveDistrictColors([
  { id: 'gateway', label: 'Gateway & UI transport', tone: 'stone', purpose: 'Rails routing, shared controller context, and Inertia page resolution.' },
  { id: 'identity', label: 'Identity & seller context', tone: 'rose', purpose: 'Signed-in seller resolution and the central account model.' },
  { id: 'product', label: 'Product studio', tone: 'verdigris', purpose: 'Seller-facing product editing, validation, persistence, and publication.' },
  { id: 'storefront', label: 'Storefront presentation', tone: 'orchid', purpose: 'Public seller and product presentation assembled by controllers and presenters.' },
  { id: 'discovery', label: 'Discovery & indexing', tone: 'moss', purpose: 'Search queries, card presentation, and product index maintenance.' },
  { id: 'checkout', label: 'Cart & checkout', tone: 'glacier', purpose: 'Cart persistence and the buyer-facing checkout state machine.' },
  { id: 'orders', label: 'Order creation', tone: 'brick', purpose: 'Order requests, purchase construction, and client-confirm PaymentIntent preparation.' },
  { id: 'settlement', label: 'Settlement & purchase state', tone: 'fern', purpose: 'Idempotent finalization of an already client-confirmed charge.' },
  { id: 'fulfillment', label: 'Fulfillment & library', tone: 'brass', purpose: 'Buyer library presentation, content redirects, and receipt delivery.' },
  { id: 'ledger', label: 'Ledger & payouts', tone: 'azure', purpose: 'Seller balance entries, payout records, and balance state transitions.' },
]);

const nodes = [
  node({
    id: 'routes', label: 'Rails routes', type: 'route', district: 'gateway', order: 0,
    purpose: 'Maps browser requests to checkout, order, library, product, discovery, profile, and payout actions.',
    evidence: [
      claim('config/routes.rb', '895-904', 'orders routes', 'Defines prepare and finalize order endpoints.'),
      claim('config/routes.rb', '948', 'checkout route', 'Routes GET /checkout to CheckoutController#show.'),
      claim('config/routes.rb', '1005-1014', 'product member routes', 'Defines product update and publish actions.'),
    ],
    tags: ['rails', 'routing'],
  }),
  node({
    id: 'application-controller', label: 'Application controller', type: 'controller', district: 'gateway', order: 1,
    purpose: 'Provides shared controller concerns and request-scoped behavior.',
    evidence: [
      claim('app/controllers/application_controller.rb', '3-20', 'ApplicationController', 'Includes shared controller concerns including CurrentSeller.'),
      claim('app/controllers/application_controller.rb', '191-203', 'merge_guest_cart_with_user_cart', 'Contains guest-cart merge behavior for a signed-in buyer.'),
    ], tags: ['rails', 'controller'],
  }),
  node({
    id: 'inertia-entry', label: 'Inertia entrypoint', type: 'surface', district: 'gateway', order: 2,
    purpose: 'Resolves server-named Inertia pages into browser modules.',
    evidence: [claim('app/javascript/entrypoints/inertia.js', '142-165', 'resolve', 'Dynamically resolves page components for the Inertia application.')],
    tags: ['inertia', 'typescript'],
  }),

  node({
    id: 'current-seller', label: 'Current seller concern', type: 'service', district: 'identity', order: 0,
    purpose: 'Resolves and exposes the signed-in seller for controller work.',
    evidence: [claim('app/controllers/concerns/current_seller.rb', '12-16, 47-65', 'CurrentSeller', 'Reads the session and resolves the current User record.')],
    tags: ['identity', 'session'],
  }),
  node({
    id: 'user-model', label: 'User account model', type: 'database', district: 'identity', order: 1,
    purpose: 'Represents buyer and seller accounts and their product, order, and payment relationships.',
    evidence: [claim('app/models/user.rb', '106-133', 'User associations', 'Declares product, purchase, and account relationships on User.')],
    tags: ['activerecord', 'buyer', 'seller'],
  }),

  node({
    id: 'links-controller', label: 'Products controller', type: 'controller', district: 'product', order: 0,
    purpose: 'Creates, updates, and publishes seller products through the legacy LinksController surface.',
    evidence: [
      claim('app/controllers/links_controller.rb', '101-145', 'create', 'Builds and saves a new Link product.'),
      claim('app/controllers/links_controller.rb', '470-518', 'update', 'Runs the product update contract before applying writes.'),
      claim('app/controllers/links_controller.rb', '829-851', 'publish', 'Delegates publication to the product model.'),
    ], tags: ['product', 'seller'],
  }),
  node({
    id: 'product-model', label: 'Product model (Link)', type: 'database', district: 'product', order: 1,
    purpose: 'The central persisted product aggregate, historically named Link.',
    evidence: [
      claim('app/models/link.rb', '52-58', 'Link concerns', 'Includes Product::Searchable and related product concerns.'),
      claim('app/models/link.rb', '122-223', 'Link associations', 'Declares seller, price, sale, file, and other product relationships.'),
      claim('app/models/link.rb', '570-652', 'publish!', 'Transitions a product through publication checks and state changes.'),
    ],
    boundaries: ['A sales hold unpublishes a product and blocks publish! while it is active (app/models/link.rb:690-705), and an experiment can require a paid seller plan before a draft is first published (app/models/link.rb:2049-2061).'],
    tags: ['activerecord', 'product'],
  }),
  node({
    id: 'product-edit-page', label: 'Product editor page', type: 'surface', district: 'product', order: 2,
    purpose: 'Coordinates the seller-facing product edit screen and save action.',
    evidence: [claim('app/javascript/components/server-components/ProductEditPage.tsx', '6-23, 630-698', 'ProductEditPage', 'Imports and invokes the product save client.')],
    tags: ['react', 'seller'],
  }),
  node({
    id: 'product-edit-client', label: 'Product edit client', type: 'controller', district: 'product', order: 3,
    purpose: 'Serializes editor state and posts it to the product route.',
    evidence: [claim('app/javascript/data/product_edit.ts', '617-746', 'saveProduct', 'Builds the product payload and POSTs it to the link route.')],
    tags: ['typescript', 'request'],
  }),
  node({
    id: 'product-save-contract', label: 'Product save contract', type: 'policy', district: 'product', order: 4,
    purpose: 'Validates and normalizes product updates before controller writes.',
    evidence: [
      claim('app/services/product/save_contract.rb', '88-99', 'Product::SaveContract', 'Exposes contract validation to the product controller.'),
      claim('app/services/product/save_contract.rb', '152-207', 'validation rules', 'Defines update validation and normalization rules.'),
    ], tags: ['validation', 'rails'],
  }),

  node({
    id: 'users-controller', label: 'Storefront controller', type: 'controller', district: 'storefront', order: 0,
    purpose: 'Renders public seller profiles and product-facing storefront responses.',
    evidence: [
      claim('app/controllers/users_controller.rb', '29-39', 'show', 'Builds the public profile response with ProfilePresenter.'),
      claim('app/controllers/users_controller.rb', '100-132', 'product', 'Builds profile and product presenters for a product page.'),
    ], tags: ['storefront', 'seller'],
  }),
  node({
    id: 'profile-presenter', label: 'Profile presenter', type: 'service', district: 'storefront', order: 1,
    purpose: 'Shapes public seller profile data for web and API consumers.',
    evidence: [claim('app/presenters/profile_presenter.rb', '13-39, 42-94', 'ProfilePresenter', 'Builds profile props and associated product collections.')],
    tags: ['presenter', 'storefront'],
  }),
  node({
    id: 'product-presenter', label: 'Product presenter', type: 'service', district: 'storefront', order: 2,
    purpose: 'Shapes product cards and product-page data for browser surfaces.',
    evidence: [claim('app/presenters/product_presenter.rb', '58-119, 155-244', 'ProductPresenter', 'Builds product card and web presentation payloads.')],
    tags: ['presenter', 'product'],
  }),

  node({
    id: 'discover-controller', label: 'Discover controller', type: 'controller', district: 'discovery', order: 0,
    purpose: 'Runs discovery searches and turns results into product-card payloads.',
    evidence: [claim('app/controllers/discover_controller.rb', '16-62', 'DiscoverController', 'Calls search_products and maps results through ProductPresenter.')],
    tags: ['discover', 'search'],
  }),
  node({
    id: 'search-products', label: 'Search products concern', type: 'service', district: 'discovery', order: 1,
    purpose: 'Builds product search options and queries the Link search surface.',
    evidence: [claim('app/controllers/concerns/search_products.rb', '8-20, 43-134', 'search_products', 'Runs Link.search queries and processes product results.')],
    tags: ['search', 'controller-concern'],
  }),
  node({
    id: 'product-searchable', label: 'Product searchable', type: 'service', district: 'discovery', order: 2,
    purpose: 'Defines product indexing callbacks and search-oriented behavior.',
    evidence: [claim('app/modules/product/searchable.rb', '481-542', 'Product::Searchable', 'Invokes ProductIndexingService from indexing callbacks.')],
    tags: ['search', 'indexing'],
  }),
  node({
    id: 'product-indexing-service', label: 'Product indexer', type: 'service', district: 'discovery', order: 3,
    purpose: 'Performs the source-defined product indexing operation.',
    evidence: [claim('app/services/product_indexing_service.rb', '3-20', 'ProductIndexingService', 'Implements the product indexing service entrypoint.')],
    tags: ['search', 'indexing'],
  }),

  node({
    id: 'cart-model', label: 'Cart model', type: 'database', district: 'checkout', order: 0,
    purpose: 'Persists a buyer cart and its cart-product join rows.',
    evidence: [claim('app/models/cart.rb', '23-44, 59-67', 'Cart', 'Declares cart products, products, and cart lifecycle behavior.')],
    tags: ['cart', 'activerecord'],
  }),
  node({
    id: 'cart-product-model', label: 'Cart item model', type: 'database', district: 'checkout', order: 1,
    purpose: 'Joins a cart to a product and stores cart-line attributes.',
    evidence: [claim('app/models/cart_product.rb', '23-36', 'CartProduct', 'Belongs to a cart and product and validates the cart line.')],
    tags: ['cart', 'activerecord'],
  }),
  node({
    id: 'checkout-controller', label: 'Checkout controller', type: 'controller', district: 'checkout', order: 2,
    purpose: 'Assembles server-owned checkout props and renders the Inertia checkout page.',
    evidence: [
      claim('app/controllers/checkout_controller.rb', '9-32', 'show', 'Renders Checkout/Show with checkout props.'),
      claim('app/controllers/checkout_controller.rb', '208-233, 250-274', 'checkout props', 'Merges a cart_id cart into the browser cart and builds recommended-product cards for checkout.'),
    ], tags: ['checkout', 'rails'],
  }),
  node({
    id: 'checkout-page', label: 'Checkout page', type: 'surface', district: 'checkout', order: 3,
    purpose: 'Builds line-item requests, selects the client-confirm path, and renders the purchase outcome.',
    evidence: [
      claim('app/javascript/pages/Checkout/Show.tsx', '652-710', 'submit', 'Builds line items and calls startClientConfirmOrderCreation for the client-confirm method.'),
      claim('app/javascript/pages/Checkout/Show.tsx', '1177-1185', 'result view', 'Renders TemporaryLibrary or Receipt for successful results.'),
    ], tags: ['checkout', 'react'],
  }),
  node({
    id: 'checkout-shell', label: 'Checkout form shell', type: 'surface', district: 'checkout', order: 4,
    purpose: 'Composes the checkout interface and mounts PaymentForm.',
    evidence: [claim('app/javascript/components/Checkout/index.tsx', '35, 867', 'Checkout', 'Imports and renders PaymentForm inside the checkout interface.')],
    tags: ['checkout', 'react'],
  }),
  node({
    id: 'payment-form', label: 'Payment form', type: 'surface', district: 'checkout', order: 5,
    purpose: 'Selects the client-confirm Payment Element lane and publishes its tokenized payment method.',
    evidence: [claim('app/javascript/components/Checkout/PaymentForm.tsx', '925-976, 998-1022', 'PaymentForm', 'Calls the token helper and dispatches a payment-element-client-confirm method.')],
    tags: ['checkout', 'stripe'],
  }),
  node({
    id: 'payment-tokenizer', label: 'Payment tokenizer', type: 'service', district: 'checkout', order: 6,
    purpose: 'Submits Stripe Elements and requests a ConfirmationToken.',
    evidence: [claim('app/javascript/data/card_payment_method_data.ts', '283-323', 'createPaymentElementConfirmationToken', 'Calls stripe.createConfirmationToken and returns the token identifier.')],
    tags: ['checkout', 'stripe', 'typescript'],
  }),

  node({
    id: 'orders-controller', label: 'Orders controller', type: 'controller', district: 'orders', order: 0,
    purpose: 'Coordinates client-confirm prepare and finalize HTTP actions.',
    evidence: [
      claim('app/controllers/orders_controller.rb', '58-94', 'prepare', 'Creates an order and prepares an unconfirmed PaymentIntent.'),
      claim('app/controllers/orders_controller.rb', '97-107', 'finalize', 'Delegates idempotent finalization after browser confirmation.'),
    ], tags: ['orders', 'checkout'],
  }),
  node({
    id: 'order-client', label: 'Order browser client', type: 'controller', district: 'orders', order: 1,
    purpose: 'Posts prepare/finalize requests and invokes Stripe.js confirmation in the browser.',
    evidence: [
      claim('app/javascript/data/order.ts', '652-704', 'startClientConfirmOrderCreation', 'Prepares the order and calls stripe.confirmPayment with the ConfirmationToken.'),
      claim('app/javascript/data/order.ts', '730-748, 839-861', 'finalizeClientConfirmOrder', 'POSTs finalize and maps successful line-item results.'),
    ], tags: ['orders', 'typescript', 'stripe'],
  }),
  node({
    id: 'order-create-service', label: 'Order creator', type: 'service', district: 'orders', order: 2,
    purpose: 'Builds an order, resolves products, and delegates each line to Purchase::CreateService.',
    evidence: [
      claim('app/services/order/create_service.rb', '52-70', 'perform', 'Creates the order and resolves each product by permalink.'),
      claim('app/services/order/create_service.rb', '109-198', 'purchase creation', 'Invokes Purchase::CreateService and attaches persisted purchases to the order.'),
    ], tags: ['orders', 'service'],
  }),
  node({
    id: 'purchase-create-service', label: 'Purchase creator', type: 'service', district: 'orders', order: 3,
    purpose: 'Builds, prices, and persists the purchase record for an order line.',
    evidence: [
      claim('app/services/purchase/create_service.rb', '30-56, 163-234', 'perform', 'Builds the purchase and executes the purchase-creation path.'),
      claim('app/services/purchase/create_service.rb', '567-635', 'build_purchase', 'Copies request and product values into a Purchase record.'),
    ], tags: ['purchase', 'pricing'],
  }),
  node({
    id: 'prepare-payment-intent', label: 'PaymentIntent preparer', type: 'service', district: 'orders', order: 4,
    purpose: 'Builds the charge, creates an unconfirmed deferred intent, persists its mapping, and returns a client secret.',
    evidence: [
      claim('app/services/order/prepare_payment_intent_service.rb', '485-522, 549-561', 'prepare_unconfirmed_charge', 'Builds a charge and persists the returned intent mapping.'),
      claim('app/services/order/prepare_payment_intent_service.rb', '924-953', 'create_unconfirmed_intent', 'Calls StripeDeferredPaymentIntent.create.'),
      claim('app/services/order/prepare_payment_intent_service.rb', '1372-1397', 'response mapping', 'Persists the intent identifier and builds client-secret responses.'),
    ], tags: ['orders', 'payments', 'stripe'],
  }),
  node({
    id: 'order-model', label: 'Order model', type: 'database', district: 'orders', order: 5,
    purpose: 'Aggregates purchases and charges and owns charge-receipt enqueueing.',
    evidence: [
      claim('app/models/order.rb', '3-11', 'Order associations', 'Associates the order with its purchaser, purchases, charges, and cart.'),
      claim('app/models/order.rb', '53-59', 'send_charge_receipts', 'Enqueues SendChargeReceiptJob for successful charges that need a receipt.'),
    ], tags: ['orders', 'activerecord'],
  }),
  node({
    id: 'stripe-boundary', label: 'Stripe boundary', type: 'external-system', district: 'orders', order: 6,
    purpose: 'Marks local Stripe SDK call sites used by this client-confirm path.',
    evidence: [
      claim('app/javascript/data/card_payment_method_data.ts', '283-312', 'createConfirmationToken', 'Browser code calls Stripe.js to create a ConfirmationToken.'),
      claim('app/javascript/data/order.ts', '689-704', 'confirmPayment', 'Browser code calls stripe.confirmPayment with redirect set to if_required.'),
      claim('app/business/payments/charging/implementations/stripe/stripe_deferred_payment_intent.rb', '35-43', 'StripeDeferredPaymentIntent.create', 'Server code calls Stripe::PaymentIntent.create.'),
    ],
    status: 'external',
    risks: ['Provider availability, credentials, account configuration, authorization, capture, and settlement are not established by this repository.'],
    boundaries: ['Conditional external boundary: only the checked-in Stripe SDK calls and local handling are confirmed.', 'A Go service in go_web/ can receive POST /stripe-webhook and queue the same Rails worker when its webhooks route group is enabled; the repository does not show whether it is.'],
    tags: ['external', 'stripe', 'conditional'],
  }),

  node({
    id: 'client-confirm-finalization', label: 'Finalization concern', type: 'service', district: 'settlement', order: 0,
    purpose: 'Connects controller finalization to the order finalizer and records local follow-up events.',
    evidence: [claim('app/controllers/concerns/client_confirmed_order_finalization.rb', '8-15', 'finalize_client_confirmed_order', 'Calls Order::FinalizeConfirmedChargeService and returns its responses.')],
    tags: ['settlement', 'controller-concern'],
  }),
  node({
    id: 'order-finalizer', label: 'Order finalizer', type: 'service', district: 'settlement', order: 1,
    purpose: 'Retrieves the confirmed intent, finalizes each purchase, sends receipts, and returns line-item results.',
    evidence: [claim('app/services/order/finalize_confirmed_charge_service.rb', '20-48', 'perform', 'Finalizes each order purchase and builds responses without re-confirming the intent.')],
    tags: ['settlement', 'orders'],
  }),
  node({
    id: 'purchase-finalizer', label: 'Purchase finalizer', type: 'service', district: 'settlement', order: 2,
    purpose: 'Serializes competing finalizers and applies the successful charge to one purchase.',
    evidence: [
      claim('app/services/purchase/finalize_confirmed_charge_service.rb', '16-38', 'perform', 'Locks the purchase and branches on confirmed intent state.'),
      claim('app/services/purchase/finalize_confirmed_charge_service.rb', '105-129', 'finalize_successful_charge', 'Saves confirmed charge data and calls handle_purchase_success, or defers to a settlement job when Stripe settlement data is missing.'),
    ], tags: ['settlement', 'purchase'],
  }),
  node({
    id: 'purchase-model', label: 'Purchase model', type: 'database', district: 'settlement', order: 3,
    purpose: 'Holds purchase state and the success-side relationships used for ledger and fulfillment.',
    evidence: [
      claim('app/models/purchase.rb', '123-197, 205-313', 'Purchase associations', 'Declares order, product, buyer, redirect, and balance relationships.'),
      claim('app/models/purchase.rb', '2127-2244', 'success side effects', 'Creates success-side records including balance and content access data.'),
      claim('app/models/purchase.rb', '2718-2730', 'update_balance_and_mark_successful!', 'Updates seller balance before marking the purchase successful.'),
    ], tags: ['purchase', 'activerecord'],
  }),

  node({
    id: 'library-controller', label: 'Library controller', type: 'controller', district: 'fulfillment', order: 0,
    purpose: 'Renders the signed-in buyer library and library item responses.',
    evidence: [claim('app/controllers/library_controller.rb', '17-59, 69-88', 'LibraryController', 'Uses LibraryPresenter to assemble library views.')],
    tags: ['library', 'buyer'],
  }),
  node({
    id: 'library-presenter', label: 'Library presenter', type: 'service', district: 'fulfillment', order: 1,
    purpose: 'Shapes successful purchases into buyer-library entries.',
    evidence: [claim('app/presenters/library_presenter.rb', '60-123, 154-214, 477-518', 'LibraryPresenter', 'Queries and presents purchases for library surfaces.')],
    tags: ['library', 'presenter'],
  }),
  node({
    id: 'url-redirects-controller', label: 'Content redirects', type: 'controller', district: 'fulfillment', order: 2,
    purpose: 'Authorizes content access and returns or redirects to signed file locations.',
    evidence: [
      claim('app/controllers/url_redirects_controller.rb', '54-181', 'download actions', 'Uses UrlRedirect and signed download helpers for content access.'),
      claim('app/controllers/url_redirects_controller.rb', '548-649', 'lookup', 'Loads and validates the UrlRedirect record for the request.'),
    ],
    boundaries: ['A Go service in go_web/ can serve GET /d/:id, the download page, when its downloads route group is enabled (go_web/internal/downloads/handler.go:52-56); the repository does not show whether it is. The Rails action remains in source.'],
    tags: ['fulfillment', 'download'],
  }),
  node({
    id: 'url-redirect-model', label: 'Content access token', type: 'database', district: 'fulfillment', order: 3,
    purpose: 'Represents purchase-scoped content access and chooses a local signed-location path.',
    evidence: [
      claim('app/models/url_redirect.rb', '3-18, 61-81', 'UrlRedirect', 'Associates the access record with a purchase and product.'),
      claim('app/models/url_redirect.rb', '260-293', 'redirect_or_s3_location', 'Selects a redirect or signed file location for content delivery.'),
    ], tags: ['fulfillment', 'download'],
  }),
  node({
    id: 'receipt-job', label: 'Receipt job', type: 'service', district: 'fulfillment', order: 4,
    purpose: 'Queues and sends charge receipts after successful purchases settle.',
    evidence: [claim('app/sidekiq/send_charge_receipt_job.rb', '30-82', 'SendChargeReceiptJob#perform', 'Waits for settled purchases and invokes CustomerMailer.receipt.')],
    tags: ['sidekiq', 'email'],
  }),
  node({
    id: 'customer-mailer', label: 'Customer mailer', type: 'service', district: 'fulfillment', order: 5,
    purpose: 'Builds and sends the purchase receipt email.',
    evidence: [claim('app/mailers/customer_mailer.rb', '64-90', 'receipt', 'Builds receipt presentation and mail delivery parameters.')],
    tags: ['mailer', 'receipt'],
  }),
  node({
    id: 's3-boundary', label: 'S3 file boundary', type: 'external-system', district: 'fulfillment', order: 6,
    purpose: 'Marks local call sites that request signed object-storage download locations.',
    evidence: [
      claim('app/models/url_redirect.rb', '260-293', 'redirect_or_s3_location', 'Requests a signed download URL from a stored S3 key and filename.'),
      claim('app/controllers/url_redirects_controller.rb', '70-84, 127-148', 'download URL actions', 'Returns locally generated signed file URLs to the buyer-facing response.'),
    ],
    status: 'external',
    risks: ['Bucket contents, credentials, provider availability, and a successful download are not established by this repository.'],
    boundaries: ['Conditional external boundary: only local signed-URL call sites are confirmed.'],
    tags: ['external', 's3', 'conditional'],
  }),

  node({
    id: 'balance-transaction', label: 'Balance transaction', type: 'database', district: 'ledger', order: 0,
    purpose: 'Records a ledger movement and applies it to a seller balance.',
    evidence: [claim('app/models/balance_transaction.rb', '178-230', 'create! / update_balance!', 'Creates the ledger row and updates its selected Balance under lock.')],
    tags: ['ledger', 'activerecord'],
  }),
  node({
    id: 'balance-model', label: 'Seller balance', type: 'database', district: 'ledger', order: 1,
    purpose: 'Represents held seller funds and their payout lifecycle state.',
    evidence: [claim('app/models/balance.rb', '7-22, 56-90', 'Balance', 'Associates transactions and payments and defines the balance state machine.')],
    tags: ['ledger', 'payout'],
  }),
  node({
    id: 'payment-model', label: 'Payout payment', type: 'database', district: 'ledger', order: 2,
    purpose: 'Groups balances into a payout record and updates balance state as payment state changes.',
    evidence: [
      claim('app/models/payment.rb', '89-111', 'Payment transitions', 'Hooks payment transitions to balance state updates.'),
      claim('app/models/payment.rb', '489-494', 'mark_balances_as_paid / unpaid', 'Transitions associated balances after payout state changes.'),
    ], tags: ['ledger', 'payout'],
  }),
  node({
    id: 'payout-users-service', label: 'Payout users service', type: 'service', district: 'ledger', order: 3,
    purpose: 'Creates payout records for selected sellers and hands them to a configured payout processor.',
    evidence: [claim('app/services/payout_users_service.rb', '14-73', 'PayoutUsersService', 'Calls Payouts.create_payments and dispatches each eligible payment record.')],
    tags: ['payout', 'service'],
  }),
  node({
    id: 'payouts-domain', label: 'Payout builder', type: 'service', district: 'ledger', order: 4,
    purpose: 'Selects payable balances and persists one or more Payments that group them.',
    evidence: [claim('app/business/payments/payouts/payouts.rb', '445-603', 'Payouts.create_payments', 'Marks balances processing, persists one Payment per payout group, and prepares each amount.')],
    boundaries: ['A chargeback-rate payout reserve can reduce the payable amount, and a negative ledger group holds the payout (app/business/payments/payouts/payouts.rb:73-74, 605-613).'],
    tags: ['payout', 'ledger'],
  }),
];

function edge(id, from, to, type, label, evidence, verification = 'source-confirmed') {
  return {
    id, from, to, type, label,
    confidence: verification === 'source-confirmed' ? 'high' : 'conditional',
    verification,
    evidence,
    truth: { ...SOURCE_TRUTH },
  };
}

const edges = [
  edge('e01-checkout-route', 'routes', 'checkout-controller', 'request', 'GET /checkout dispatches show', ['config/routes.rb:948', 'app/controllers/checkout_controller.rb:9-32']),
  edge('e02-checkout-page', 'checkout-controller', 'checkout-page', 'response', 'renders Checkout/Show through Inertia', ['app/controllers/checkout_controller.rb:17-32', 'app/javascript/entrypoints/inertia.js:142-165']),
  edge('e03-checkout-shell', 'checkout-page', 'checkout-shell', 'contains', 'mounts the checkout form shell', ['app/javascript/pages/Checkout/Show.tsx:1169-1199', 'app/javascript/components/Checkout/index.tsx:35']),
  edge('e04-payment-form', 'checkout-shell', 'payment-form', 'contains', 'renders PaymentForm', ['app/javascript/components/Checkout/index.tsx:867']),
  edge('e05-token-helper', 'payment-form', 'payment-tokenizer', 'request', 'requests a Payment Element token', ['app/javascript/components/Checkout/PaymentForm.tsx:925-948']),
  edge('e06-confirmation-token', 'payment-tokenizer', 'stripe-boundary', 'request', 'calls Stripe createConfirmationToken', ['app/javascript/data/card_payment_method_data.ts:283-312'], 'conditional-external'),
  edge('e07-token-to-order-client', 'stripe-boundary', 'order-client', 'response', 'ConfirmationToken reaches the client-confirm order path', [
    'app/javascript/data/card_payment_method_data.ts:309-312',
    'app/javascript/components/Checkout/PaymentForm.tsx:965-1022',
    'app/javascript/pages/Checkout/Show.tsx:702-710',
    'app/javascript/data/order.ts:652-665',
  ], 'conditional-external'),
  edge('e08-prepare-order-request', 'order-client', 'orders-controller', 'request', 'POSTs /orders/prepare', ['app/javascript/data/order.ts:839-846', 'config/routes.rb:895-904', 'app/controllers/orders_controller.rb:58-87']),
  edge('e09-create-order', 'orders-controller', 'order-create-service', 'request', 'delegates order construction', ['app/controllers/orders_controller.rb:77-81']),
  edge('e10-create-purchase', 'order-create-service', 'purchase-create-service', 'request', 'delegates one line-item purchase', ['app/services/order/create_service.rb:109-157']),
  edge('e11-persist-purchase', 'purchase-create-service', 'purchase-model', 'write', 'builds and persists the purchase', ['app/services/purchase/create_service.rb:48-56', 'app/services/purchase/create_service.rb:567-635']),
  edge('e12-attach-order', 'purchase-model', 'order-model', 'write', 'attaches the persisted purchase to its order', ['app/services/order/create_service.rb:190-198', 'app/models/order.rb:6-10']),
  edge('e13-prepare-intent', 'order-model', 'prepare-payment-intent', 'request', 'feeds the prepared order into PaymentIntent preparation', ['app/controllers/orders_controller.rb:77-87', 'app/services/order/prepare_payment_intent_service.rb:485-522']),
  edge('e14-create-intent', 'prepare-payment-intent', 'stripe-boundary', 'request', 'creates an unconfirmed deferred PaymentIntent', ['app/services/order/prepare_payment_intent_service.rb:924-953', 'app/business/payments/charging/implementations/stripe/stripe_deferred_payment_intent.rb:35-43'], 'conditional-external'),
  edge('e15-confirm-intent', 'stripe-boundary', 'order-client', 'response', 'client secret drives inline stripe.confirmPayment', ['app/services/order/prepare_payment_intent_service.rb:1387-1397', 'app/javascript/data/order.ts:689-704'], 'conditional-external'),
  edge('e16-finalize-request', 'order-client', 'orders-controller', 'request', 'POSTs the idempotent finalize action', ['app/javascript/data/order.ts:730-734', 'app/javascript/data/order.ts:849-861', 'config/routes.rb:895-900']),
  edge('e17-finalize-order', 'orders-controller', 'order-finalizer', 'request', 'delegates through the finalization concern', ['app/controllers/orders_controller.rb:97-107', 'app/controllers/concerns/client_confirmed_order_finalization.rb:8-15']),
  edge('e18-finalize-purchase', 'order-finalizer', 'purchase-finalizer', 'request', 'finalizes each order purchase', ['app/services/order/finalize_confirmed_charge_service.rb:29-39']),
  edge('e19-mark-purchase-success', 'purchase-finalizer', 'purchase-model', 'write', 'records confirmed charge data and success', ['app/services/purchase/finalize_confirmed_charge_service.rb:105-129', 'app/services/purchase/base_service.rb:8-35']),
  edge('e20-render-success', 'purchase-model', 'checkout-page', 'response', 'successful line-item result reaches receipt UI', [
    'app/services/order/finalize_confirmed_charge_service.rb:67-75',
    'app/controllers/orders_controller.rb:102-107',
    'app/javascript/data/order.ts:736-748',
    'app/javascript/pages/Checkout/Show.tsx:1177-1185',
  ]),

  edge('e21-controller-seller', 'application-controller', 'current-seller', 'contains', 'includes current-seller context', ['app/controllers/application_controller.rb:16']),
  edge('e22-current-user', 'current-seller', 'user-model', 'read', 'resolves the seller User record', ['app/controllers/concerns/current_seller.rb:12-16', 'app/controllers/concerns/current_seller.rb:47-65']),
  edge('e23-editor-save', 'product-edit-page', 'product-edit-client', 'request', 'invokes saveProduct', ['app/javascript/components/server-components/ProductEditPage.tsx:6-23', 'app/javascript/components/server-components/ProductEditPage.tsx:669-698']),
  edge('e24-save-request', 'product-edit-client', 'links-controller', 'request', 'POSTs the product update route', ['app/javascript/data/product_edit.ts:677-746', 'config/routes.rb:1005-1014']),
  edge('e25-save-contract', 'links-controller', 'product-save-contract', 'request', 'runs the update contract', ['app/controllers/links_controller.rb:470-518', 'app/controllers/links_controller.rb:1102', 'app/services/product/save_contract.rb:88-99']),
  edge('e26-publish-product', 'links-controller', 'product-model', 'write', 'calls publish! on the product', ['app/controllers/links_controller.rb:829-851', 'app/models/link.rb:570-652']),
  edge('e27-searchable-concern', 'product-model', 'product-searchable', 'contains', 'includes Product::Searchable', ['app/models/link.rb:52-58']),
  edge('e28-index-product', 'product-searchable', 'product-indexing-service', 'event', 'invokes the product indexer', ['app/modules/product/searchable.rb:525-542', 'app/services/product_indexing_service.rb:3-20']),
  edge('e29-profile-presentation', 'users-controller', 'profile-presenter', 'request', 'builds public profile props', ['app/controllers/users_controller.rb:29-39', 'app/presenters/profile_presenter.rb:13-39']),
  edge('e30-discover-search', 'discover-controller', 'search-products', 'request', 'executes the shared product search', ['app/controllers/discover_controller.rb:51', 'app/controllers/concerns/search_products.rb:8-20']),
  edge('e31-search-product-model', 'search-products', 'product-model', 'read', 'queries Link.search', ['app/controllers/concerns/search_products.rb:8-20']),
  edge('e32-cart-lines', 'cart-model', 'cart-product-model', 'contains', 'owns cart-product rows', ['app/models/cart.rb:38-44', 'app/models/cart_product.rb:23-25']),
  edge('e33-purchase-ledger', 'purchase-model', 'balance-transaction', 'write', 'books the success-side ledger movement', ['app/models/purchase.rb:2127-2163', 'app/models/purchase.rb:2718-2730', 'app/models/balance_transaction.rb:178-206']),
  edge('e34-purchase-access', 'purchase-model', 'url-redirect-model', 'write', 'creates purchase-scoped content access', ['app/models/purchase.rb:264-266', 'app/models/purchase.rb:2224-2244']),
  edge('e35-load-access', 'url-redirects-controller', 'url-redirect-model', 'read', 'loads and validates the access record', ['app/controllers/url_redirects_controller.rb:548-634']),
  edge('e36-sign-download', 'url-redirect-model', 's3-boundary', 'request', 'requests a signed object download URL', ['app/models/url_redirect.rb:260-293', 'app/controllers/url_redirects_controller.rb:127-148'], 'conditional-external'),
  edge('e37-enqueue-receipt', 'order-model', 'receipt-job', 'event', 'enqueues charge receipt delivery', ['app/models/order.rb:53-59']),
  edge('e38-send-receipt', 'receipt-job', 'customer-mailer', 'request', 'delivers the receipt mailer', ['app/sidekiq/send_charge_receipt_job.rb:71-82', 'app/mailers/customer_mailer.rb:64-90']),
  edge('e39-create-payout', 'payout-users-service', 'payment-model', 'write', 'creates Payments through Payouts.create_payments', ['app/services/payout_users_service.rb:39-65', 'app/business/payments/payouts/payouts.rb:445-603']),
  edge('e40-payment-balances', 'payment-model', 'balance-model', 'write', 'moves associated balances with payment state', ['app/models/payment.rb:89-111', 'app/models/payment.rb:489-494', 'app/models/balance.rb:20-22']),
];

const purchaseFlow = {
  id: 'gumroad-stripe-client-confirm',
  label: 'Paid digital product · Stripe client-confirm',
  status: 'active-code',
  description: 'A pinned source path from checkout routing through Stripe Payment Element client confirmation, local purchase finalization, and the buyer result view.',
  nodeIds: [
    'routes', 'checkout-controller', 'checkout-page', 'checkout-shell', 'payment-form',
    'payment-tokenizer', 'stripe-boundary', 'order-client', 'orders-controller',
    'order-create-service', 'purchase-create-service', 'purchase-model', 'order-model',
    'prepare-payment-intent', 'stripe-boundary', 'order-client', 'orders-controller',
    'order-finalizer', 'purchase-finalizer', 'purchase-model', 'checkout-page',
  ],
  edgeIds: [
    'e01-checkout-route', 'e02-checkout-page', 'e03-checkout-shell', 'e04-payment-form',
    'e05-token-helper', 'e06-confirmation-token', 'e07-token-to-order-client',
    'e08-prepare-order-request', 'e09-create-order', 'e10-create-purchase',
    'e11-persist-purchase', 'e12-attach-order', 'e13-prepare-intent',
    'e14-create-intent', 'e15-confirm-intent', 'e16-finalize-request',
    'e17-finalize-order', 'e18-finalize-purchase', 'e19-mark-purchase-success',
    'e20-render-success',
  ],
  cautions: [
    'Scope is one paid digital product from one seller on the Stripe Payment Element client-confirm lane.',
    'The happy path assumes inline confirmation and synchronous finalization; redirects, SCA, delayed methods, and webhook recovery are outside this walk.',
    'Free, PayPal, recurring, preorder, physical, rental, gift, installment, and multi-seller branches are not generalized from this path.',
    'Stripe calls are conditional external boundaries. Source presence does not prove credentials, provider success, capture, settlement, or deployment.',
  ],
};

const purchaseJourney = {
  id: 'paid-digital-product-purchase',
  label: 'Buy one paid digital product',
  shortLabel: 'Buying a digital product',
  status: 'active-code',
  flowId: purchaseFlow.id,
  description: 'Follow the checked-in Stripe client-confirm happy path for one seller and one paid digital product, from GET /checkout to the local result view.',
  mapHeading: 'Paid digital product purchase',
  mapSummary: 'One source-backed Stripe Payment Element client-confirm path. Provider behavior, runtime flags, deployment, and data remain unverified.',
  entryBoundary: 'Begins at GET /checkout with a cart already available to the application. Product discovery, add-to-cart, authentication, and runtime eligibility flags are outside scope.',
  completionBoundary: 'Ends when the synchronous finalize response is rendered as Receipt or TemporaryLibrary. Email delivery, object download, Stripe settlement, redirects/SCA, delayed methods, and webhook recovery are outside this happy path.',
  steps: [
    {
      id: 'load-checkout', title: 'Load checkout', startHop: 0, endHop: 2, stageNodeId: 'checkout-controller',
      description: 'Rails dispatches GET /checkout; CheckoutController renders the Checkout/Show Inertia page with server-built props.',
      boundary: 'A route and render call are confirmed. A running Rails process, session, cart contents, and deployed page are not.',
    },
    {
      id: 'mount-payment-form', title: 'Mount the payment form', startHop: 3, endHop: 4, stageNodeId: 'payment-form',
      description: 'The checkout shell mounts PaymentForm, where the eligible Payment Element client-confirm branch is selected.',
      boundary: 'Eligibility is conditional in runtime state; this walkthrough follows only the checked-in client-confirm branch.',
    },
    {
      id: 'mint-token', title: 'Mint a ConfirmationToken', startHop: 5, endHop: 6, stageNodeId: 'payment-tokenizer',
      description: 'The token helper submits Elements and calls Stripe.js createConfirmationToken.',
      boundary: 'The Stripe call site is confirmed; provider reachability and token creation are external and unverified.',
    },
    {
      id: 'enter-client-confirm', title: 'Enter client-confirm checkout', startHop: 7, endHop: 7, stageNodeId: 'order-client',
      description: 'PaymentForm stores the tokenized method; Checkout/Show calls startClientConfirmOrderCreation with its token identifier.',
      boundary: 'This excludes saved-card and server-confirm branches.',
    },
    {
      id: 'prepare-order', title: 'Prepare the order', startHop: 8, endHop: 9, stageNodeId: 'orders-controller',
      description: 'The browser POSTs /orders/prepare, and OrdersController calls Order::CreateService.',
      boundary: 'The request path is confirmed; authorization, fraud checks, and every failure branch are not expanded here.',
    },
    {
      id: 'create-purchase', title: 'Create the purchase row', startHop: 10, endHop: 12, stageNodeId: 'purchase-create-service',
      description: 'Purchase::CreateService builds and persists the purchase; Order::CreateService attaches it to the order.',
      boundary: 'This follows one persisted paid line and does not generalize subscriptions, gifts, preorders, or mixed carts.',
    },
    {
      id: 'prepare-intent', title: 'Prepare the PaymentIntent', startHop: 13, endHop: 14, stageNodeId: 'prepare-payment-intent',
      description: 'The service builds a charge, requests an unconfirmed deferred PaymentIntent, stores its mapping, and returns a client secret.',
      boundary: 'Local orchestration is confirmed; the Stripe create result is conditional external state.',
    },
    {
      id: 'confirm-in-browser', title: 'Confirm in Stripe.js', startHop: 15, endHop: 15, stageNodeId: 'order-client',
      description: 'The browser calls stripe.confirmPayment with the client secret and ConfirmationToken, using redirect: if_required.',
      boundary: 'This assumes the inline, immediately successful result; redirects, SCA, Pix, and processing states are excluded.',
    },
    {
      id: 'post-finalize', title: 'Post finalize', startHop: 16, endHop: 16, stageNodeId: 'orders-controller',
      description: 'After confirmation, the browser POSTs the idempotent order finalize endpoint.',
      boundary: 'A failed or dropped finalize is represented by other recovery code and is outside this happy path.',
    },
    {
      id: 'settle-purchase', title: 'Finalize the captured charge', startHop: 17, endHop: 18, stageNodeId: 'order-finalizer',
      description: 'The order finalizer retrieves the intent and delegates each purchase to the lock-protected purchase finalizer without re-confirming it.',
      boundary: 'This follows charge_intent.succeeded? with settlement data present; processing, awaiting-customer-action, deferred-settlement, late-success restore, and failure branches are excluded.',
    },
    {
      id: 'mark-success', title: 'Book and mark success', startHop: 19, endHop: 19, stageNodeId: 'purchase-model',
      description: 'The purchase success handler updates seller balance state and marks the purchase successful.',
      boundary: 'Source-defined writes are confirmed; actual database rows and financial settlement are not.',
    },
    {
      id: 'show-result', title: 'Show the buyer result', startHop: 20, endHop: 20, stageNodeId: 'checkout-page',
      description: 'The mapped successful line item reaches Checkout/Show, which renders Receipt or TemporaryLibrary.',
      boundary: 'The walkthrough stops at local UI selection; email delivery, library persistence, file retrieval, and provider settlement are separate paths.',
    },
  ],
};

export const ATLAS_DATA = Object.freeze({
  meta: {
    generatedFor: 'antiwork/gumroad',
    repositoryUrl: 'https://github.com/antiwork/gumroad',
    repositoryRevision: REVISION,
    title: 'Gumroad Platform Atlas',
    storageNamespace: 'platform-atlas-gumroad',
    defaultFlowId: purchaseFlow.id,
    defaultJourneyId: purchaseJourney.id,
    defaultNodeId: purchaseFlow.nodeIds[0],
    journeyKicker: 'Purchase path',
    displayName: 'Gumroad',
    updated: '2026-11-06T11:10:47+05:30',
    nodeIcons: {
      'routes': 'path',
      'application-controller': 'sliders',
      'inertia-entry': 'play',
      'current-seller': 'user-circle',
      'user-model': 'user',
      'links-controller': 'tag',
      'product-model': 'tag',
      'product-edit-page': 'pencil-simple',
      'product-edit-client': 'cursor-click',
      'product-save-contract': 'shield',
      'users-controller': 'storefront',
      'profile-presenter': 'app-window',
      'product-presenter': 'image',
      'discover-controller': 'compass',
      'search-products': 'magnifying-glass',
      'product-searchable': 'list-magnifying-glass',
      'product-indexing-service': 'funnel',
      'cart-model': 'shopping-cart',
      'cart-product-model': 'basket',
      'checkout-controller': 'lightning',
      'checkout-page': 'layout',
      'checkout-shell': 'browsers',
      'payment-form': 'credit-card',
      'payment-tokenizer': 'lock',
      'orders-controller': 'sliders',
      'order-client': 'cursor-click',
      'order-create-service': 'receipt',
      'purchase-create-service': 'invoice',
      'prepare-payment-intent': 'handshake',
      'order-model': 'receipt',
      'stripe-boundary': 'cloud',
      'client-confirm-finalization': 'check-circle',
      'order-finalizer': 'check-circle',
      'purchase-finalizer': 'check-square',
      'purchase-model': 'invoice',
      'library-controller': 'book-open-text',
      'library-presenter': 'books',
      'url-redirects-controller': 'link',
      'url-redirect-model': 'lock',
      'receipt-job': 'queue',
      'customer-mailer': 'envelope',
      's3-boundary': 'cloud',
      'balance-transaction': 'coins',
      'balance-model': 'bank',
      'payment-model': 'money',
      'payout-users-service': 'users',
      'payouts-domain': 'wallet',
    },
  },
  truthSemantics: [
    { label: 'Repository truth', meaning: `Paths, symbols, line ranges, and local relationships are curated from antiwork/gumroad at ${REVISION}.` },
    { label: 'Runtime truth', meaning: 'Checked-in code does not prove feature flags, request context, credentials, jobs, databases, or provider calls are active.' },
    { label: 'Deployment truth', meaning: 'No build, environment, service, database, or deployed revision was inspected; deployment remains unverified.' },
    { label: 'External boundaries', meaning: 'Stripe and S3 are conditional external boundaries. Only local call sites and handling are confirmed.' },
  ],
  districts,
  nodes,
  edges,
  flows: [purchaseFlow],
  journeys: [purchaseJourney],
});
