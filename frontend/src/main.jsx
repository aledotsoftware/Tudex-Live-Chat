import React from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./App.css";

const updateSW = registerSW({
  onNeedRefresh() {
    window.dispatchEvent(new CustomEvent("pwa_update_available", { detail: { updateSW } }));
  },
  onOfflineReady() {
    console.log("Aplicación lista para trabajar sin conexión");
  },
  onRegisteredSW(swUrl, r) {
    if (r) {
      // Verificar actualizaciones cada 60 segundos
      setInterval(() => {
        r.update();
      }, 60 * 1000);

      // Verificar actualizaciones cuando la pestaña/app vuelve a estar visible
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          r.update();
        }
      });
    }
  },
});

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
