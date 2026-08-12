# Business Rules - Ephemeral Public Statuses & Archiving

## 1. Overview
The Public Statuses domain manages 24-hour temporary posts (text, images, media) shared across the user community, including likes, view counters, and automated archive sweeping.

---

## 2. Core Business Rules

### BR-STAT-001: 24-Hour Ephemeral Expiry
- **Rule**: Every status update created via `/api/public-statuses` automatically receives an `expiresAt` timestamp set exactly 24 hours ($86,400\text{ seconds}$) after creation.
- **Behavior**: Queries to `/api/public-statuses` filter out any status records where `expiresAt < currentDate`.

### BR-STAT-002: Engagement Metrics (Likes & Views)
- **Rule**:
  - Each unique user can like a status update at most once. Re-posting `/like` toggles the like off (unlikes).
  - Viewing a status updates `viewsCount` atomically and records the viewing user ID to prevent duplicate view increments from the same user session.

### BR-STAT-003: Background Status Archive Sweeper Worker
- **Rule**: An automated polling task runs at configurable intervals (`STATUS_POLL_INTERVAL_MS`, default 60000ms) to clean active database storage.
- **Behavior**: Expired statuses (`expiresAt <= NOW`) are exported to JSON files in the `/status-archive/` filesystem directory, removed from active MongoDB collections, and logged in sweep statistics.
