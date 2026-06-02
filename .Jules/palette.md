## 2024-06-02 - Missing ARIA Labels on Title-Only Emoji Buttons
**Learning:** Icon-only buttons in this app (especially those using emojis like `✨`, `❌`, `✕`) rely heavily on the `title` attribute for visual tooltips but omit `aria-label`, leading to inconsistent and poor screen reader experiences.
**Action:** When working on buttons in this repository, always ensure that if a `title` attribute is present for an icon or emoji button, a corresponding `aria-label` is also explicitly provided for screen readers.
