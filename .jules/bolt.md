## 2024-05-31 - [Mongoose Query Optimization]
**Learning:** Adding `.lean()` to Mongoose queries returns plain JavaScript objects, significantly reducing memory and CPU usage for read-only operations. In this application, read-only queries were returning full Mongoose documents needlessly.
**Action:** Always verify if a `.find()` operation needs to return full Mongoose documents. Use `.lean()` when documents are strictly meant for read-only serialization.

## 2024-06-18 - [Mongoose Compound Index for Followed Statuses]
**Learning:** Mongoose queries using `$in` operators combined with `.sort()` (e.g., fetching statuses from a list of followed users ordered by creation date) can result in highly inefficient full collection scans or unoptimized index scans followed by expensive in-memory sorting if an appropriate compound index is not present. Relying solely on a TTL index (like `createdAt: 1`) is insufficient for efficient targeted retrieval.
**Action:** Always ensure that queries combining user-specific filtering (especially array inclusion like `$in: followedIds`) with sorting have a matching compound index, such as `{ userId: 1, createdAt: -1 }`, to maintain fast read performance as the dataset grows.
## 2024-06-18 - [Mongoose Compound Index and Sort Optimization]
**Learning:** When sorting Mongoose query results, ensure that `.sort()` parameters align perfectly with the fields of the chosen compound index. Adding unindexed tie-breaker fields (e.g., `createdAt: -1`) to a query sorted by a partially matched index (e.g., `timestamp: -1`) will trigger a slow, memory-intensive in-memory sort.
**Action:** Always verify schema indexes match query filters AND sorts exactly. Avoid adding redundant secondary sort fields if they aren't part of the compound index to prevent forcing MongoDB to sort in-memory.

## 2026-06-26 - [Mongoose $in and Sort Optimization]
**Learning:** When using MongoDB/Mongoose queries that combine an `$in` filter with a `.sort()`, always add a compound index matching both the filtered and sorted fields to prevent slow, memory-intensive in-memory sorts.
**Action:** Add compound index like `{ field: 1, sortField: -1 }` whenever querying with `{ field: { $in: [...] } }` followed by `.sort({ sortField: -1 })`.
## 2024-06-25 - [Mongoose Compound Index for $in and .sort()]
**Learning:** When using MongoDB/Mongoose queries that combine an `$in` filter with a `.sort()`, always add a compound index matching both the filtered and sorted fields (e.g., `{ field1: 1, sortField: -1 }`) to prevent slow, memory-intensive in-memory sorts.
**Action:** Always verify schema indexes match query filters AND sorts exactly, especially for `$in` queries.
## 2024-07-25 - [Mongoose $in filter with sort Optimization]
**Learning:** When using MongoDB/Mongoose queries that combine an `$in` filter with a `.sort()`, always add a compound index matching both the filtered and sorted fields (e.g., `{ field1: 1, sortField: -1 }`) to prevent slow, memory-intensive in-memory sorts.
**Action:** Always verify if a compound index exists when using `$in` and `.sort()` together to prevent forcing MongoDB to sort in-memory.
## 2026-06-26 - [React Memoization for Inline Computations]
**Learning:** Heavy inline computations (like text sentiment analysis) inside mapped arrays of a frequently re-rendering component cause severe main thread blocking and typing lag. In this app, typing in the draft input re-rendered the entire `App` component, re-running O(chats * words) operations on every keystroke.
**Action:** Extract expensive inline computations rendered inside lists into separate components wrapped in `React.memo`, passing only the necessary primitive or memoized props to prevent recalculation on unrelated state updates.
## 2024-06-26 - [Intl.DateTimeFormat Instantiation Optimization]
**Learning:** Using `Date.prototype.toLocaleDateString` or `toLocaleString` inside loops or React render methods (like when mapping over thousands of chat messages) causes severe main thread blocking. This is because these methods silently instantiate a new `Intl.DateTimeFormat` object under the hood on every call, which is an extremely expensive operation in V8.
**Action:** Always extract and cache `Intl.DateTimeFormat` instances at the module level and reuse their `.format()` method when rendering lists of dates to achieve >100x speedups.
## $(date +%Y-%m-%d) - [Intl.DateTimeFormat Instantiation Optimization]
**Learning:** Using `Date.prototype.toLocaleTimeString` inside React render methods causes severe main thread blocking. This is because these methods silently instantiate a new `Intl.DateTimeFormat` object under the hood on every call, which is an extremely expensive operation in V8.
**Action:** Always extract and cache `Intl.DateTimeFormat` instances at the module level and reuse their `.format()` method when rendering dates/times.
## 2026-07-04 - [O(n) Array.indexOf Optimization in React Render]
**Learning:** Using `Array.prototype.indexOf` inside a `.map` function during React renders (like calculating original indices in a virtualized list) causes O(n^2) operations and severe main thread blocking for large arrays.
**Action:** Always replace O(n) lookups inside render loops with O(1) mathematical calculations based on the slice `startIndex` and map `idx` to prevent scroll jank.
## 2026-07-04 - [Regex Optimization for Frequent Array Rendering]
**Learning:** React components that perform string analysis (`.includes()`) over arrays inside their render body (like `ChatSentiment` checking positive/negative words) suffer from O(N) operations and array/string re-allocations on every single render.
**Action:** Always hoist static search arrays and replace iterative `.includes()` checks with a single pre-compiled module-level Regular Expression (`/word1|word2/gi`) and use `String.match()` to achieve O(1) instantiation and utilize the faster native regex engine.
