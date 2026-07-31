import { test, describe } from 'node:test';
import assert from 'node:assert';
import { getCachedChats, getCachedMessages, setCachedChats, setCachedMessages, clearCache, getStorageKey } from './cacheStore.js';

describe('getStorageKey', () => {
  test('concatenates all parts with colons', () => {
    const key = getStorageKey('prefix', 'provider', 'account', 'chat123');
    assert.strictEqual(key, 'prefix:provider:account:chat123');
  });

  test('uses empty string as default conversationId', () => {
    const key = getStorageKey('prefix', 'provider', 'account');
    assert.strictEqual(key, 'prefix:provider:account:');
  });

  test('handles empty strings for all parts', () => {
    const key = getStorageKey('', '', '', '');
    assert.strictEqual(key, ':::');
  });

  test('stringifies non-string inputs', () => {
    // @ts-ignore - testing runtime behavior for non-string inputs
    assert.strictEqual(getStorageKey(1, 2, 3, 4), '1:2:3:4');
    // @ts-ignore
    assert.strictEqual(getStorageKey(null, undefined, true, {}), 'null:undefined:true:[object Object]');
  });
});

describe('cacheStore error recovery', () => {
  test('getCachedChats returns empty array when indexedDB.open fails', async () => {
    // Mock global window and indexedDB
    global.window = {
      indexedDB: {
        open: () => {
          const request = {};
          process.nextTick(() => {
            request.error = new Error('IndexedDB connection failed');
            if (request.onerror) request.onerror();
          });
          return request;
        }
      }
    };

    try {
      const result = await getCachedChats('whatsapp', 'test-account');
      assert.deepStrictEqual(result, [], 'Should return empty array on failure');

      const msgs = await getCachedMessages('whatsapp', 'test-account', 'chat1');
      assert.deepStrictEqual(msgs, [], 'Should return empty array on failure');

      // Should handle silent catch for sets and clear
      await setCachedChats('whatsapp', 'test-account', []);
      await setCachedMessages('whatsapp', 'test-account', 'chat1', []);
      await clearCache();
    } finally {
      // Cleanup global mock
      delete global.window;
    }
  });

  test('getCachedChats returns empty array when transaction fails', async () => {
    // Mock global window and indexedDB with a successful open but failing transaction
    global.window = {
      indexedDB: {
        open: () => {
          const request = {};
          process.nextTick(() => {
            request.result = {
              transaction: () => ({
                objectStore: () => ({
                  get: () => {
                    const req = {};
                    process.nextTick(() => {
                      req.error = new Error('Transaction failed');
                      if (req.onerror) req.onerror();
                    });
                    return req;
                  }
                })
              })
            };
            if (request.onsuccess) request.onsuccess();
          });
          return request;
        }
      }
    };

    try {
      const result = await getCachedChats('whatsapp', 'test-account');
      assert.deepStrictEqual(result, [], 'Should return empty array on transaction failure');
    } finally {
      // Cleanup global mock
      delete global.window;
    }
  });
});
