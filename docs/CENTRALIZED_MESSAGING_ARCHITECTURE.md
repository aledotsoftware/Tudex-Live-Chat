# Centralized Messaging Architecture

## Objetivo
`frontend -> backend` debe ser rápido y estable siempre.  
La latencia del proveedor (`backend -> WhatsApp/Telegram/...`) se maneja asíncronamente.

## Fuente de verdad
El backend es la fuente de verdad operativa:
- Persistencia duradera en MongoDB (chats, mensajes, estado de sync).
- Cache L1 en memoria para respuestas de baja latencia.
- Normalización multicanal por `provider + accountId + conversationId`.

## Modelo canónico
Se incorporaron campos canónicos en `Chat` y `Message`:
- `provider`
- `accountId`
- `conversationId`
- `conversationKey`
- `providerMessageId` (mensajes)

Indices clave:
- `Message(provider, accountId, conversationId, timestamp desc)`
- `Message(provider, accountId, providerMessageId)` único
- `Chat(provider, accountId, timestamp desc)`
- `Chat(provider, accountId, conversationId)` único

## Read Path (rápido)
Endpoints:
- `GET /api/chats`
- `GET /api/chats/:chatId/messages`

Contrato nuevo:
- Devuelven `items` + `syncState` + metadata de cache.
- Nunca esperan al proveedor para responder.
- Encolan sync asíncrono (`stale-while-revalidate`).

## Sync asíncrono
Se agregó cola interna de sync:
- Dedupe por tarea (`kind + provider + accountId + conversationId`).
- Estados: `idle | queued | syncing | ok | error`.
- Persistencia en colección `SyncState`.
- Endpoint de inspección: `GET /api/sync/state`.

## Caching multinivel
### Backend
- L1 memoria:
  - `l1ChatsCache` con TTL corto
  - `l1MessagesCache` por conversación y límite
- L2 MongoDB:
  - datos persistentes normalizados

### Frontend
- Cache persistente en IndexedDB (`frontend/src/cacheStore.js`):
  - chats por `provider/accountId`
  - mensajes por conversación
- Estrategia:
  - pintar cache local primero
  - refrescar de backend en background

## Capa de proveedores
Se creó la base para múltiples canales:
- `backend/providers/base-adapter.js`
- `backend/providers/whatsapp-adapter.js`
- `backend/providers/provider-registry.js`

Estado actual:
- WhatsApp implementado.
- Otros proveedores deben implementar el contrato de adapter.

## Contrato para nuevos proveedores
Un adapter debe resolver:
- `isReady()`
- `getStatus()`
- `listChats()`
- `fetchMessages({ conversationId, limit })`
- `markRead({ conversationId })`

Con esto, el core puede agregar Telegram sin romper frontend.
