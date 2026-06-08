## 2024-06-08 - Debounce Directory Search API Calls
**Learning:** React components that trigger API calls via `onChange` events can easily overwhelm the backend and cause "API thrashing" if not debounced.
**Action:** When adding or maintaining search/filtering inputs that make backend requests, always wrap the call in a ~300ms `setTimeout` with `clearTimeout` caching in a `useRef`.
