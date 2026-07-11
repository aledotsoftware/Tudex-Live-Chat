## 2024-05-31 - [Mongoose Query Optimization]
**Learning:** Adding `.lean()` to Mongoose queries returns plain JavaScript objects, significantly reducing memory and CPU usage for read-only operations. In this application, read-only queries were returning full Mongoose documents needlessly.
**Action:** Always verify if a `.find()` operation needs to return full Mongoose documents. Use `.lean()` when documents are strictly meant for read-only serialization.
## 2024-05-31 - [Mongoose FindById Read-Only Optimization]
**Learning:** Even single-document lookups like `findById()` suffer from Mongoose hydration overhead if they return full Document objects instead of plain JS objects.
**Action:** When querying a single user or object strictly for reading specific fields (like `followedUsers` or `username`), always chain `.select("fields")` and `.lean()` to `.findById()` to bypass Document instantiation and drastically reduce memory footprint.
