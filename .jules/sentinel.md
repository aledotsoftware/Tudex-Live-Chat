## 2024-05-31 - [Fix NoSQL Injection in authentication]
**Vulnerability:** The Express middleware `authenticateUser` and Socket.IO `io.use` did not enforce that the auth token from user input (query param, header, or socket auth block) was a string. An attacker could pass a NoSQL payload (e.g., `?api_key[$ne]=1`), resulting in `token` becoming an object, bypassing truthy checks and risking NoSQL injection during `Session.findOne({ token })`.
**Learning:** In Node.js + MongoDB architectures, always cast unvalidated request properties (like `req.query`, `req.headers`, `socket.handshake`) to a primitive (e.g. String) before passing them to the database driver, to prevent Object Type Confusion/NoSQL injection.
**Prevention:** Strictly type check or cast the incoming parameters (`String(req.query.api_key)`) as part of a global validation strategy before using them in MongoDB operations.

## 2024-06-03 - [Fix Hardcoded Administrative Credentials]
**Vulnerability:** The Express authentication and socket.io connection middlewares were using a hardcoded password string (`'admin123'`) to create a default `admin` user if authentication succeeded using a legacy `API_KEY` but the admin user did not exist in the database.
**Learning:** Default, hardcoded credentials are a major vulnerability that often slip into fallback/bootstrap paths. An attacker who gains access or figures out the legacy access could potentially compromise the system further if the default password is never changed.
**Prevention:** Never use hardcoded static strings for fallback or administrative account passwords. Always generate secure random passwords (e.g., `crypto.randomBytes(16).toString('hex')`) during user initialization if they are auto-created, requiring manual reset if access is truly needed via the UI.

## 2024-06-14 - [Fix Object Type Confusion DoS in Crypto Module]
**Vulnerability:** The unvalidated `password` property from user input (e.g., `req.body.password`) was passed directly into the native Node.js `crypto.pbkdf2Sync` method. An attacker could pass a NoSQL payload object instead of a string, causing a `TypeError` in the native module and crashing the node process, resulting in a Denial of Service (DoS).
**Learning:** Native Node.js modules like `crypto` often lack the graceful error handling or implicit casting found in some higher-level frameworks. Feeding them unexpected object types (especially from unvalidated Express request payloads) can cause synchronous crashes that take down the entire server.
**Prevention:** Always explicitly cast unvalidated user input properties to primitives (e.g., `String(password)`) before passing them to native Node.js methods like `crypto`.

## 2024-06-25 - [Fix IDOR in provider context resolution]
**Vulnerability:** The `parseProviderContext` function allowed users to specify arbitrary `accountId` values via request parameters or body payload without validating authorization. This resulted in an Insecure Direct Object Reference (IDOR) where any authenticated user could act as another user.
**Learning:** In a multi-tenant or multi-account system, blindly trusting user-provided identifiers for sensitive actions (like fetching chats or sending messages) leads to authorization bypasses.
**Prevention:** Always enforce server-side authorization checks on resource identifiers provided by clients, ensuring the authenticated user has permission to access the requested resource. Override untrusted identifiers with authenticated session data where appropriate.

## 2024-10-25 - [Fix Broken Access Control in AI Config]
**Vulnerability:** The `PUT /api/ai/config` endpoint lacked admin authorization checks. Any authenticated user could modify global AI configuration settings, including base URLs and prompts, introducing Broken Access Control and Server-Side Request Forgery (SSRF) risks.
**Learning:** Global configuration endpoints must explicitly verify the user's role (e.g., `req.user.username === 'admin'`) rather than just relying on generic authentication middleware, to prevent unauthorized system-wide tampering.
**Prevention:** Always enforce role-based access control (RBAC) on endpoints that mutate global state or configure external integrations.

## 2024-07-02 - Redact sensitive internal URLs for non-admins
**Vulnerability:** Information leakage where internal AI service URLs (e.g., lmStudioBaseUrl) were exposed to non-admin users via read endpoints.
**Learning:** API read endpoints (`GET`) needed by the frontend often expose configuration data that must be explicitly filtered or redacted based on user roles, since non-admins need access to the endpoint but shouldn't see sensitive internal routing.
**Prevention:** Ensure the authorization condition fails closed for unauthenticated requests (e.g., `if (!req.user || req.user.username !== "admin")`) and explicitly overwrite sensitive properties with placeholder values (e.g., `********`) before returning the response payload.
