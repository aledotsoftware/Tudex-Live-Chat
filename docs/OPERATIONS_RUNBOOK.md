# Operations Runbook

## 1) Principios operativos
- El proveedor no está en el camino crítico de lectura.
- Todo `GET /api/chats` y `GET /api/chats/:chatId/messages` responde desde cache/persistencia.
- El refresh contra proveedor corre en background vía cola de sync.

## 2) Verificar estado general
- `GET /api/health`
- `GET /api/status`
- `GET /api/sync/state?provider=whatsapp&accountId=default&kind=chats`
- `GET /api/sync/state?provider=whatsapp&accountId=default&kind=messages&conversationId=<chatId>`

## 3) Contrato API para frontend
### Chats
`GET /api/chats?provider=whatsapp&accountId=default`

Respuesta:
```json
{
  "items": [],
  "provider": "whatsapp",
  "accountId": "default",
  "cache": { "level": "l1|mongo", "staleWhileRevalidate": true },
  "syncState": {}
}
```

### Mensajes
`GET /api/chats/:chatId/messages?provider=whatsapp&accountId=default`

Mismo formato (`items` + metadata).

### Read receipt
`POST /api/chats/:chatId/read?provider=whatsapp&accountId=default`

### Send
`POST /api/send` body incluye:
- `provider`
- `accountId`
- `chatId`
- `text`

## 4) Agregar nuevo proveedor (ejemplo Telegram)
1. Crear `backend/providers/telegram-adapter.js`.
2. Implementar métodos del `BaseAdapter`.
3. Registrar adapter en `ProviderRegistry`.
4. Usar `provider=telegram` en queries del frontend/API.
5. Mantener normalización canónica (`provider/accountId/conversationId`).

## 5) Objetivos de performance
- `GET /api/chats` p95 < 100ms en cache caliente.
- `GET /api/chats/:chatId/messages` p95 < 150ms en cache caliente.
- Apertura perceptual de chat < 200ms con IndexedDB + L1/L2.

## 6) Validation and Security
- `API_KEY`: Must be at least 8 characters long in production environments to avoid security warnings. Setting the `API_KEY` to an empty string (or completely omitting it in Docker/env deployments) will explicitly disable API authentication, triggering a severe security warning in the logs.
- **AI Configuration**: Values provided for `LM_STUDIO_URL` and `CLOUDFLARE_AI_BASE_URL` are strict-validated as proper URLs (must be `http:` or `https:`). If invalid at startup, they log a warning and fallback to safe defaults or empty strings. During runtime (`PUT /api/ai/config`), malformed URLs are explicitly rejected with a `400 Bad Request` error to prevent misconfiguration. Warnings will also log when `MODEL_NAME` or `CLOUDFLARE_*` properties are improperly configured at startup.
- **Timeouts/Intervals**: Limits are strictly enforced via `safeNumber()`. `AI_TIMEOUT_MS` is bounded between `1000` and `60000`. `STATUS_POLL_INTERVAL_MS` ensures a minimum of `1000` ms to prevent event loop starvation; if a non-numeric string is provided, it falls back to `60000` ms. If a value below `1000` ms is provided, it clamps to `1000` ms.
- **Cache & Fetch Limits**: Internal cache timeouts and fetching constraints (`AVATAR_TTL_MS`, `AVATAR_FETCH_LIMIT`, `AVATAR_FETCH_TIMEOUT_MS`, `CHATS_CACHE_TTL_MS`, `MESSAGES_CACHE_TTL_MS`) are also strictly validated using `safeNumber()`. If invalid or out of bounds, they log a warning and clamp to safe minimum/maximum values or fall back to defaults.
- **Advanced AI Tuning**: Advanced variables like `AI_TEMPERATURE` and `AI_MAX_TOKENS` are parsed and constrained to safe values (e.g. Temperature between `0` and `2`, Max Tokens between `1` and `8192`) via `safeNumber()` validation. Invalid numeric configs log a warning upon parsing.
