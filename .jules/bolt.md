## 2024-05-31 - [Mongoose Query Optimization]
**Learning:** Adding `.lean()` to Mongoose queries returns plain JavaScript objects, significantly reducing memory and CPU usage for read-only operations. In this application, read-only queries were returning full Mongoose documents needlessly.
**Action:** Always verify if a `.find()` operation needs to return full Mongoose documents. Use `.lean()` when documents are strictly meant for read-only serialization.
## 2024-05-31 - [React Rendering Optimization]
**Learning:** Extracting heavy inline mapping functions (like `messages.map` rendering complex message bubbles) into standalone components wrapped in `React.memo` significantly reduces unnecessary re-renders when the parent component's state changes. This is especially critical for large virtualized or lazy-loaded lists.
**Action:** Identify large array `.map` blocks rendering complex elements in frequently updated components, extract them into separate `React.memo` components, and ensure callback props are stable.
