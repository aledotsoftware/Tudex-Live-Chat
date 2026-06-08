## 2024-05-15 - NoSQL Regex Injection / ReDoS
**Vulnerability:** Unsanitized user input (`req.query.q`) was passed directly to a MongoDB `$regex` query in the `/api/users/search` endpoint.
**Learning:** This exposes the application to NoSQL Regex Injection and Regular Expression Denial of Service (ReDoS) attacks, where an attacker can supply malicious patterns causing high CPU usage or database scraping.
**Prevention:** Always escape user input before using it inside a `$regex` operator using a secure regex escaper: `string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`.
