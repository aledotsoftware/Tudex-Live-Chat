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

## 2024-06-20 - [Fix IDOR in Provider Context Parsing]
**Vulnerability:** The `parseProviderContext` function blindly trusted `req.query.accountId` and `req.body.accountId` over the authenticated user's ID (`req.user._id`). This allowed any authenticated user to pass another user's ID and read their local messages or send messages on their behalf (Impersonation/IDOR).
**Learning:** In applications where multi-tenancy or multi-provider contexts are parsed from user input (query/body), those inputs must be strictly authorized against the session's authenticated user identity.
**Prevention:** Always enforce authorization boundaries at the context-parsing level. Ensure that non-admin users can only resolve an `accountId` that belongs to them (or a globally permitted default) rather than blindly accepting input.
