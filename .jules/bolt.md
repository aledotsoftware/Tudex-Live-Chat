## 2024-05-31 - [Mongoose Query Optimization]
**Learning:** Adding `.lean()` to Mongoose queries returns plain JavaScript objects, significantly reducing memory and CPU usage for read-only operations. In this application, read-only queries were returning full Mongoose documents needlessly.
**Action:** Always verify if a `.find()` operation needs to return full Mongoose documents. Use `.lean()` when documents are strictly meant for read-only serialization.

## 2024-06-18 - [Mongoose Compound Index for Followed Statuses]
**Learning:** Mongoose queries using `$in` operators combined with `.sort()` (e.g., fetching statuses from a list of followed users ordered by creation date) can result in highly inefficient full collection scans or unoptimized index scans followed by expensive in-memory sorting if an appropriate compound index is not present. Relying solely on a TTL index (like `createdAt: 1`) is insufficient for efficient targeted retrieval.
**Action:** Always ensure that queries combining user-specific filtering (especially array inclusion like `$in: followedIds`) with sorting have a matching compound index, such as `{ userId: 1, createdAt: -1 }`, to maintain fast read performance as the dataset grows.
