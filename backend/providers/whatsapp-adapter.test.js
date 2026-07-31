const { test, describe } = require('node:test');
const assert = require('node:assert');
const { WhatsAppAdapter } = require('./whatsapp-adapter');

describe('WhatsAppAdapter', () => {
  const mockChat = {
    fetchMessages: async ({ limit }) => Array(limit).fill({ id: 'msg' }),
    sendSeen: async () => { mockChat.seenSent = true; }
  };

  const mockClient = {
    getChats: async () => [{ id: 'chat1' }],
    getChatById: async (id) => id === 'valid' ? mockChat : null
  };

  test('isReady() should return the internal ready state', () => {
    const adapter = new WhatsAppAdapter({ client: mockClient });
    assert.strictEqual(adapter.isReady(), false);
    adapter._isReady = true;
    assert.strictEqual(adapter.isReady(), true);
  });

  test('getStatus() should return the internal status state', () => {
    const adapter = new WhatsAppAdapter({ client: mockClient });
    assert.strictEqual(adapter.getStatus(), 'initializing');
    adapter._status = 'authenticated';
    assert.strictEqual(adapter.getStatus(), 'authenticated');
  });

  test('listChats() should delegate to client.getChats', async () => {
    const adapter = new WhatsAppAdapter({ client: mockClient });
    const chats = await adapter.listChats();
    assert.strictEqual(chats.length, 1);
    assert.strictEqual(chats[0].id, 'chat1');
  });

  describe('fetchMessages', () => {
    test('should return messages for a valid conversationId', async () => {
      const adapter = new WhatsAppAdapter({ client: mockClient });
      const msgs = await adapter.fetchMessages({ conversationId: 'valid', limit: 2 });
      assert.strictEqual(msgs.length, 2);
    });

    test('should use default limit of 80', async () => {
      const adapter = new WhatsAppAdapter({ client: mockClient });
      const msgs = await adapter.fetchMessages({ conversationId: 'valid' });
      assert.strictEqual(msgs.length, 80);
    });

    test('should return empty array if chat not found', async () => {
      const adapter = new WhatsAppAdapter({ client: mockClient });
      const msgs = await adapter.fetchMessages({ conversationId: 'invalid' });
      assert.deepStrictEqual(msgs, []);
    });
  });

  describe('getChatByMessage', () => {
    test('should delegate to message.getChat if function exists', async () => {
      const adapter = new WhatsAppAdapter({ client: mockClient });
      const msg = { getChat: async () => ({ id: 'chatFromMsg' }) };
      const chat = await adapter.getChatByMessage(msg);
      assert.strictEqual(chat.id, 'chatFromMsg');
    });

    test('should return null if message.getChat does not exist', async () => {
      const adapter = new WhatsAppAdapter({ client: mockClient });
      const msg = { id: '123' };
      const chat = await adapter.getChatByMessage(msg);
      assert.strictEqual(chat, null);
    });
  });

  describe('hasMedia', () => {
    test('should return true if message hasMedia is true', () => {
      const adapter = new WhatsAppAdapter({ client: mockClient });
      assert.strictEqual(adapter.hasMedia({ hasMedia: true }), true);
    });

    test('should return false if message hasMedia is false or missing', () => {
      const adapter = new WhatsAppAdapter({ client: mockClient });
      assert.strictEqual(adapter.hasMedia({ hasMedia: false }), false);
      assert.strictEqual(adapter.hasMedia({}), false);
      assert.strictEqual(adapter.hasMedia(null), false);
    });
  });

  describe('hasQuotedMsg', () => {
    test('should return true if message hasQuotedMsg is true', () => {
      const adapter = new WhatsAppAdapter({ client: mockClient });
      assert.strictEqual(adapter.hasQuotedMsg({ hasQuotedMsg: true }), true);
    });

    test('should return false if message hasQuotedMsg is false or missing', () => {
      const adapter = new WhatsAppAdapter({ client: mockClient });
      assert.strictEqual(adapter.hasQuotedMsg({ hasQuotedMsg: false }), false);
      assert.strictEqual(adapter.hasQuotedMsg({}), false);
      assert.strictEqual(adapter.hasQuotedMsg(null), false);
    });
  });

  describe('isStatusMessage', () => {
    test('should return true for status messages', () => {
      const adapter = new WhatsAppAdapter({ client: mockClient });
      assert.strictEqual(adapter.isStatusMessage({ from: 'status@broadcast' }), true);
      assert.strictEqual(adapter.isStatusMessage({ type: 'status_v3' }), true);
      assert.strictEqual(adapter.isStatusMessage({ isStatus: true }), true);
    });

    test('should return false for regular messages', () => {
      const adapter = new WhatsAppAdapter({ client: mockClient });
      assert.strictEqual(adapter.isStatusMessage({ from: 'user@c.us', type: 'chat' }), false);
    });
  });

  describe('getChatIdFromMessage', () => {
    test('should return to if fromMe is true', () => {
      const adapter = new WhatsAppAdapter({ client: mockClient });
      assert.strictEqual(adapter.getChatIdFromMessage({ fromMe: true, to: 'user@c.us', from: 'me@c.us' }), 'user@c.us');
    });

    test('should return from if fromMe is false', () => {
      const adapter = new WhatsAppAdapter({ client: mockClient });
      assert.strictEqual(adapter.getChatIdFromMessage({ fromMe: false, to: 'me@c.us', from: 'user@c.us' }), 'user@c.us');
    });
  });

  describe('extractStatusDescriptor', () => {
    test('should extract status descriptor fields correctly', () => {
      const adapter = new WhatsAppAdapter({ client: mockClient });
      const msg = {
        id: { _serialized: 'status123' },
        author: 'user@c.us',
        caption: 'My status',
        type: 'image',
        timestamp: 1600000000
      };
      const desc = adapter.extractStatusDescriptor(msg);
      assert.strictEqual(desc.providerStatusMessageId, 'status123');
      assert.strictEqual(desc.statusOwnerId, 'user@c.us');
      assert.strictEqual(desc.description, 'My status');
      assert.strictEqual(desc.caption, 'My status');
      assert.strictEqual(desc.mediaType, 'image');
      assert.strictEqual(desc.timestamp, 1600000000);
    });
  });

  describe('extractMessageContext', () => {
    test('should extract message context correctly', () => {
      const adapter = new WhatsAppAdapter({ client: mockClient });
      const msg = {
        id: { _serialized: 'msg123' },
        body: 'hello',
        timestamp: 1600000000,
        fromMe: true,
        from: '123@c.us',
        to: '456@c.us',
        mentionedIds: ['789@c.us']
      };
      const ctx = adapter.extractMessageContext(msg);
      assert.strictEqual(ctx.providerMessageId, 'msg123');
      assert.strictEqual(ctx.body, 'hello');
      assert.strictEqual(ctx.timestamp, 1600000000);
      assert.strictEqual(ctx.fromMe, true);
      assert.strictEqual(ctx.from, '123@c.us');
      assert.strictEqual(ctx.to, '456@c.us');
      assert.deepStrictEqual(ctx.mentionedIds, ['789@c.us']);
    });
  });

  describe('extractChatContext', () => {
    test('should extract chat context correctly', () => {
      const adapter = new WhatsAppAdapter({ client: mockClient });
      const chat = {
        id: { _serialized: 'chat123' },
        name: 'John Doe',
        unreadCount: 5,
        timestamp: 1600000000,
        isGroup: false
      };
      const ctx = adapter.extractChatContext(chat);
      assert.strictEqual(ctx.chatId, 'chat123');
      assert.strictEqual(ctx.name, 'John Doe');
      assert.strictEqual(ctx.unreadCount, 5);
      assert.strictEqual(ctx.timestamp, 1600000000);
      assert.strictEqual(ctx.isGroup, false);
    });
  });

  describe('markRead', () => {
    test('should delegate to chat.sendSeen if chat exists', async () => {
      const adapter = new WhatsAppAdapter({ client: mockClient });
      mockChat.seenSent = false;
      await adapter.markRead({ conversationId: 'valid' });
      assert.strictEqual(mockChat.seenSent, true);
    });

    test('should do nothing if chat does not exist', async () => {
      const adapter = new WhatsAppAdapter({ client: mockClient });
      await adapter.markRead({ conversationId: 'invalid' });
      // If it doesn't throw, it passed
      assert.ok(true);
    });
  });
});
