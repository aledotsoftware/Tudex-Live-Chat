## 2024-05-31 - [Fix NoSQL Injection in authentication]
**Vulnerability:** The Express middleware `authenticateUser` and Socket.IO `io.use` did not enforce that the auth token from user input (query param, header, or socket auth block) was a string. An attacker could pass a NoSQL payload (e.g., `?api_key[$ne]=1`), resulting in `token` becoming an object, bypassing truthy checks and risking NoSQL injection during `Session.findOne({ token })`.
**Learning:** In Node.js + MongoDB architectures, always cast unvalidated request properties (like `req.query`, `req.headers`, `socket.handshake`) to a primitive (e.g. String) before passing them to the database driver, to prevent Object Type Confusion/NoSQL injection.
**Prevention:** Strictly type check or cast the incoming parameters (`String(req.query.api_key)`) as part of a global validation strategy before using them in MongoDB operations.

## 2024-06-10 - [Fix weak password hashing iterations and prevent DoS]
**Vulnerability:** The application used `crypto.pbkdf2Sync` with only 1000 iterations for hashing passwords. The iterations count was very weak. Increasing the iterations to a secure value (e.g. 600,000) while using a synchronous function blocked the Node.js event loop, creating a Denial of Service (DoS) vulnerability.
**Learning:** Always use asynchronous cryptography functions (`crypto.pbkdf2` instead of `crypto.pbkdf2Sync`) when applying computationally heavy operations like secure password hashing.
**Prevention:** Ensured `hashPassword` and `verifyPassword` are async functions and that all call-sites properly `await` them. Upgraded PBKDF2 to 600,000 iterations and added backwards compatibility for legacy hashes by parsing the `iterations:salt:hash` format.
