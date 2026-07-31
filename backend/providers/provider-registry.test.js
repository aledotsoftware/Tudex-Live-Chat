const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const { ProviderRegistry } = require('./provider-registry');
const { BaseAdapter } = require('./base-adapter');

describe('ProviderRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  test('register() should add an adapter to the registry', () => {
    const adapter = new BaseAdapter('test-provider');
    registry.register(adapter);
    assert.strictEqual(registry.resolve('test-provider'), adapter);
  });

  test('resolve() should return the correct adapter for a valid key', () => {
    const adapter = new BaseAdapter('test-provider');
    registry.register(adapter);
    assert.strictEqual(registry.resolve('test-provider'), adapter);
  });

  test('resolve() should be case-insensitive and trim whitespace', () => {
    const adapter = new BaseAdapter('test-provider');
    registry.register(adapter);
    assert.strictEqual(registry.resolve('  TEST-PROVIDER  '), adapter);
  });

  test('resolve() should throw an error for non-existent providers', () => {
    assert.throws(() => registry.resolve('non-existent'), /Provider adapter not found: non-existent/);
  });

  test('resolve() should throw an error for null, undefined, or empty input', () => {
    assert.throws(() => registry.resolve(null), /Provider adapter not found: null/);
    assert.throws(() => registry.resolve(undefined), /Provider adapter not found: undefined/);
    assert.throws(() => registry.resolve(''), /Provider adapter not found: /);
  });

  test('listProviders() should return all registered provider names', () => {
    registry.register(new BaseAdapter('provider-a'));
    registry.register(new BaseAdapter('provider-b'));
    assert.deepStrictEqual(registry.listProviders(), ['provider-a', 'provider-b']);
  });

  test('initializeAll() should call initialize on all adapters', () => {
    const adapter1 = new BaseAdapter('adapter1');
    let called1 = false;
    adapter1.initialize = () => { called1 = true; };

    const adapter2 = new BaseAdapter('adapter2');
    let called2 = false;
    adapter2.initialize = () => { called2 = true; };

    registry.register(adapter1);
    registry.register(adapter2);

    registry.initializeAll();

    assert.strictEqual(called1, true);
    assert.strictEqual(called2, true);
  });

  test('initializeProvider() should call initialize on specific adapter', () => {
    const adapter1 = new BaseAdapter('adapter1');
    let called1 = false;
    adapter1.initialize = () => { called1 = true; };

    registry.register(adapter1);

    registry.initializeProvider('adapter1');

    assert.strictEqual(called1, true);
  });
});
