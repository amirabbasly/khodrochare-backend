const { test } = require('node:test');
const assert = require('node:assert/strict');
const { quote, vehicleGroup, TARIFFS } = require('../src/pricing');
const DAY = new Date('2026-10-20T09:00:00Z');
const NIGHT = new Date('2026-10-20T21:00:00Z');
test('all numeric tariff rows match the supplied table for both transport modes', () => {
  const names = { GROUP_1: 'پژو ۲۰۶', GROUP_2: 'سورن', GROUP_3: 'پارس', GROUP_4: 'سوناتا', NISSAN_PICKUP: 'نیسان وانت' };
  for (const [group, modes] of Object.entries(TARIFFS)) {
    for (const [transportKind, [base, perKm]] of Object.entries(modes)) {
      const result = quote({ service: 'TOWING', vehicleName: names[group], transportKind, distanceMeters: 1500, at: DAY });
      assert.equal(result.priceToman, base + perKm * 1.5);
      assert.equal(result.pricingBreakdown.vehicleGroup, group);
    }
  }
});
test('vehicle classification normalizes digits and distinguishes Mazda 323 from Mazda 3', () => {
  assert.equal(vehicleGroup('مزدا ۳۲۳'), 'GROUP_2');
  assert.equal(vehicleGroup('مزدا ۳'), 'GROUP_3');
  assert.equal(vehicleGroup('پژو ۲۰۷ پانوراما · ۱۴۰۱'), 'GROUP_1');
  assert.equal(vehicleGroup('خودروی ناشناخته'), 'UNLISTED');
});
test('traffic, weather and night percentages add; each applies to both transport kinds', () => {
  for (const transportKind of ['NISSAN', 'FLATBED']) {
    const base = quote({ service: 'TOWING', vehicleName: 'پژو 206', transportKind, distanceMeters: 1000, at: DAY }).priceToman;
    const two = quote({ service: 'TOWING', vehicleName: 'پژو 206', transportKind, distanceMeters: 1000, at: NIGHT, heavyTraffic: true });
    assert.equal(two.priceToman, Math.round(base * 1.4));
    assert.equal(two.pricingBreakdown.surchargePercent, 40);
    const three = quote({ service: 'TOWING', vehicleName: 'پژو 206', transportKind, distanceMeters: 1000, at: NIGHT, heavyTraffic: true, rainOrSnow: true });
    assert.equal(three.priceToman, Math.round(base * 1.6));
  }
});
test('night uses Tehran midnight inclusive and 06:00 exclusive', () => {
  for (const [time, expected] of [['2026-10-20T20:29:59Z', false], ['2026-10-20T20:30:00Z', true], ['2026-10-21T02:29:59Z', true], ['2026-10-21T02:30:00Z', false]]) {
    assert.equal(quote({ service: 'TOWING', vehicleName: 'پژو 206', distanceMeters: 1000, at: new Date(time) }).pricingBreakdown.night, expected);
  }
});
test('group five, unlisted vehicles, extra load and unpriced pickup flatbed require agreement', () => {
  for (const input of [{ vehicleName: 'لندکروز' }, { vehicleName: 'خودروی ناشناخته' }, { vehicleName: 'نیسان وانت', transportKind: 'FLATBED' }, { vehicleName: 'پژو 206', hasExtraLoad: true }]) {
    const result = quote({ service: 'TOWING', distanceMeters: 1000, at: DAY, ...input });
    assert.equal(result.priceToman, null);
    assert.equal(result.pricingBreakdown.requiresAgreement, true);
  }
});
test('repair is always 800,000 toman excluding parts, even at night and for unlisted vehicles', () => {
  for (const vehicleName of ['پراید', 'پژو 206', 'لندکروز', 'خودروی ناشناخته']) {
    const result = quote({ service: 'REPAIR', vehicleName, at: NIGHT, heavyTraffic: true, rainOrSnow: true });
    assert.equal(result.priceToman, 800000);
    assert.equal(result.pricingBreakdown.partsIncluded, false);
    assert.equal(result.pricingBreakdown.partsPricing, 'AFTER_INSPECTION');
  }
});
test('invalid distances cannot produce a towing price', () => {
  for (const distanceMeters of [0, -1, NaN, Infinity]) assert.throws(() => quote({ service: 'TOWING', vehicleName: 'پراید', distanceMeters }));
});
