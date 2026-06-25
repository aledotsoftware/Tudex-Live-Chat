## 2024-05-31 - [Mongoose Query Optimization]
**Learning:** Adding `.lean()` to Mongoose queries returns plain JavaScript objects, significantly reducing memory and CPU usage for read-only operations. In this application, read-only queries were returning full Mongoose documents needlessly.
**Action:** Always verify if a `.find()` operation needs to return full Mongoose documents. Use `.lean()` when documents are strictly meant for read-only serialization.

## 2024-05-31 - [MongoDB Compound Indexing for $in + sort]
**Learning:** When using Mongoose queries that combine an $in filter with a .sort(), MongoDB performs slow, memory-intensive in-memory sorts unless a compound index covers both fields.
**Action:** Always add a compound index matching both the filtered and sorted fields (e.g., { field1: 1, sortField: -1 }).
