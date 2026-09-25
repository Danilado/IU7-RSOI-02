const test = require('node:test');
const assert = require('node:assert/strict');
const { canBorrow, ratingDelta } = require('../shared/rules');

test('borrowing is allowed below the star limit', () => {
  assert.equal(canBorrow(0, 1), true);
  assert.equal(canBorrow(1, 1), false);
});

test('rating increases for a timely return in unchanged condition', () => {
  assert.equal(ratingDelta(false, true), 1);
});

test('rating loses ten points for each return fault', () => {
  assert.equal(ratingDelta(true, true), -10);
  assert.equal(ratingDelta(false, false), -10);
  assert.equal(ratingDelta(true, false), -20);
});
