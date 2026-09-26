/*
 * Headless check for the map front-end — no browser required.
 *
 * Runs app.js with a stubbed DOM and a stubbed MapLibre, captures the GeoJSON
 * source and every style layer it would add, then:
 *
 *   1. validates the layers with the same style spec MapLibre GL JS uses
 *      (Style#addLayer *silently skips* a layer whose expression is invalid,
 *      which is exactly the class of bug this guards against);
 *   2. evaluates the key expressions for a single city, a real cluster and an
 *      all-blank cluster.
 *
 * Run with: npm run check:web
 */
const assert = require('node:assert');
const fs = require('node:fs');
const spec = require('@maplibre/maplibre-gl-style-spec');

const captured = { sources: {}, layers: [], handlers: {} };

class FakeMap {
  constructor(options) { this.options = options; FakeMap.latest = this; }
  addControl() {}
  setStyle() {}
  on(event, a, b) {
    const key = typeof a === 'function' ? event : `${event}:${a}`;
    const handler = typeof a === 'function' ? a : b;
    (captured.handlers[key] = captured.handlers[key] || []).push(handler);
  }
  getSource() { return { setData() {}, getClusterExpansionZoom() { return Promise.resolve(6); } }; }
  addSource(id, def) { captured.sources[id] = def; }
  addLayer(def) { captured.layers.push(def); }
  getCanvas() { return { style: {} }; }
  jumpTo() {}
  fitBounds() {}
  easeTo() {}
}
const maplibregl = {
  Map: FakeMap,
  NavigationControl: class {},
  AttributionControl: class {},
  LngLatBounds: class { extend() { return this; } },
  Popup: class { on() {} remove() {} setLngLat() { return this; } setHTML() { return this; } addTo() { return this; } },
};

function fakeElement() {
  return {
    style: {}, dataset: {}, textContent: '', value: '0', children: [],
    append(...kids) { this.children.push(...kids); },
    addEventListener() {}, setAttribute() {}, querySelector() { return null; },
  };
}
const documentStub = {
  documentElement: { style: { setProperty() {} } },
  getElementById: () => fakeElement(),
  querySelector: () => fakeElement(),
  querySelectorAll: () => [fakeElement(), fakeElement(), fakeElement()],
  createElement: () => fakeElement(),
};
class ResizeObserver { observe() {} }

// Minimal city data: Alpha is mild (13 °C in September), Beta is warmer.
const twelve = (fn) => Array.from({ length: 12 }, (_, i) => fn(i));
const MOCK_CITY_DATA = { cities: [
  { name: 'Alpha', country: 'X', lat: 50, lon: 10, months: {
    meanDailyMax: twelve(i => i + 10), dailyMean: twelve(i => i + 5), meanDailyMin: twelve(i => i),
    meanMax: twelve(() => null), meanMin: twelve(() => null), recordHigh: twelve(() => null), recordLow: twelve(() => null) } },
  { name: 'Beta', country: 'Y', lat: 51, lon: 12, months: {
    meanDailyMax: twelve(() => 20), dailyMean: twelve(() => 10), meanDailyMin: twelve(() => 0),
    meanMax: twelve(() => null), meanMin: twelve(() => null), recordHigh: twelve(() => null), recordLow: twelve(() => null) } },
] };

// localStorage/fetch are shadowed so applyMapStyle never touches the network.
const localStorageStub = { getItem: () => null, setItem() {} };
const fetchStub = async () => ({ ok: true, status: 200, json: async () => ({ version: 8, sources: {}, layers: [] }) });

new Function('document', 'maplibregl', 'ResizeObserver', 'MOCK_CITY_DATA', 'localStorage', 'fetch',
  fs.readFileSync('app.js', 'utf8'),
)(documentStub, maplibregl, ResizeObserver, MOCK_CITY_DATA, localStorageStub, fetchStub);
captured.handlers.load.forEach(handler => handler());

/* 1. Style validation ------------------------------------------------------- */
const style = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: captured.sources,
  layers: captured.layers,
};
const validationErrors = spec.validateStyleMin(style);
assert.deepStrictEqual(
  validationErrors.map(error => error.message),
  [],
  'style layers must validate against MapLibre\'s style spec (an invalid layer is skipped at runtime)',
);

assert.deepStrictEqual(
  captured.layers.map(layer => layer.id),
  ['city-badges', 'city-cluster-badges', 'city-cluster-labels', 'city-badge-labels'],
  'expected single circle + cluster circle + cluster label + single label layers',
);
assert.strictEqual(captured.sources.cities.cluster, true, 'source must cluster');
assert.deepStrictEqual(captured.sources.cities.clusterProperties, {
  sumCelsius: ['+', ['get', 'sumCelsius']],
  dataCount: ['+', ['get', 'dataCount']],
});

/* 2. Expression evaluation -------------------------------------------------- */
const FEATURES = {
  single: { type: 'Feature', properties: { index: 0, label: '13°C', sumCelsius: 13, dataCount: 1 } },
  cluster: { type: 'Feature', properties: { point_count: 3, cluster_id: 1, sumCelsius: 39, dataCount: 3 } },
  blank: { type: 'Feature', properties: { point_count: 2, cluster_id: 2, sumCelsius: 0, dataCount: 0 } },
};

// Property specs straight from the style spec, exactly how MapLibre compiles
// them at runtime (createPropertyExpression + property spec, not a bare type).
const PROPERTY_SPECS = {
  'circle-color': spec.latest.paint_circle['circle-color'],
  'circle-radius': spec.latest.paint_circle['circle-radius'],
  'text-field': spec.latest.layout_symbol['text-field'],
};

function evaluate(layer, section, name, key) {
  const expression = layer[section][name];
  const parsed = spec.createPropertyExpression(expression, PROPERTY_SPECS[name]);
  assert.strictEqual(parsed.result, 'success', `${key} must parse: ${JSON.stringify(parsed.value)}`);
  return Object.fromEntries(Object.entries(FEATURES).map(([caseName, feature]) => {
    const value = parsed.value.evaluateWithoutErrorHandling({ zoom: 4.5 }, feature);
    return [caseName, value && typeof value.toString === 'function' ? value.toString() : value];
  }));
}

const layers = Object.fromEntries(captured.layers.map(layer => [layer.id, layer]));

const circleColors = evaluate(layers['city-badges'], 'paint', 'circle-color', 'circle-color');
assert.strictEqual(circleColors.single, 'rgba(255,196,137,1)', 'cold-ish single colour');
assert.strictEqual(circleColors.blank, 'rgba(201,206,214,1)', 'a blank single is grey');

const clusterColors = evaluate(layers['city-cluster-badges'], 'paint', 'circle-color', 'cluster circle-color');
assert.strictEqual(clusterColors.cluster, 'rgba(255,196,137,1)', 'cluster average uses the same ramp');
assert.strictEqual(clusterColors.blank, 'rgba(201,206,214,1)', 'all-blank cluster is grey');

const radii = evaluate(layers['city-badges'], 'paint', 'circle-radius', 'circle-radius');
assert.ok(Math.abs(radii.single - 15.54) < 0.01, `single radius at zoom 4.5, got ${radii.single}`);

const clusterRadii = evaluate(layers['city-cluster-badges'], 'paint', 'circle-radius', 'cluster circle-radius');
assert.ok(Math.abs(clusterRadii.cluster - 18.54) < 0.01, `cluster radius at zoom 4.5, got ${clusterRadii.cluster}`);

const singleText = evaluate(layers['city-badge-labels'], 'layout', 'text-field', 'single text-field');
assert.strictEqual(singleText.single, '13°C');

const clusterText = evaluate(layers['city-cluster-labels'], 'layout', 'text-field', 'cluster text-field');
assert.strictEqual(clusterText.cluster, '13°C\n(3)', 'cluster shows the average over the member count');
assert.strictEqual(clusterText.blank, '—', 'all-blank cluster shows a dash');

/* 3. Interaction wiring ----------------------------------------------------- */
for (const layerId of ['city-badges', 'city-cluster-badges', 'city-cluster-labels', 'city-badge-labels']) {
  assert.ok((captured.handlers[`click:${layerId}`] || []).length > 0, `click handler wired for ${layerId}`);
}

console.log('check-web OK:', captured.layers.length, 'layers, no validation errors, expressions evaluate as expected');
