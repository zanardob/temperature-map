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

const captured = { sources: {}, layers: [], handlers: {}, popups: [] };

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
  Popup: class {
    constructor() { captured.popups.push(this); }
    on() {} remove() {} setLngLat() { return this; } setHTML(html) { this.html = html; return this; } addTo() { return this; }
  },
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

// Minimal city data: Alpha is mild (13 °C in September), Beta is warmer. Alpha
// carries a section anchor (deep-linked source), Beta does not.
const twelve = (fn) => Array.from({ length: 12 }, (_, i) => fn(i));
const MOCK_CITY_DATA = { cities: [
  { name: 'Alpha', country: 'X', lat: 50, lon: 10,
    wikipedia: 'https://en.wikipedia.org/wiki/Alpha', climateAnchor: 'Climate_data', months: {
    meanDailyMax: twelve(i => i + 10), dailyMean: twelve(i => i + 5), meanDailyMin: twelve(i => i),
    meanMax: twelve(() => null), meanMin: twelve(() => null), recordHigh: twelve(() => null), recordLow: twelve(() => null) } },
  { name: 'Beta', country: 'Y', lat: 51, lon: 12,
    wikipedia: 'https://en.wikipedia.org/wiki/Beta', months: {
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
  [
    'reference-equator-line', 'reference-tropic-lines', 'reference-parallel-labels',
    'city-badges', 'city-cluster-badges', 'city-cluster-labels', 'city-badge-labels',
  ],
  'expected reference parallels under single circle + cluster circle + cluster label + single label layers',
);

/* 1b. Reference parallels --------------------------------------------------- */
const parallels = captured.sources['reference-parallels'];
assert.ok(parallels, 'reference parallels source added');
assert.deepStrictEqual(
  parallels.data.features.map(feature => [feature.properties.name, feature.properties.latitude, feature.properties.kind]),
  [
    ['EQUATOR', 0, 'equator'],
    ['TROPIC OF CANCER', 23.4367, 'tropic'],
    ['TROPIC OF CAPRICORN', -23.4367, 'tropic'],
  ],
  'equator and both tropics at the current obliquity',
);
for (const feature of parallels.data.features) {
  assert.deepStrictEqual(
    feature.geometry.coordinates,
    [[-180, feature.properties.latitude], [180, feature.properties.latitude]],
    'each parallel spans the full wrap so it repeats on every world copy',
  );
}
const equatorLine = captured.layers.find(layer => layer.id === 'reference-equator-line');
assert.strictEqual(equatorLine.type, 'line');
assert.deepStrictEqual(equatorLine.filter, ['==', ['get', 'kind'], 'equator']);
assert.ok(!('line-dasharray' in equatorLine.paint), 'the equator is a continuous line');
assert.ok(equatorLine.paint['line-opacity'] < 0.6, 'the equator is faded');
const tropicLines = captured.layers.find(layer => layer.id === 'reference-tropic-lines');
assert.deepStrictEqual(tropicLines.filter, ['==', ['get', 'kind'], 'tropic']);
assert.deepStrictEqual(tropicLines.paint['line-dasharray'], [1.5, 1.5], 'the tropics are dashed');
assert.ok(tropicLines.paint['line-opacity'] < equatorLine.paint['line-opacity'], 'the tropics are fainter than the equator');
const referenceLabels = captured.layers.find(layer => layer.id === 'reference-parallel-labels');
assert.strictEqual(referenceLabels.layout['symbol-placement'], 'line');
assert.strictEqual(
  referenceLabels.layout['text-ignore-placement'], true,
  'reference labels never steal placement from the badge labels added after them',
);

assert.strictEqual(captured.sources.cities.cluster, true, 'source must cluster');
assert.strictEqual(captured.sources.cities.clusterRadius, 46, 'cluster radius matches the larger badges');
assert.deepStrictEqual(captured.sources.cities.clusterProperties, {
  sumCelsius: ['+', ['get', 'sumCelsius']],
  dataCount: ['+', ['get', 'dataCount']],
});

/* 2. Expression evaluation -------------------------------------------------- */
const FEATURES = {
  single: { type: 'Feature', properties: { index: 0, labelNumber: '13', labelUnit: '°C', sumCelsius: 13, dataCount: 1 } },
  cluster: { type: 'Feature', properties: { point_count: 3, cluster_id: 1, sumCelsius: 39, dataCount: 3 } },
  hot: { type: 'Feature', properties: { point_count: 2, cluster_id: 3, sumCelsius: 80, dataCount: 2 } },
  cold: { type: 'Feature', properties: { point_count: 2, cluster_id: 4, sumCelsius: -60, dataCount: 2 } },
  blank: { type: 'Feature', properties: { point_count: 2, cluster_id: 2, sumCelsius: 0, dataCount: 0 } },
};

// Property specs straight from the style spec, exactly how MapLibre compiles
// them at runtime (createPropertyExpression + property spec, not a bare type).
const PROPERTY_SPECS = {
  'circle-color': spec.latest.paint_circle['circle-color'],
  'circle-radius': spec.latest.paint_circle['circle-radius'],
  'circle-stroke-width': spec.latest.paint_circle['circle-stroke-width'],
  'text-color': spec.latest.paint_symbol['text-color'],
  'text-halo-color': spec.latest.paint_symbol['text-halo-color'],
  'text-field': spec.latest.layout_symbol['text-field'],
  'text-size': spec.latest.layout_symbol['text-size'],
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
assert.ok(Math.abs(radii.single - 21.96) < 0.01, `single radius at zoom 4.5, got ${radii.single}`);

const clusterRadii = evaluate(layers['city-cluster-badges'], 'paint', 'circle-radius', 'cluster circle-radius');
assert.ok(Math.abs(clusterRadii.cluster - 24.96) < 0.01, `cluster radius at zoom 4.5, got ${clusterRadii.cluster}`);

// Bold face + bigger text, so the colour ring around it stays visible.
for (const layerId of ['city-badge-labels', 'city-cluster-labels']) {
  assert.deepStrictEqual(layers[layerId].layout['text-font'], ['Noto Sans Bold'], `${layerId} uses the bold face`);
}
const textSizes = evaluate(layers['city-badge-labels'], 'layout', 'text-size', 'text-size');
assert.ok(Math.abs(Number(textSizes.single) - 13.69) < 0.01, `label text size at zoom 4.5, got ${textSizes.single}`);

const singleText = evaluate(layers['city-badge-labels'], 'layout', 'text-field', 'single text-field');
assert.strictEqual(singleText.single, '13°C');

const clusterText = evaluate(layers['city-cluster-labels'], 'layout', 'text-field', 'cluster text-field');
assert.strictEqual(clusterText.cluster, '13°C\n(3)', 'cluster shows the average over the member count');
assert.strictEqual(clusterText.blank, '—', 'all-blank cluster shows a dash and no count');

// The number/average stays bold and the °C stays full-size regular; the count
// is the same regular face, slightly smaller.
function sectionsOf(layer, feature, key) {
  const parsed = spec.createPropertyExpression(layer.layout['text-field'], PROPERTY_SPECS['text-field']);
  assert.strictEqual(parsed.result, 'success', `${key} text-field parses`);
  return parsed.value
    .evaluateWithoutErrorHandling({ zoom: 4.5 }, feature)
    .sections.map(section => [section.text, section.fontStack, section.scale]);
}

assert.deepStrictEqual(
  sectionsOf(layers['city-cluster-labels'], FEATURES.cluster, 'cluster'),
  [['13', 'Noto Sans Bold', 1], ['°C', 'Noto Sans Regular', 1], ['\n(3)', 'Noto Sans Regular', 0.8]],
  'cluster: bold average, full-size regular unit, smaller regular count',
);
assert.deepStrictEqual(
  sectionsOf(layers['city-badge-labels'], FEATURES.single, 'single'),
  [['13', 'Noto Sans Bold', 1], ['°C', 'Noto Sans Regular', 1]],
  'single: bold number, regular full-size unit',
);

// Wikipedia's ink rule: white at both extremes, black in between — and no
// text halo, so the glyph edge meets the fill directly.
const clusterInk = evaluate(layers['city-cluster-labels'], 'paint', 'text-color', 'cluster text-color');
assert.strictEqual(clusterInk.cold, 'rgba(255,255,255,1)', 'deep blue end uses white ink');
assert.strictEqual(clusterInk.hot, 'rgba(255,255,255,1)', 'hottest reds use white ink (Wikipedia rule)');
assert.strictEqual(clusterInk.cluster, 'rgba(0,0,0,1)', 'mild clusters use black ink');
assert.strictEqual(clusterInk.blank, 'rgba(0,0,0,1)', 'blank clusters use black ink');

for (const layerId of ['city-cluster-labels', 'city-badge-labels']) {
  assert.ok(!('text-halo-color' in layers[layerId].paint), `${layerId} must not draw a text halo`);
  assert.ok(!('text-halo-width' in layers[layerId].paint), `${layerId} must not draw a text halo`);
}

const strokeWidths = evaluate(layers['city-badges'], 'paint', 'circle-stroke-width', 'circle-stroke-width');
assert.strictEqual(strokeWidths.single, '0.8', 'thin white ball outline');

/* 3. Interaction wiring ----------------------------------------------------- */
for (const layerId of ['city-badges', 'city-cluster-badges', 'city-cluster-labels', 'city-badge-labels']) {
  assert.ok((captured.handlers[`click:${layerId}`] || []).length > 0, `click handler wired for ${layerId}`);
}

/* 4. Popup source link ------------------------------------------------------- */
const singleClick = captured.handlers['click:city-badges'][0];

singleClick({ features: [{ properties: { index: 0 } }] });
const alphaHtml = captured.popups[captured.popups.length - 1].html;
assert.match(
  alphaHtml,
  /<div class="popup-source">Source: <a href="https:\/\/en\.wikipedia\.org\/wiki\/Alpha#Climate_data"/,
  'a city with a section anchor deep-links its source, with "Source:" left unlinked',
);
assert.match(alphaHtml, />Wikipedia ↗<\/a><\/div>/, 'only the Wikipedia label and its arrow are linked');
assert.match(alphaHtml, /target="_blank" rel="noopener noreferrer"/, 'the source link opens in a new tab');

singleClick({ features: [{ properties: { index: 1 } }] });
const betaHtml = captured.popups[captured.popups.length - 1].html;
assert.match(
  betaHtml,
  /<a href="https:\/\/en\.wikipedia\.org\/wiki\/Beta" target="_blank" rel="noopener noreferrer">Wikipedia ↗<\/a>/,
  'a city without an anchor links the article itself',
);

console.log('check-web OK:', captured.layers.length, 'layers, no validation errors, expressions evaluate as expected');
