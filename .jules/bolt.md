## 2024-05-18 - Debounce search API calls
**Learning:** React components triggering API calls via `onChange` in this application often lack debouncing, leading to backend thrashing.
**Action:** Whenever adding or maintaining search/filtering text inputs that query external APIs, ensure a ~300ms debounce layer (e.g., via `setTimeout` and `useRef`) is applied.
