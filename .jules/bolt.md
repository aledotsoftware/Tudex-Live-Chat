## 2024-05-31 - [Mongoose Query Optimization]
**Learning:** Adding `.lean()` to Mongoose queries returns plain JavaScript objects, significantly reducing memory and CPU usage for read-only operations. In this application, read-only queries were returning full Mongoose documents needlessly.
**Action:** Always verify if a `.find()` operation needs to return full Mongoose documents. Use `.lean()` when documents are strictly meant for read-only serialization.

## 2024-06-20 - [Mongoose Compound Index Sorting]
**Learning:** When optimizing Mongoose queries, adding unindexed tie-breaker fields (e.g., `createdAt: -1`) to a query sorted by a partially matched index (e.g., `timestamp: -1`) triggers a slow, memory-intensive in-memory sort.
**Action:** Always ensure that `.sort()` parameters align perfectly with the trailing fields of the chosen compound index.
