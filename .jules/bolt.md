## 2024-05-31 - [Mongoose Query Optimization]
**Learning:** Adding `.lean()` to Mongoose queries returns plain JavaScript objects, significantly reducing memory and CPU usage for read-only operations. In this application, read-only queries were returning full Mongoose documents needlessly.
**Action:** Always verify if a `.find()` operation needs to return full Mongoose documents. Use `.lean()` when documents are strictly meant for read-only serialization.

## 2024-06-21 - [Mongoose Index Sort Alignment]
**Learning:** When sorting Mongoose query results, adding unindexed tie-breaker fields (like `createdAt: -1`) to a query sorted by a partially matched compound index forces MongoDB to perform a slow, memory-intensive in-memory sort.
**Action:** Always ensure that `.sort()` parameters align exactly with the trailing fields of the chosen compound index to avoid performance bottlenecks.
