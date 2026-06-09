## 2024-06-01 - Object Type Confusion / NoSQL injection prevention
**Vulnerability:** Unsanitized queries via Express query parser extended
**Learning:** By passing objects like ?api_key[$ne]=null, the query object allows bypass of findOne calls
**Prevention:** Always ensure parameters are stringified: `const token = String(req.query.api_key)`
