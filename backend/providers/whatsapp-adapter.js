const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const { BaseAdapter } = require('./base-adapter');

class WhatsAppAdapter extends BaseAdapter {
  constructor(options = {}) {
    super('whatsapp');

    // Configurable initialization
    if (options.client) {
      this.client = options.client;
    } else {
      this.client = new Client({
        authStrategy: options.authStrategy || new LocalAuth({ dataPath: options.dataPath || './.wwebjs_auth' }),
        puppeteer: options.puppeteer || {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-extensions'
          ],
          executablePath: options.chromeExecutablePath
        },
        webVersionCache: options.webVersionCache || {
          type: 'remote',
          remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1018921608-alpha.html'
        }
      });
    }

    this._authPath = options.dataPath || './.wwebjs_auth';
  }

  _cleanChromiumLocks() {
    const fs = require('fs');
    const path = require('path');
    const authPath = path.resolve(process.cwd(), this._authPath);
    if (fs.existsSync(authPath)) {
      try {
        const deleteLock = (dir) => {
          if (!fs.existsSync(dir)) return;
          const files = fs.readdirSync(dir);
          for (const file of files) {
            const fullPath = path.join(dir, file);
            if (fs.lstatSync(fullPath).isDirectory()) {
              deleteLock(fullPath);
            } else if (file === 'SingletonLock') {
              fs.unlinkSync(fullPath);
              console.log('🧹 Archivo SingletonLock eliminado para permitir el inicio.');
            }
          }
        };
        deleteLock(authPath);
      } catch (err) {
        console.warn('⚠️ No se pudo limpiar SingletonLock:', err.message);
      }
    }
  }

  initialize() {
    this._cleanChromiumLocks();

    this.client.on('qr', (qr) => this.emit('qr', qr));
    this.client.on('ready', () => this.emit('ready'));
    this.client.on('authenticated', () => this.emit('authenticated'));
    this.client.on('auth_failure', (msg) => this.emit('auth_failure', msg));
    this.client.on('disconnected', (reason) => this.emit('disconnected', reason));

    this.client.on('message_revoke_everyone', (after, before) => {
      this.emit('message_revoke_everyone', after, before);
    });

    this.client.on('message_revoke_me', (after, before) => {
      this.emit('message_revoke_me', after, before);
    });

    this.client.on('message_create', (msg) => {
      this.emit('message_create', msg);
    });

    this.client.initialize();
  }


  async listChats() {
    return this.client.getChats();
  }

  async fetchMessages({ conversationId, limit = 80 }) {
    const chat = await this.client.getChatById(conversationId);
    if (!chat) return [];
    return chat.fetchMessages({ limit });
  }

  async markRead({ conversationId }) {
    const chat = await this.client.getChatById(conversationId);
    if (chat) {
      await chat.sendSeen();
    }
  }

  async getMessageById(messageId) {
    return this.client.getMessageById(messageId);
  }

  async fetchStatusDescriptors() {
    if (!this.client?.pupPage) return [];
    return this.client.pupPage.evaluate(async () => {
      const statuses = window.Store.Status?.getModelsArray?.() || [];
      const results = [];

      for (const status of statuses) {
        const ownerId =
          status?.id?._serialized ||
          status?.contact?.id?._serialized ||
          status?.contact?.userid ||
          '';
        const ownerName =
          status?.contact?.formattedName ||
          status?.contact?.pushname ||
          status?.contact?.name ||
          status?.name ||
          '';
        const collection = status?.msgs || status?._msgs;
        const messages =
          typeof collection?.getModelsArray === 'function'
            ? collection.getModelsArray()
            : Array.isArray(collection)
              ? collection
              : [];

        for (const msg of messages) {
          const serialized = window.WWebJS.getMessageModel(msg);
          results.push({
            providerStatusMessageId: serialized?.id?._serialized || serialized?.id,
            statusOwnerId: ownerId || serialized?.author || serialized?.from || '',
            statusOwnerName: ownerName,
            chatId: serialized?.from || 'status@broadcast',
            description: serialized?.caption || serialized?.body || '',
            caption: serialized?.caption || '',
            mediaType: serialized?.type || '',
            timestamp: serialized?.timestamp || serialized?.t || 0
          });
        }
      }

      return results;
    });
  }

  async markStatusRead() {
    await this.client.sendSeen('status@broadcast').catch(() => {});
  }

  async downloadMedia(message) {
    if (typeof message.downloadMedia === 'function') {
      return message.downloadMedia();
    }
    return null;
  }

  async getQuotedMessage(message) {
    if (typeof message.getQuotedMessage === 'function') {
      return message.getQuotedMessage();
    }
    return null;
  }

  async getChatByMessage(message) {
    if (typeof message.getChat === 'function') {
      return message.getChat();
    }
    return null;
  }

  isStatusMessage(message) {
    return message.from === 'status@broadcast' || message.type === 'status_v3' || message.isStatus === true;
  }

  hasMedia(message) {
    return Boolean(message?.hasMedia);
  }

  hasQuotedMsg(message) {
    return Boolean(message?.hasQuotedMsg);
  }

  getChatIdFromMessage(message) {
    return message.fromMe ? message.to : message.from;
  }

  extractMessageContext(message) {
    return {
      providerMessageId: message?.id?._serialized || message?.id || null,
      body: message?.body || '',
      timestamp: message?.timestamp || Math.floor(Date.now() / 1000),
      fromMe: Boolean(message?.fromMe),
      from: message?.from || null,
      to: message?.to || null,
      mentionedIds: Array.isArray(message?.mentionedIds) ? message.mentionedIds : []
    };
  }

  extractChatContext(chat) {
    return {
      chatId: chat?.id?._serialized || chat?.id || null,
      name: chat?.name || null,
      unreadCount: chat?.unreadCount || 0,
      timestamp: chat?.timestamp || Math.floor(Date.now() / 1000),
      isGroup: Boolean(chat?.isGroup)
    };
  }

  extractStatusDescriptor(message) {
    return {
      providerStatusMessageId: message?.id?._serialized || message?.id || null,
      statusOwnerId: message?.author || message?.from || null,
      description: message?.caption || message?.body || '',
      caption: message?.caption || '',
      mediaType: message?.type || null,
      timestamp: message?.timestamp || Math.floor(Date.now() / 1000)
    };
  }

  async getChatAvatarUrl(chat) {
    if (!chat) return null;
    try {
      if (typeof chat.getProfilePicUrl === 'function') {
        const pic = await chat.getProfilePicUrl();
        if (pic) return pic;
      }
    } catch (_error) {
      // ignore and fallback
    }

    try {
      if (typeof chat.getContact === 'function') {
        const contact = await chat.getContact();
        if (contact && typeof contact.getProfilePicUrl === 'function') {
          const pic = await contact.getProfilePicUrl();
          if (pic) return pic;
        }
      }
    } catch (_error) {
      // ignore and fallback
    }
    return null;
  }

  async sendMessage(params) {
    let {
      chatId,
      text,
      replyToMessageId,
      mediaUrl,
      mediaBase64,
      mediaName = 'image.jpg',
      mediaMimeType = 'image/jpeg'
    } = params;

    const isChannelUrl = chatId.includes('whatsapp.com/channel/');
    const looksLikeInviteCode = !chatId.includes('@') && /^[A-Za-z0-9_-]{10,}$/.test(chatId);

    if (isChannelUrl || looksLikeInviteCode) {
      const parts = chatId.split('/channel/');
      const code = (parts.length > 1 ? parts[1] : chatId).split('?')[0].trim();

      try {
        console.log(`🔍 Resolving channel for invite code: ${code}...`);
        const page = this.client.pupPage;
        const channelData = await page.evaluate(async (inviteCode) => {
          try {
            const response = await window.Store.ChannelUtils.queryNewsletterMetadataByInviteCode(inviteCode);
            if (response && response.idJid) {
              const name = response.newsletterNameMetadataMixin?.nameElementValue || null;
              return { id: response.idJid, name };
            }
            return null;
          } catch (err) {
            if (err.name === 'ServerStatusCodeError') return null;
            return { error: err.message || String(err) };
          }
        }, code);

        if (channelData && channelData.error) {
          throw new Error(`Channel resolution failed: ${channelData.error}`);
        }

        if (channelData && channelData.id) {
          chatId = channelData.id;
          console.log(`✅ Channel resolved: ${channelData.name || 'Newsletter'} → ${chatId}`);
        } else {
          console.warn('⚠️ Channel metadata returned empty for:', code);
          throw new Error(`Channel not found: Could not resolve invite code: ${code}`);
        }
      } catch (err) {
        console.error('❌ Channel resolution failed:', err.message || err);
        throw new Error(`Channel resolution failed: ${err.message || 'Unknown error resolving invite code'}`);
      }
    }

    if (!chatId || (!text && !mediaUrl && !mediaBase64)) {
      throw new Error('Missing parameters (chatId + text/media)');
    }

    const isNewsletter = chatId.includes('@newsletter');
    const sendOptions = {};
    if (replyToMessageId && !isNewsletter) {
      sendOptions.quotedMessageId = replyToMessageId;
    }

    if (isNewsletter) {
      let mediaData = null;
      if (mediaUrl || mediaBase64) {
        let media;
        if (mediaUrl) {
          // 🛡️ Sentinel: Prevent Server-Side Request Forgery (SSRF) when fetching media
          try {
            const parsedUrl = new URL(mediaUrl);
            if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
              throw new Error('Invalid URL protocol');
            }
            const forbiddenHosts = ['localhost', '127.0.0.1', '169.254.169.254', '[::1]', '0.0.0.0'];
            if (forbiddenHosts.includes(parsedUrl.hostname) || parsedUrl.hostname.endsWith('.local') || parsedUrl.hostname.startsWith('192.168.') || parsedUrl.hostname.startsWith('10.')) {
              throw new Error('Local or private IP addresses are not allowed');
            }
          } catch (e) {
            throw new Error(`Invalid mediaUrl: ${e.message}`);
          }
          media = await MessageMedia.fromUrl(mediaUrl).catch(e => {
            console.error('❌ Failed to fetch media from URL:', e.message);
            return null;
          });
        } else {
          media = new MessageMedia(mediaMimeType, mediaBase64, mediaName);
        }
        if (!media) {
          throw new Error('Failed to process media content');
        }
        mediaData = { data: media.data, mimetype: media.mimetype, filename: media.filename || 'file' };
      }

      const sendResult = await this.client.pupPage.evaluate(async (newsletterId, content, mediaInfo) => {
        try {
          const chatWid = window.Store.WidFactory.createWid(newsletterId);
          let chat = window.Store.WAWebNewsletterMetadataCollection.get(newsletterId);
          if (!chat) {
            await window.Store.ChannelUtils.loadNewsletterPreviewChat(newsletterId);
            chat = await window.Store.WAWebNewsletterMetadataCollection.find(chatWid);
          }
          if (!chat) return { error: 'Could not load channel chat object' };

          let mediaOptions = {};
          let mediaHandle = null;
          if (mediaInfo) {
            const processedMedia = await window.WWebJS.processMediaData(mediaInfo, { sendToChannel: true });
            mediaOptions = processedMedia.toJSON ? processedMedia.toJSON() : processedMedia;
            mediaHandle = mediaOptions.mediaHandle || null;
          }

          const meUser = window.Store.User.getMaybeMePnUser();
          const newId = await window.Store.MsgKey.newId();
          const newMsgKey = new window.Store.MsgKey({
            from: meUser, to: chat.id, id: newId, selfDir: 'out'
          });

          const ephemeralFields = window.Store.EphemeralFields.getEphemeralFields(chat);
          const msgBody = mediaInfo ? (content || '') : content;
          const message = {
            id: newMsgKey, ack: 0, body: mediaInfo ? '' : content,
            from: meUser, to: chat.id, local: true, self: 'out',
            t: parseInt(new Date().getTime() / 1000), isNewMsg: true, type: 'chat',
            ...ephemeralFields, ...mediaOptions,
            ...(mediaInfo && content ? { caption: content } : {})
          };

          const msg = new window.Store.Msg.modelClass(message);
          const msgData = window.Store.SendChannelMessage.msgDataFromMsgModel(msg);
          const isMedia = mediaInfo != null;
          await window.Store.SendChannelMessage.addNewsletterMsgsRecords([msgData]);
          if (chat.msgs) chat.msgs.add(msg);
          if (chat.t !== undefined) chat.t = msg.t;

          const sendResponse = await window.Store.SendChannelMessage.sendNewsletterMessageJob({
            msg, type: message.type === 'chat' ? 'text' : isMedia ? 'media' : 'text',
            newsletterJid: chat.id.toJid(),
            ...(isMedia ? { mediaMetadata: msg.avParams(), mediaHandle } : {})
          });

          if (sendResponse.success) {
            msg.t = sendResponse.ack.t;
            msg.serverId = sendResponse.serverId;
          }
          msg.updateAck(1, true);
          await window.Store.SendChannelMessage.updateNewsletterMsgRecord(msg);

          return { success: true, serverId: sendResponse.serverId || null };
        } catch (err) {
          return { error: err.message || String(err) };
        }
      }, chatId, text, mediaData);

      if (sendResult && sendResult.error) {
        throw new Error(`Failed to send to channel: ${sendResult.error}`);
      }
    } else {
      if (mediaUrl || mediaBase64) {
        let media;
        if (mediaUrl) {
          // 🛡️ Sentinel: Prevent Server-Side Request Forgery (SSRF) when fetching media
          try {
            const parsedUrl = new URL(mediaUrl);
            if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
              throw new Error('Invalid URL protocol');
            }
            const forbiddenHosts = ['localhost', '127.0.0.1', '169.254.169.254', '[::1]', '0.0.0.0'];
            if (forbiddenHosts.includes(parsedUrl.hostname) || parsedUrl.hostname.endsWith('.local') || parsedUrl.hostname.startsWith('192.168.') || parsedUrl.hostname.startsWith('10.')) {
              throw new Error('Local or private IP addresses are not allowed');
            }
          } catch (e) {
            throw new Error(`Invalid mediaUrl: ${e.message}`);
          }
          media = await MessageMedia.fromUrl(mediaUrl).catch(e => {
            console.error('❌ Failed to fetch media from URL:', e.message);
            return null;
          });
        } else {
          media = new MessageMedia(mediaMimeType, mediaBase64, mediaName);
        }
        if (!media) {
          throw new Error('Failed to process media content');
        }
        await this.client.sendMessage(chatId, media, { ...sendOptions, caption: text || undefined });
      } else {
        await this.client.sendMessage(chatId, text, sendOptions);
      }
    }

    return { success: true, chatId, isNewsletter };
  }
}

module.exports = { WhatsAppAdapter };
