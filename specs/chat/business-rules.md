# Business Rules - Messaging & Multi-Provider Integration

## 1. Overview
The Chat Domain manages incoming and outgoing messaging streams across integrated channels (such as WhatsApp Web, Live Chat, and AI Auto-Responder). It provides real-time updates via Socket.io and maintains speed optimizations through multi-tier caching (L1 Memory Cache & Database).

---

## 2. Core Business Rules

### BR-CHAT-001: Multi-Provider Abstraction
- **Rule**: Messaging operations MUST be routed through an abstract provider interface (`BaseAdapter`) managed by `ProviderRegistry`.
- **Behavior**: All message identifiers and payload schemas MUST be normalized to a unified contract (`id`, `chatId`, `senderId`, `text`, `timestamp`, `isIncoming`) regardless of the underlying messaging protocol.

### BR-CHAT-002: In-Memory L1 Caching & TTL Bounds
- **Rule**: Frequent chat lists and message history requests MUST utilize an in-memory L1 cache to minimize database load.
- **Behavior**:
  - `CHATS_CACHE_TTL_MS`: Default 5000ms.
  - `MESSAGES_CACHE_TTL_MS`: Default 5000ms.
  - Cache entries are invalidated immediately when a new message is dispatched or received for the affected conversation.

### BR-CHAT-003: Media Attachment Handling
- **Rule**: Media files sent via chat (images, audio notes, PDFs) MUST be stored in the designated media archive directory (`/media-archive/`).
- **Behavior**: Outbound base64 payloads MUST be sanitized, saved to filesystem disk with unique timestamp prefixes, and converted into static public URLs before dispatching to the provider client.

### BR-CHAT-004: AI Auto-Responder Lifecycle & Error Handling
- **Rule**: When AI Auto-responder mode is enabled for a conversation, incoming messages trigger background model inference (LM Studio or Cloudflare Workers AI).
- **Behavior**:
  - If inference succeeds, the generated reply is automatically dispatched to the channel recipient and broadcast via `new_message` Socket event.
  - If inference fails, an internal error notice is logged without crashing the server, and the conversation state is preserved cleanly.
