## 2024-06-01 - Missing Debouncing on Search User Inputs
**Learning:** React components containing text inputs triggering API calls (`loadDirectoryUsers` via `onChange`) in this specific architecture lacked `debouncing`. Consequently, fast-typing users were queuing numerous sequential REST calls, causing backend strain and frontend stuttering.

**Action:** Whenever adding or maintaining search/filtering text inputs that query external APIs (like users, messages, or states), ensure a debounce layer (e.g., via `setTimeout` and `useRef`) is applied with roughly a ~300ms delay to batch requests and prevent unnecessary thrashing.
