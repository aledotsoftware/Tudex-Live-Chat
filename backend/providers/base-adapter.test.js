const { test, describe } = require('node:test');
const assert = require('node:assert');
const { BaseAdapter } = require('./base-adapter');

describe('BaseAdapter', () => {
  test('constructor should set provider name, trim and lowercase it', () => {
    const adapter = new BaseAdapter('  TeSt  ');
    assert.strictEqual(adapter.getProviderName(), 'test');
  });

  test('constructor should throw if provider name is missing or empty', () => {
    assert.throws(() => new BaseAdapter(), /Provider adapter requires a provider name/);
    assert.throws(() => new BaseAdapter('   '), /Provider adapter requires a provider name/);
  });

  test('getProviderName() should return the provider name', () => {
    const adapter = new BaseAdapter('adapter1');
    assert.strictEqual(adapter.getProviderName(), 'adapter1');
  });

  test('isReady() should return the internal state', () => {
    const adapter = new BaseAdapter('test');
    assert.strictEqual(adapter.isReady(), false);
    adapter._isReady = true;
    assert.strictEqual(adapter.isReady(), true);
  });

  test('getStatus() should return the internal status', () => {
    const adapter = new BaseAdapter('test');
    assert.strictEqual(adapter.getStatus(), 'initializing');
    adapter._status = 'authenticated';
    assert.strictEqual(adapter.getStatus(), 'authenticated');
  });

  test('unimplemented methods should throw errors', async (t) => {
    const adapter = new BaseAdapter('test');

    await t.test('listChats() should throw not implemented error', () => {
      assert.rejects(() => adapter.listChats(), /listChats\(\) not implemented for provider=test/);
    });

    await t.test('fetchMessages() should throw not implemented error', () => {
      assert.rejects(() => adapter.fetchMessages({}), /fetchMessages\(\) not implemented for provider=test/);
    });

    await t.test('markRead() should throw not implemented error', () => {
      assert.rejects(() => adapter.markRead({}), /markRead\(\) not implemented for provider=test/);
    });

    await t.test('getChatByMessage() should throw not implemented error', () => {
      assert.rejects(() => adapter.getChatByMessage({}), /getChatByMessage\(\) not implemented for provider=test/);
    });

    await t.test('isStatusMessage() should throw not implemented error', () => {
      assert.throws(() => adapter.isStatusMessage({}), /isStatusMessage\(\) not implemented for provider=test/);
    });

    await t.test('getChatIdFromMessage() should throw not implemented error', () => {
      assert.throws(() => adapter.getChatIdFromMessage({}), /getChatIdFromMessage\(\) not implemented for provider=test/);
    });

    await t.test('extractMessageContext() should throw not implemented error', () => {
      assert.throws(() => adapter.extractMessageContext({}), /extractMessageContext\(\) not implemented for provider=test/);
    });

    await t.test('extractChatContext() should throw not implemented error', () => {
      assert.throws(() => adapter.extractChatContext({}), /extractChatContext\(\) not implemented for provider=test/);
    });

    await t.test('extractStatusDescriptor() should throw not implemented error', () => {
      assert.throws(() => adapter.extractStatusDescriptor({}), /extractStatusDescriptor\(\) not implemented for provider=test/);
    });
  });
});
