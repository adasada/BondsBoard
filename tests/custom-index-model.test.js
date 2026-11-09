const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../custom-index-model.js');

function fixtureConfig() {
  const config = model.cloneDefaults();
  config.buckets = config.buckets.map((bucket) => ({ ...bucket, weight: bucket.id === 'treasury' ? 100 : 0 }));
  config.leverage = 1;
  config.feePct = 0;
  config.fundingPct = 0;
  config.rateShockBp = 0;
  config.creditShockBp = 0;
  return config;
}

function row(date, value) {
  return { date, curves: { treasury: { 5: value }, policy: { 5: value } } };
}

test('requires a fully funded allocation and bounded tenor/duration inputs', () => {
  const config = fixtureConfig();
  assert.equal(model.validate(config), null);
  config.buckets[0].weight = 99;
  assert.match(model.validate(config), /100%/);
  config.buckets[0].weight = 100;
  config.buckets[0].duration = 31;
  assert.match(model.validate(config), /超出范围/);
});

test('starts at the configured base and accrues carry across calendar days', () => {
  const config = fixtureConfig();
  const result = model.calculate([row('2026-01-05', 2), row('2026-01-08', 2)], config);
  assert.equal(result.error, null);
  assert.equal(result.points[0].value, config.baseValue);
  assert.ok(result.points[1].value > result.points[0].value);
  assert.equal(result.points.at(-1).value, config.baseValue * (1 + 2 / 100 * 3 / 365));
  assert.equal(result.points.length, 4);
  assert.equal(result.points[1].kind, 'gap-estimate');
});

test('duration responds to a curve move and a static parallel shock', () => {
  const config = fixtureConfig();
  const result = model.calculate([row('2026-01-05', 2), row('2026-01-06', 2.01)], config);
  assert.ok(result.points[1].value < result.points[0].value);
  config.rateShockBp = 25;
  assert.ok(model.calculate([], config).scenarioPct < 0);
});

test('ignores duplicate dates and reports missing required market tenors', () => {
  const config = fixtureConfig();
  const duplicate = model.calculate([row('2026-01-05', 2), row('2026-01-05', 2.5), row('2026-01-06', 2)], config);
  assert.equal(duplicate.points.length, 2);
  const missing = model.calculate([row('2026-01-05', 2), { date: '2026-01-06', curves: { treasury: {}, policy: {} } }], config);
  assert.equal(missing.points.length, 1);
});

test('starts at the first usable observation and bridges missing curves without losing carry', () => {
  const config = fixtureConfig();
  const result = model.calculate([row('2026-01-04', null), row('2026-01-05', 2), row('2026-01-06', null), row('2026-01-08', 2)], config, '2026-01-09');
  assert.equal(result.points[0].date, '2026-01-05');
  assert.equal(result.points[0].value, 1000);
  assert.equal(result.points.at(-1).value, 1000 * (1 + .02 * 3 / 365));
  assert.equal(result.skippedRows, 2);
  assert.equal(result.forecastPoint.afterDate, '2026-01-08');
});

test('interpolates a missing tenor only between valid published neighbors', () => {
  const config = fixtureConfig();
  const interpolated = model.calculate([{ date: '2026-01-05', curves: { treasury: { 3: 1.8, 5: null, 7: 2.2 } } }], config, '2026-01-06');
  assert.equal(interpolated.points.length, 1);
  assert.equal(interpolated.interpolatedRows, 1);
  assert.equal(interpolated.forecastPoint.value, 1000 * (1 + .02 / 365));
  const missing = model.calculate([{ date: '2026-01-05', curves: { treasury: { 3: 1.8, 5: null, 7: null } } }], config, '2026-01-06');
  assert.equal(missing.points.length, 0);
  assert.equal(missing.forecastPoint, null);
});

test('projects through today separately from history, without borrowing stress shocks', () => {
  const config = fixtureConfig();
  config.rateShockBp = 50;
  config.creditShockBp = 100;
  const result = model.calculate([row('2026-01-09', 2)], config, '2026-01-12');
  assert.equal(result.points.length, 1);
  assert.deepEqual(result.forecastPoints.map((point) => point.date), ['2026-01-10', '2026-01-11', '2026-01-12']);
  assert.equal(result.forecastPoint.value, 1000 * (1 + .02 * 3 / 365));
  assert.ok(result.scenarioPct < 0);
  config.forecastRateBp = 10;
  assert.ok(model.calculate([row('2026-01-09', 2)], config, '2026-01-12').forecastPoint.value < 1000);
});

test('forecast includes leverage financing and expenses, and preserves historical metrics', () => {
  const config = fixtureConfig();
  config.leverage = 1.2; config.fundingPct = 1.8; config.feePct = .2;
  const result = model.calculate([row('2026-01-09', 2)], config, '2026-01-12');
  const expected = (1.2 * .02 - .2 * .018 - .002) * 3 / 365;
  assert.ok(Math.abs(result.forecastPoint.totalReturn - expected) < 1e-12);
  assert.equal(result.points[0].value, 1000);
});

test('forecast target is editable and actual dates never get a duplicate forecast', () => {
  const config = fixtureConfig();
  assert.equal(model.calculate([row('2026-01-12', 2)], config, '2026-01-12').forecastPoint, null);
  config.forecastDate = '2026-01-14';
  assert.equal(model.calculate([row('2026-01-12', 2)], config, '2026-01-12').forecastPoint.date, '2026-01-14');
  config.forecastDate = '2028-01-14';
  assert.match(model.calculate([row('2026-01-12', 2)], config, '2026-01-12').forecastError, /365/);
  config.forecastDate = '2026-02-30';
  assert.match(model.validate(config), /日期/);
});

test('rejects blank and null saved numbers and ignores future observations', () => {
  const config = fixtureConfig();
  config.buckets[0].duration = null;
  assert.match(model.validate(config), /无效/);
  config.buckets[0].duration = 4.5;
  config.forecastRateBp = '';
  assert.match(model.validate(config), /无效/);
  config.forecastRateBp = 0;
  const result = model.calculate([row('2026-01-09', 2), row('2026-01-15', 4)], config, '2026-01-12');
  assert.equal(result.points.at(-1).date, '2026-01-09');
  assert.equal(result.forecastPoint.afterDate, '2026-01-09');
});

test('reports an uncovered past target and refuses a nonpositive forecast', () => {
  const config = fixtureConfig();
  config.forecastDate = '2025-12-01';
  assert.match(model.calculate([row('2026-01-09', 2)], config, '2026-01-12').forecastError, /未覆盖/);
  config.forecastDate = '2027-01-09';
  config.leverage = 2; config.fundingPct = 15; config.feePct = 5;
  config.buckets[0].duration = 30; config.forecastRateBp = 323;
  const invalid = model.calculate([row('2026-01-09', 2)], config, '2026-01-12');
  assert.match(invalid.forecastError, /非正点位/);
  assert.equal(invalid.forecastPoints.length, 0);
});

test('a newly published observation replaces the old forecast with a retrospective point', () => {
  const config = fixtureConfig();
  const before = model.calculate([row('2026-01-09', 2)], config, '2026-01-12');
  assert.equal(before.forecastPoint.date, '2026-01-12');
  const after = model.calculate([row('2026-01-09', 2), row('2026-01-12', 2.01)], config, '2026-01-12');
  assert.equal(after.forecastPoint, null);
  assert.equal(after.points.at(-1).kind, 'history');
  assert.notEqual(after.points.at(-1).value, before.forecastPoint.value);
});
