// Offline browser-logic regression tests: node --test tests/dashboard_charge_estimate.test.cjs
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

const template = readFileSync(path.join(__dirname, '../src/toybaru/templates/dashboard.html'), 'utf8');
const script = template.split('<script>')[1].split('</script>')[0];
const card = {innerHTML: ''};
const context = vm.createContext({
  Date: class extends Date { static now() { return Date.parse('2026-09-18T16:00:00Z'); } },
  tf: (_key, fallback) => fallback,
  fmtDate: value => value,
  _fmtDur: minutes => `${minutes}m`,
  _escHtml: value => String(value),
  _sbox: (value, label) => `${label}: ${value}\n`,
  document: {getElementById: () => card},
});
// Use the actual template functions, not a duplicate implementation.
vm.runInContext(script.slice(script.indexOf('function _chargeEstimate('), script.indexOf('async function sendElectricCommand(')), context);
const now = Date.parse('2026-09-18T14:30:00Z');
const battery = overrides => ({chargingStatus: 'charging', remainingChargeTime: 60,
  lastUpdateTimestamp: '2026-09-18T14:00:00Z', ...overrides});

test('entire dashboard script is syntactically valid', () => {
  new vm.Script(script);
});

test('finish stays anchored across repeated renders of cached data', () => {
  const first = context._chargeEstimate(battery(), now);
  const later = context._chargeEstimate(battery(), now + 10 * 60000);
  assert.equal(first.finishAt, Date.parse('2026-09-18T15:00:00Z'));
  assert.equal(first.finishAt, later.finishAt);
  assert.equal(later.stale, false);
  const boxes = context._chargeEstimateBoxes(battery(), now);
  assert.ok(boxes.some(([value, label]) => label === 'Estimated finish' && value === '2026-09-18T15:00:00.000Z'));
  assert.ok(boxes.some(([value, label]) => label === 'Last update' && value === '2026-09-18T14:00:00.000Z'));
});

test('elapsed estimate waits for data instead of claiming completion', () => {
  for (const remainingChargeTime of [0, 30]) {
    const boxes = context._chargeEstimateBoxes(battery({remainingChargeTime}), now);
    assert.ok(boxes.some(([value]) => value === 'Awaiting updated estimate'));
    assert.ok(!boxes.some(([, label]) => label === 'Reported remaining'));
  }
});

test('only active charging shows estimates', () => {
  for (const chargingStatus of ['connected', 'not connected', 'unknown', undefined]) {
    assert.equal(context._chargeEstimate(battery({chargingStatus}), now), null);
  }
});

test('invalid and unavailable durations never generate an estimate', () => {
  for (const remainingChargeTime of [undefined, null, '', ' ', false, true, -1, '-1',
    1.5, NaN, Infinity, 'invalid', 65535, '65535', 65536, [], {}]) {
    assert.equal(context._chargeEstimate(battery({remainingChargeTime}), now), null);
  }
  assert.equal(context._chargeEstimate(battery({remainingChargeTime: '60'}), now).minutes, 60);
});

test('missing, ambiguous, invalid, or future timestamps show reported duration only', () => {
  for (const lastUpdateTimestamp of [undefined, null, '', 'bad', 0,
    '2026-09-18T14:00:00', '2026-09-19T14:00:00Z']) {
    const data = battery({lastUpdateTimestamp});
    assert.equal(context._chargeEstimate(data, now).finishAt, null);
    const boxes = context._chargeEstimateBoxes(data, now);
    assert.equal(boxes.length, 1);
    assert.equal(boxes[0][1], 'Reported remaining');
  }
});

test('timezone offsets and midnight rollover retain the correct date', () => {
  const data = battery({lastUpdateTimestamp: '2026-09-17T23:30:00-04:00'});
  const estimate = context._chargeEstimate(data, Date.parse('2026-09-18T04:00:00Z'));
  assert.equal(estimate.finishAt, Date.parse('2026-09-18T04:30:00Z'));
});

test('management card uses battery snapshot and hides stale/completed durations', () => {
  context.renderChargeManagement({remaining_charge_time: 99}, battery());
  assert.match(card.innerHTML, /Awaiting updated estimate/);
  assert.doesNotMatch(card.innerHTML, /99m|Full in|Reported remaining/);
  context.renderChargeManagement({remaining_charge_time: 99}, battery({chargingStatus: 'connected'}));
  assert.doesNotMatch(card.innerHTML, /Estimated finish|Reported remaining/);
});
