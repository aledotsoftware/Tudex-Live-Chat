class ProviderRegistry {
  constructor() {
    this.adapters = new Map();
  }

  register(adapter) {
    const name = adapter.getProviderName();
    this.adapters.set(name, adapter);
    return adapter;
  }

  resolve(provider) {
    const key = String(provider || '').trim().toLowerCase();
    const adapter = this.adapters.get(key);
    if (!adapter) {
      throw new Error(`Provider adapter not found: ${provider}`);
    }
    return adapter;
  }

  listProviders() {
    return Array.from(this.adapters.keys());
  }

  initializeAll() {
    for (const [name, adapter] of this.adapters.entries()) {
      try {
        if (!adapter.isReady()) {
          console.log(`🚀 Initializing provider adapter: ${name}...`);
          adapter.initialize();
        }
      } catch (err) {
        console.error(`❌ Failed to initialize provider ${name}:`, err.message);
      }
    }
  }

  initializeProvider(providerName) {
    const adapter = this.resolve(providerName);
    if (!adapter.isReady()) {
      console.log(`🚀 Initializing provider adapter: ${providerName}...`);
      adapter.initialize();
    }
  }
}

module.exports = { ProviderRegistry };
