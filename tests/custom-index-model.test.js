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
  assert.equal(result.points[1].dailyReturn, 2 / 100 * 3 / 365);
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
