const { test, describe } = require('node:test');
const assert = require('node:assert');
const { parsePositiveInt } = require('./utils');

describe('parsePositiveInt', () => {
  test('should return parsed integer for valid positive numeric input', () => {
    assert.strictEqual(parsePositiveInt(10, 5, 100), 10);
    assert.strictEqual(parsePositiveInt('42', 5, 100), 42);
  });

  test('should floor floating point numbers', () => {
    assert.strictEqual(parsePositiveInt(10.7, 5, 100), 10);
    assert.strictEqual(parsePositiveInt('42.2', 5, 100), 42);
  });

  test('should clamp to max value', () => {
    assert.strictEqual(parsePositiveInt(150, 5, 100), 100);
    assert.strictEqual(parsePositiveInt('200', 5, 100), 100);
  });

  test('should return fallback for zero or negative values', () => {
    assert.strictEqual(parsePositiveInt(0, 5, 100), 5);
    assert.strictEqual(parsePositiveInt(-10, 5, 100), 5);
    assert.strictEqual(parsePositiveInt('-5', 5, 100), 5);
  });

  test('should return fallback for non-numeric strings', () => {
    assert.strictEqual(parsePositiveInt('abc', 5, 100), 5);
    assert.strictEqual(parsePositiveInt('', 5, 100), 5);
    assert.strictEqual(parsePositiveInt('  ', 5, 100), 5);
  });

  test('should return fallback for NaN and Infinity', () => {
    assert.strictEqual(parsePositiveInt(NaN, 5, 100), 5);
    assert.strictEqual(parsePositiveInt(Infinity, 5, 100), 5);
    assert.strictEqual(parsePositiveInt(-Infinity, 5, 100), 5);
  });

  test('should return fallback for null and undefined', () => {
    assert.strictEqual(parsePositiveInt(null, 5, 100), 5);
    assert.strictEqual(parsePositiveInt(undefined, 5, 100), 5);
  });
});
