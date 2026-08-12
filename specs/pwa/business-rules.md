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

### BR-PWA-002: PWA Installation Prompt Lifecycle & Cross-Platform Support
- **Rule**: The PWA installer MUST be functional and accessible across all operating systems (Linux, Windows, macOS, Android, and iOS).
- **Behavior & OS-Specific Execution**:
  - **Linux / Windows / macOS (Chromium: Chrome, Brave, Edge, Opera)**: Captures `beforeinstallprompt`. Invoking `deferredPrompt.prompt()` opens the OS native desktop installation dialog (creating a `.desktop` shortcut on Linux systems like Ubuntu, Fedora, Arch, etc.).
  - **Fallback Instructions (Desktop Linux/Windows/macOS)**: If `beforeinstallprompt` is pending or unsupported by the browser (e.g. Firefox Desktop), the interface displays step-by-step guidance: *"En Chrome / Edge / Brave: Hacé clic en el icono ⊕ (barra de navegación) o en el menú ⋮ > 'Instalar aplicación'"*.
  - **Android (Chrome/Edge/Brave/Firefox Mobile)**: Triggers the native Android APK/PWA web app installation prompt.
  - **iOS Safari (iPhone / iPad)**: Displays targeted iOS instructions: *"Pulsa Compartir ⎋ y selecciona 'Agregar a inicio ⊕'"*.

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
- **Rule**: The "Mi Cuenta" (Account Settings) panel MUST render a dedicated PWA Installation status card matching the "Notificaciones del Sistema" design pattern, functional on Linux, Windows, macOS, Android, and iOS.
- **Behavior**:
  - **If Installed (Standalone Mode)**: Displays a green success indicator: `"Aplicación PWA instalada en este dispositivo"`.
  - **If Not Installed (Browser Mode)**: Displays an installation invitation block with an `"Instalar PWA"` action button that executes `deferredPrompt.prompt()` (or surfaces Linux/Desktop/iOS guidance if `beforeinstallprompt` is pending).


