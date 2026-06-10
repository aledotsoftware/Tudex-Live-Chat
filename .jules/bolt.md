## 2024-05-31 - [Mongoose Query Optimization]
**Learning:** Adding `.lean()` to Mongoose queries returns plain JavaScript objects, significantly reducing memory and CPU usage for read-only operations. In this application, read-only queries were returning full Mongoose documents needlessly.
**Action:** Always verify if a `.find()` operation needs to return full Mongoose documents. Use `.lean()` when documents are strictly meant for read-only serialization.
## 2024-05-31 - [Debouncing Local Filter State in React]
**Learning:** In massive React components with multiple complex `useMemo` computations tied to a single input state, updating that state on every keystroke causes severe rendering jank.
**Action:** Always separate the visual input state from the filtering logic state using a debounce (e.g., `setTimeout` and `useRef`), and explicitly sync them via `useEffect` to handle external resets gracefully.
