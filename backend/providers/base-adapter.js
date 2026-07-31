const { EventEmitter } = require('events');

class BaseAdapter extends EventEmitter {
  constructor(provider) {
    super();
    this.provider = String(provider || '').trim().toLowerCase();
    if (!this.provider) {
      throw new Error('Provider adapter requires a provider name');
    }
    this._isReady = false;
    this._status = 'initializing';

    this._bindDefaultEvents();
  }

  _bindDefaultEvents() {
    this.on('qr', () => {
      this._status = 'qr';
      this._isReady = false;
    });
    this.on('ready', () => {
      this._status = 'authenticated';
      this._isReady = true;
    });
    this.on('authenticated', () => {
      this._status = 'authenticated';
    });
    this.on('auth_failure', () => {
      this._status = 'auth_failure';
      this._isReady = false;
    });
    this.on('disconnected', () => {
      this._status = 'disconnected';
      this._isReady = false;
    });
  }

  getProviderName() {
    return this.provider;
  }

  initialize() {
    // default implementation is empty. override if needed.
  }

  isReady() {
    return this._isReady;
  }

  getStatus() {
    return this._status;
  }

  async listChats(_ctx) {
    throw new Error(`listChats() not implemented for provider=${this.provider}`);
  }

  async fetchMessages(_ctx) {
    throw new Error(`fetchMessages() not implemented for provider=${this.provider}`);
  }

  async markRead(_ctx) {
    throw new Error(`markRead() not implemented for provider=${this.provider}`);
  }

  async sendMessage(_ctx) {
    throw new Error(`sendMessage() not implemented for provider=${this.provider}`);
  }

  async getMessageById(messageId) {
    throw new Error(`getMessageById() not implemented for provider=${this.provider}`);
  }

  async fetchStatusDescriptors() {
    throw new Error(`fetchStatusDescriptors() not implemented for provider=${this.provider}`);
  }

  async markStatusRead() {
    throw new Error(`markStatusRead() not implemented for provider=${this.provider}`);
  }

  async downloadMedia(message) {
    throw new Error(`downloadMedia() not implemented for provider=${this.provider}`);
  }

  async getQuotedMessage(message) {
    throw new Error(`getQuotedMessage() not implemented for provider=${this.provider}`);
  }

  async getChatAvatarUrl(chat) {
    throw new Error(`getChatAvatarUrl() not implemented for provider=${this.provider}`);
  }

  async getChatByMessage(message) {
    throw new Error(`getChatByMessage() not implemented for provider=${this.provider}`);
  }

  isStatusMessage(message) {
    throw new Error(`isStatusMessage() not implemented for provider=${this.provider}`);
  }

  hasMedia(message) {
    throw new Error(`hasMedia() not implemented for provider=${this.provider}`);
  }

  hasQuotedMsg(message) {
    throw new Error(`hasQuotedMsg() not implemented for provider=${this.provider}`);
  }

  getChatIdFromMessage(message) {
    throw new Error(`getChatIdFromMessage() not implemented for provider=${this.provider}`);
  }

  extractMessageContext(message) {
    throw new Error(`extractMessageContext() not implemented for provider=${this.provider}`);
  }

  extractChatContext(chat) {
    throw new Error(`extractChatContext() not implemented for provider=${this.provider}`);
  }

  extractStatusDescriptor(message) {
    throw new Error(`extractStatusDescriptor() not implemented for provider=${this.provider}`);
  }
}

module.exports = { BaseAdapter };
