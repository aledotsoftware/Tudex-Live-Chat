## 2024-10-27 - Icon-only buttons lacking ARIA labels
**Learning:** Found several key interaction buttons in App.jsx (like 'Eliminar', 'Descartar', 'Mejorar redacción con IA', and 'Enviar original') that only had visual icons/emojis and `title` attributes, making them inaccessible to screen readers.
**Action:** Always verify that icon-only buttons have descriptive `aria-label` attributes, especially in chat interfaces where interactions are frequent.
## 2024-10-28 - ARIA labels for interactive text structures
**Learning:** Found that elements like `<article>` or `<span>` used with `role="button"` inside chat messages needed explicit accessible names, but adding `aria-label` entirely overrides the text content for screen readers, hiding the actual message content. Instead, using `aria-describedby` to link to an explicitly labelled structural element allows the screen reader to read both the message and the interaction hint.
**Action:** Use `aria-describedby` alongside `role="button"` on text-heavy elements to avoid overriding their inner content, ensuring both the text and the action context are accessible.
