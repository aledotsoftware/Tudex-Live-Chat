# Business Rules - PWA Installation & Standalone Prompting

## 1. Overview
The PWA Domain governs Progressive Web App installation lifecycle management, standalone display mode verification, user engagement prompts for native desktop/mobile installation, and iOS Safari fallback instructions.

---

## 2. Core Business Rules

### BR-PWA-001: Standalone Environment Validation
- **Rule**: The application MUST detect whether it is currently executing within a standalone PWA container or a standard web browser context upon initialization.
- **Detection Criteria**:
  - `window.matchMedia('(display-mode: standalone)').matches === true`
  - `navigator.standalone === true` (iOS Safari Standalone Mode)
  - Document referrer matching `android-app://`
- **Behavior**: If standalone execution is confirmed, all installation prompt triggers and banners MUST be permanently suppressed.

### BR-PWA-002: PWA Installation Prompt Lifecycle
- **Rule**: When running in a non-standalone browser context, the application MUST capture the browser's native `beforeinstallprompt` event, prevent default browser bar pop-ups, and defer execution until the custom installation interface is invoked.
- **Behavior**:
  - Intercepts `beforeinstallprompt` and stores the deferred event reference in application state.
  - On Chromium/Android/Desktop: Clicking "Instalar PWA" triggers `deferredPrompt.prompt()`, captures the user choice (`accepted` or `dismissed`), and clears the stored event reference.
  - On iOS Safari (where `beforeinstallprompt` is unavailable): Displays targeted visual instructions ("Pulsa Compartir ⎋ y luego 'Agregar a inicio ⊕'").

### BR-PWA-003: Local Persistence & 1-Hour Recurrence Policy
- **Rule**: Dismissal or display timestamps MUST be persisted locally in `localStorage` (`tlc_pwa_prompt_last_shown`) to prevent user prompt fatigue while maintaining periodic engagement.
- **Recurrence Calculation**:
  $$\text{timeElapsed} = \text{Date.now()} - \text{Number}(\text{localStorage.getItem('tlc_pwa_prompt_last_shown') || 0})$$
  $$\text{RECURRENCE\_INTERVAL\_MS} = 3,600,000 \quad (1\text{ hour})$$
- **Behavior**:
  - If `timeElapsed < 3,600,000` (less than 1 hour since last shown/dismissed), the installation pop-up MUST remain hidden.
  - Once `timeElapsed >= 3,600,000` (1 hour of continuous or cumulative usage elapsed), the installation pop-up is surfaced.
  - Clicking "Más tarde" or closing the pop-up updates `localStorage.setItem('tlc_pwa_prompt_last_shown', String(Date.now()))` and hides the pop-up until the 1-hour window expires again.

### BR-PWA-004: Continuous Background Window Checking
- **Rule**: An active timer MUST check the 1-hour threshold every 60 seconds while the application tab remains open in the foreground (`document.visibilityState === 'visible'`).
- **Behavior**: If the 1-hour threshold is crossed during an extended active session, the pop-up gracefully animates into view without interrupting active input streams.

### BR-PWA-005: Account Settings PWA Status Card
- **Rule**: The "Mi Cuenta" (Account Settings) panel MUST render a dedicated PWA Installation status card matching the "Notificaciones del Sistema" design pattern.
- **Behavior**:
  - **If Installed (Standalone)**: Displays a green success indicator: `"Aplicación PWA instalada en este dispositivo"`.
  - **If Not Installed (Browser Context)**: Displays an installation invitation block with an `"Instalar PWA"` action button (or iOS Safari instructions) enabling the user to trigger device installation at any time.


