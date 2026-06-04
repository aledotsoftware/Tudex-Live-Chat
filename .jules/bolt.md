## 2024-11-20 - Debounce User Search API Calls
**Learning:** React components triggering API calls via `onChange` in this application often lack debouncing, leading to backend thrashing.
**Action:** Whenever adding or maintaining search/filtering text inputs that query external APIs, ensure a ~300ms debounce layer (e.g., via `setTimeout` and `useRef`) is applied to prevent excessive network requests and backend load.
