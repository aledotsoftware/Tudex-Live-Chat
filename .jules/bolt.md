## 2024-05-24 - Missing debouncing in React API text inputs
**Learning:** React components triggering API calls via `onChange` in this application (like the user directory search) often lack debouncing, leading to backend thrashing when users type quickly.
**Action:** Whenever adding or maintaining search/filtering text inputs that query external APIs, ensure a ~300ms debounce layer (e.g., via `setTimeout` and `useRef`) is applied to prevent unnecessary requests.
