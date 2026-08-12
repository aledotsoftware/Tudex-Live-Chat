import React, { useEffect, useState } from 'react';

const RECURRENCE_INTERVAL_MS = 3600000; // 1 hour
const STORAGE_KEY = 'tlc_pwa_prompt_last_shown';

export function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    // BR-PWA-001: Standalone Environment Validation
    const checkStandalone = () => {
      const isStandaloneMedia = window.matchMedia('(display-mode: standalone)').matches;
      const isStandaloneNavigator = window.navigator.standalone === true;
      const isAndroidApp = document.referrer.startsWith('android-app://');
      return isStandaloneMedia || isStandaloneNavigator || isAndroidApp;
    };

    const standalone = checkStandalone();
    setIsStandalone(standalone);

    if (standalone) return;

    // iOS Safari detection
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIosDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIos(isIosDevice);

    // BR-PWA-003 & BR-PWA-004: Recurrence Calculation & Window Check
    const evaluatePromptEligibility = (eventObj = null) => {
      if (checkStandalone()) return;

      const lastShown = Number(localStorage.getItem(STORAGE_KEY) || 0);
      const timeElapsed = Date.now() - lastShown;

      if (timeElapsed >= RECURRENCE_INTERVAL_MS) {
        if (eventObj || isIosDevice) {
          setIsVisible(true);
        }
      }
    };

    // BR-PWA-002: Capture beforeinstallprompt
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      window.deferredPwaPrompt = e;
      setDeferredPrompt(e);
      evaluatePromptEligibility(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // Initial check on mount
    evaluatePromptEligibility();

    // BR-PWA-004: Periodic background check every 60 seconds
    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible') {
        evaluatePromptEligibility(deferredPrompt);
      }
    }, 60000);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      clearInterval(intervalId);
    };
  }, [deferredPrompt]);

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
    setIsVisible(false);
  };

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`[PWA Install] Choice outcome: ${outcome}`);
      setDeferredPrompt(null);
    }
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
    setIsVisible(false);
  };

  if (isStandalone || !isVisible) return null;

  return (
    <div
      role="dialog"
      aria-label="Instalar Tudex Live Chat PWA"
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 9999,
        maxWidth: '380px',
        width: 'calc(100vw - 48px)',
        animation: 'pwaSlideUp 0.4s cubic-bezier(0.32, 0.72, 0, 1)'
      }}
    >
      {/* Outer Shell - Doppelrand Architecture */}
      <div style={{
        padding: '6px',
        borderRadius: '24px',
        background: 'rgba(255, 255, 255, 0.05)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.6)'
      }}>
        {/* Inner Core */}
        <div style={{
          padding: '20px',
          borderRadius: '18px',
          background: 'linear-gradient(135deg, #111827 0%, #0b0f17 100%)',
          boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.12)',
          border: '1px solid rgba(255, 255, 255, 0.04)'
        }}>
          {/* Header & Icon */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{
                width: '42px',
                height: '42px',
                borderRadius: '14px',
                background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(2, 132, 199, 0.3)'
              }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              </div>
              <div>
                <span style={{ fontSize: '0.65rem', uppercase: 'true', letterSpacing: '0.15em', fontWeight: '700', color: '#38bdf8', display: 'block' }}>
                  EXPERIENCIA PWA
                </span>
                <h4 style={{ margin: '2px 0 0 0', fontSize: '1rem', fontWeight: '700', color: '#f8fafc', fontFamily: 'var(--font-heading)' }}>
                  Instalar Tudex Live Chat
                </h4>
              </div>
            </div>

            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Cerrar aviso"
              style={{
                background: 'rgba(255, 255, 255, 0.06)',
                border: 'none',
                color: '#94a3b8',
                borderRadius: '50%',
                width: '28px',
                height: '28px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', lineHeight: '1.45', margin: '0 0 16px 0' }}>
            Accede instantáneamente desde tu pantalla de inicio con notificaciones nativas en segundo plano y menor consumo de datos.
          </p>

          {isIos ? (
            <div style={{
              fontSize: '0.78rem',
              color: '#38bdf8',
              background: 'rgba(2, 132, 199, 0.1)',
              padding: '8px 12px',
              borderRadius: '10px',
              border: '1px solid rgba(2, 132, 199, 0.2)',
              marginBottom: '14px',
              lineHeight: '1.35'
            }}>
              Para instalar en iOS: Pulsa <strong>Compartir</strong> ⎋ y selecciona <strong>"Agregar a inicio"</strong> ⊕.
            </div>
          ) : !deferredPrompt ? (
            <div style={{
              fontSize: '0.78rem',
              color: '#38bdf8',
              background: 'rgba(2, 132, 199, 0.1)',
              padding: '8px 12px',
              borderRadius: '10px',
              border: '1px solid rgba(2, 132, 199, 0.2)',
              marginBottom: '14px',
              lineHeight: '1.35'
            }}>
              En Linux / Escritorio: Hacé clic en el icono <strong>⊕</strong> de la barra de direcciones o en el menú <strong>⋮ &gt; Instalar Tudex Social</strong>.
            </div>
          ) : null}

          {/* Action Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              type="button"
              onClick={deferredPrompt ? handleInstallClick : handleDismiss}
              style={{
                flex: 1,
                padding: '10px 16px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                color: '#ffffff',
                fontWeight: '700',
                fontSize: '0.88rem',
                border: 'none',
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(2, 132, 199, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                transition: 'transform 0.15 ease, boxShadow 0.15s ease'
              }}
            >
              <span>{deferredPrompt ? 'Instalar PWA' : 'Entendido'}</span>
              <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </div>
            </button>

            <button
              type="button"
              onClick={handleDismiss}
              style={{
                padding: '10px 16px',
                borderRadius: '12px',
                background: 'rgba(255, 255, 255, 0.05)',
                color: 'var(--text-secondary)',
                fontWeight: '600',
                fontSize: '0.88rem',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                cursor: 'pointer',
                transition: 'background 0.2s ease'
              }}
            >
              Más tarde
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
