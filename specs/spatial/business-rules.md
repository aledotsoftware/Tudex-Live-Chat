# Business Rules - Spatial & Proximity Services

## 1. Overview
The Spatial & Proximity domain provides real-time location tracking and distance-based user discovery using standard geographical formulas (Haversine algorithm).

---

## 2. Core Business Rules

### BR-GEO-001: Distance Calculation Standard
- **Rule**: All proximity queries MUST use the spherical Haversine formula assuming Earth radius $R = 6371\text{ km}$.
- **Formula**:
  $$\text{distance} = 2 R \cdot \arcsin\left(\sqrt{\sin^2\left(\frac{\Delta \phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta \lambda}{2}\right)}\right)$$
- **Behavior**: Distances returned in API payloads are rounded to 2 decimal places in kilometers.

### BR-GEO-002: Privacy Protection & Location Blurring
- **Rule**: Precise GPS coordinates MUST NOT be exposed directly to other users over public APIs.
- **Behavior**: Nearby user discovery endpoints return relative distance in kilometers and optional randomized display offsets, protecting absolute physical coordinates.

### BR-GEO-003: Social Graph & Follow Status
- **Rule**: Users can follow or unfollow other accounts to prioritize their status updates on the proximity feed.
- **Behavior**: Following a user is idempotent. Unfollowing a user removes them from the user's `followedUsers` collection without affecting message history.
