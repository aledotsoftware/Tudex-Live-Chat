# Business Rules - Authentication & Central Identity (Tudex Passport OIDC)

## 1. Scope & Domain Context
Tudex Live Chat relies strictly on **Tudex Passport** (OIDC SSO) as its single source of truth for user authentication and identity credentials. Local password registration and password-based login endpoints are deprecated and disabled to enforce centralized security.

---

## 2. Core Business Rules

### BR-AUTH-001: Central Identity Enforcement
- **Rule**: All user authentication MUST take place via Tudex Passport OIDC flow.
- **Behavior**: Calls to `/api/auth/register` or `/api/auth/login` MUST return HTTP 400 Bad Request instructing the client to authenticate via Tudex Passport.

### BR-AUTH-002: OIDC State Validation & Anti-CSRF
- **Rule**: Every authorization code request MUST generate a cryptographically secure random `state` token cached server-side with expiration.
- **Behavior**: The `/api/auth/oidc/callback` endpoint MUST verify that the incoming `state` parameter matches the active session state before exchanging the code for tokens. If mismatched or missing, authentication fails immediately with HTTP 400.

### BR-AUTH-003: User Profile Provisioning & Normalization
- **Rule**: Upon initial OIDC authentication, if no local user account exists for the given `oidcSub` or `email`, a new user record MUST be provisioned automatically.
- **Normalizations**:
  - `email`: Normalized to lowercase and trimmed. If omitted by the identity provider, defaults to `{oidcSub}@passport.tudexnetworks.com`.
  - `username`: Derived from `preferred_username` or email prefix, stripped of non-alphanumeric characters (except `_` and `-`). If duplicate username exists, a 3-digit random suffix is appended (`username_123`).
  - `avatarColor`: Assigned a random HSL color (`hsl(0-360, 70%, 40%)`) upon creation.

### BR-AUTH-004: Session Lifecycle & Invalidation
- **Rule**: Sessions are represented by cryptographically generated tokens persisted in MongoDB with explicit `expiresAt` timestamps.
- **Behavior**:
  - On `/api/auth/oidc/logout`, the server invalidates the active database session record and returns the OIDC `endSessionUrl`.
  - Stale or expired session tokens are rejected by `/api/check-auth` with HTTP 401 Unauthenticated.
