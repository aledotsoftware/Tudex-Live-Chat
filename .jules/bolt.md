## 2024-05-31 - [Mongoose Query Optimization]
**Learning:** Adding `.lean()` to Mongoose queries returns plain JavaScript objects, significantly reducing memory and CPU usage for read-only operations. In this application, read-only queries were returning full Mongoose documents needlessly.
**Action:** Always verify if a `.find()` operation needs to return full Mongoose documents. Use `.lean()` when documents are strictly meant for read-only serialization.

## 2024-06-18 - [Mongoose Compound Index and Sort Optimization]
**Learning:** When sorting Mongoose query results, ensure that `.sort()` parameters align perfectly with the fields of the chosen compound index. Adding unindexed tie-breaker fields (e.g., `createdAt: -1`) to a query sorted by a partially matched index (e.g., `timestamp: -1`) will trigger a slow, memory-intensive in-memory sort.
**Action:** Always verify schema indexes match query filters AND sorts exactly. Avoid adding redundant secondary sort fields if they aren't part of the compound index to prevent forcing MongoDB to sort in-memory.

## 2026-06-26 - [Mongoose $in and Sort Optimization]
**Learning:** When using MongoDB/Mongoose queries that combine an `$in` filter with a `.sort()`, always add a compound index matching both the filtered and sorted fields to prevent slow, memory-intensive in-memory sorts.
**Action:** Add compound index like `{ field: 1, sortField: -1 }` whenever querying with `{ field: { $in: [...] } }` followed by `.sort({ sortField: -1 })`.
