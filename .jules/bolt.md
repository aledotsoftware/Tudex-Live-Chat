## 2024-05-31 - [Mongoose Query Optimization]
**Learning:** Adding `.lean()` to Mongoose queries returns plain JavaScript objects, significantly reducing memory and CPU usage for read-only operations. In this application, read-only queries were returning full Mongoose documents needlessly.
**Action:** Always verify if a `.find()` operation needs to return full Mongoose documents. Use `.lean()` when documents are strictly meant for read-only serialization.

## 2024-06-18 - [Mongoose Compound Index and Sort Optimization]
**Learning:** When sorting Mongoose query results, ensure that `.sort()` parameters align perfectly with the fields of the chosen compound index. Adding unindexed tie-breaker fields (e.g., `createdAt: -1`) to a query sorted by a partially matched index (e.g., `timestamp: -1`) will trigger a slow, memory-intensive in-memory sort.
**Action:** Always verify schema indexes match query filters AND sorts exactly. Avoid adding redundant secondary sort fields if they aren't part of the compound index to prevent forcing MongoDB to sort in-memory.

## 2024-07-25 - [Mongoose $in filter with sort Optimization]
**Learning:** When using MongoDB/Mongoose queries that combine an `$in` filter with a `.sort()`, always add a compound index matching both the filtered and sorted fields (e.g., `{ field1: 1, sortField: -1 }`) to prevent slow, memory-intensive in-memory sorts.
**Action:** Always verify if a compound index exists when using `$in` and `.sort()` together to prevent forcing MongoDB to sort in-memory.
## 2026-06-26 - [React Memoization for Inline Computations]
**Learning:** Heavy inline computations (like text sentiment analysis) inside mapped arrays of a frequently re-rendering component cause severe main thread blocking and typing lag. In this app, typing in the draft input re-rendered the entire `App` component, re-running O(chats * words) operations on every keystroke.
**Action:** Extract expensive inline computations rendered inside lists into separate components wrapped in `React.memo`, passing only the necessary primitive or memoized props to prevent recalculation on unrelated state updates.
