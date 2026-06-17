## 2024-10-27 - Icon-only buttons lacking ARIA labels
**Learning:** Found several key interaction buttons in App.jsx (like 'Eliminar', 'Descartar', 'Mejorar redacción con IA', and 'Enviar original') that only had visual icons/emojis and `title` attributes, making them inaccessible to screen readers.
**Action:** Always verify that icon-only buttons have descriptive `aria-label` attributes, especially in chat interfaces where interactions are frequent.

## 2024-10-28 - Stale Closures in Global Event Listeners
**Learning:** Found that the global `Escape` key handler in `App.jsx` failed to close several modals because its `useEffect` dependency array was missing the corresponding state variables (`showNewChatModal`, `showNewStatusModal`, etc.), causing a stale closure where the listener always saw the initial `false` state.
**Action:** Always verify that React `useEffect` hooks attaching global event listeners (like keyboard shortcuts) include all referenced state variables in their dependency arrays to ensure the listener accesses the current state.
