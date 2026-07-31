# Auditoría UX/UI y Plan de Mejora - Tapchat PWA

**Rol:** Senior UX/UI Auditor & Product Designer
**Objetivo:** Analizar el repositorio y generar un plan de mejora de 30 puntos accionables basado en el código actual.

---

## 1. Arquitectura de Información y Flujos

1. **Fricción en el Onboarding de API Key:** El prompt de API Key bloquea la UI sin dar contexto de qué es ni por qué se necesita.
   - **Solución:** Implementar un flujo de "Setup Wizard" que explique la necesidad de la Key de LM Studio/Cloudflare antes de pedir la sesión de WhatsApp.
2. **Pérdida de Contexto en Cambio de Chat:** Al cambiar de chat, el `loadingMessages` es global, lo que provoca que el usuario vea un estado de carga del chat anterior momentáneamente.
   - **Solución:** Indexar estados de carga por `chatId` en el frontend para evitar confusiones visuales.
3. **Flujo de Corrección IA Redundante:** Existen botones para "Corregir", "Corregir y enviar" y "Enviar original". Esto genera parálisis de decisión.
   - **Solución:** Unificar en un solo campo de texto con "Live Correction" (debounced) y un botón de acción principal dinámico.
4. **Inexistencia de Estados de Presencia:** El backend soporta `ChatState` (typing), pero el frontend no refleja si el interlocutor está escribiendo.
   - **Solución:** Mapear los eventos de socket `chat_state` a un indicador visual de "Escribiendo..." en el header del chat.
5. **Gestión de Borradores (Drafts) Volátiles:** Cambiar de chat borra el texto escrito en el composer si no se ha enviado.
   - **Solución:** Implementar un objeto `drafts` en el estado global (o localStorage) para persistir borradores por `chatId`.
6. **Navegación Vertical Infinita sin Virtualización:** No hay paginación real, cargando hasta 200 mensajes de golpe.
   - **Solución:** Implementar *Virtual Scroll* para mejorar el rendimiento del DOM en chats largos.
7. **Jerarquía de la Multi-Reply Panel:** La cola de respuestas sugeridas aparece sobre el composer, tapando los mensajes recientes.
   - **Solución:** Mover la cola de respuestas a un panel colapsable o un "Drawer" lateral.
8. **Búsqueda Limitada al Cache:** El buscador solo filtra la lista de chats ya cargada.
   - **Solución:** Añadir búsqueda del lado del servidor (backend) para encontrar chats y mensajes históricos en MongoDB.
9. **Confirmación de Sesión WhatsApp Ambigua:** El estado "ready" o "qr" no indica si la conexión es estable o intermitente.
   - **Solución:** Añadir un "Status Heartbeat" visual con latencia (ms) para dar feedback de calidad de conexión.
10. **Feedback de Sincronización de Fondo:** El texto "Sincronizando..." es muy discreto y el usuario no sabe cuánto falta.
    - **Solución:** Usar una barra de progreso sutil (2px) en el borde inferior del header durante la sincronización.

---

## 2. Interfaz Visual y Estética (UI)

11. **Inconsistencia en Glassmorphism:** Los blobs de fondo son modernos, pero los contenedores tienen bordes sólidos que rompen el estilo.
    - **Solución:** Aplicar `backdrop-filter: blur(20px)` y bordes semi-transparentes de forma sistémica.
12. **Tipografía y Legibilidad:** El tamaño de 15px en burbujas es insuficiente para lectura prolongada.
    - **Solución:** Aumentar a 16px con un `line-height` de 1.6 para mejorar la escaneabilidad.
13. **Paleta Cromática de la IA:** El púrpura de la IA choca con el azul cian de la aplicación.
    - **Solución:** Adoptar una paleta monocromática azul con efectos de "glow" para elementos potenciados por IA.
14. **Burbujas de Chat Rígidas:** El radio de borde no se adapta a mensajes consecutivos.
    - **Solución:** Implementar radios de borde condicionales (esquinas internas más agudas para mensajes agrupados).
15. **Indicadores de Estado de Mensaje (Acks):** No hay visualización de ticks (visto/enviado).
    - **Solución:** Integrar iconos de doble check basados en el estado `ack` del mensaje.
16. **Skeletons de Carga Inexistentes:** El texto "Cargando mensajes..." causa Layout Shift.
    - **Solución:** Reemplazar por *Skeleton Screens* que imiten la estructura de las burbujas.
17. **Avatares Genéricos de Baja Calidad:** Las iniciales sobre fondo plano carecen de estética moderna.
    - **Solución:** Usar gradientes generativos basados en el hash del `chatId`.
18. **Iconografía Mezclada:** Se usan emojis y texto en lugar de iconos consistentes.
    - **Solución:** Implementar una librería de iconos vectoriales (ej. Lucide) para todas las acciones.
19. **Contraste de Botones Secundarios:** Los botones oscuros sobre fondo oscuro son difíciles de ver.
    - **Solución:** Aumentar la opacidad del fondo y añadir bordes de acento al hover.
20. **Visualización de Errores Gramaticales:** El badge actual es demasiado grande y tapa contenido.
    - **Solución:** Usar subrayado ondulado rojo y mostrar la sugerencia en un Popover/Tooltip.

---

## 3. Accesibilidad y Usabilidad Técnica

21. **Contraste WCAG Fallido en Textos Muted:** El color `#78909c` no pasa el estándar AA en fondos oscuros.
    - **Solución:** Ajustar a un gris más claro (`#94a3b8`) para garantizar legibilidad.
22. **Foco de Navegación Invisible:** No hay estilos para `:focus-visible`.
    - **Solución:** Definir un anillo de foco claro de 2px en el color de acento.
23. **Falta de ARIA Labels:** Los botones con iconos o emojis no son descriptivos para lectores de pantalla.
    - **Solución:** Añadir `aria-label` descriptivos a todos los botones interactivos.
24. **Latencia Percibida en Envío:** El mensaje tarda en aparecer porque espera la confirmación del servidor.
    - **Solución:** Implementar *Optimistic UI* para mostrar el mensaje instantáneamente con un estado "enviando".
25. **Feedback de Error de IA Silencioso:** Fallos en LM Studio dejan al usuario esperando sin aviso.
    - **Solución:** Implementar un sistema de notificaciones (Toasts) para errores de timeout o red de la IA.
26. **Layout Responsive Deficiente:** La vista de escritorio forzada a móvil es difícil de navegar.
    - **Solución:** Implementar una vista de lista/detalle intercambiable para pantallas menores a 768px.
27. **Fugas de Memoria en Procesamiento de IA:** El useEffect de revisión gramatical no tiene limitadores de frecuencia adecuados.
    - **Solución:** Implementar un sistema de "Throttling" y limpiar la cola al desmontar componentes.
28. **Manejo de Imágenes Grandes:** Las imágenes en base64 sin optimizar ralentizan el scroll.
    - **Solución:** Implementar carga diferida (Lazy Loading) y placeholders de baja resolución.
29. **Timeout de IA Demasiado Largo:** 90 segundos es excesivo para una corrección de chat.
    - **Solución:** Reducir el timeout a 15s y ofrecer un modo "offline/rápido" si falla.
30. **Teclas de Acceso Rápido (Keyboard Shortcuts):** No hay forma de moverse entre chats sin usar el ratón.
    - **Solución:** Implementar `Ctrl+K` para buscador y `Alt+Up/Down` para cambiar de chat.

---

**Nota Final:** La prioridad debe ser la reducción de la fricción cognitiva en el proceso de corrección-envío, ya que es el valor diferencial del producto.
