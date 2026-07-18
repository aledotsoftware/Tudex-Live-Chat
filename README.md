# 📱 Tudex Live Chat PWA

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-Supported-blue.svg)](https://www.docker.com/)
[![PWA](https://img.shields.io/badge/PWA-Installable-purple.svg)](https://web.dev/progressive-web-apps/)

**Tudex Live Chat** es un cliente independiente de mensajería (PWA) de alto rendimiento que emula y extiende las capacidades de una sesión de WhatsApp Web, actuando como un intermediario inteligente potenciado por Inteligencia Artificial (IA) local o en la nube. 

A diferencia de las herramientas de automatización tradicionales que editan o envían mensajes automáticamente (lo cual conlleva un alto riesgo de suspensión de cuenta), Tudex Live Chat sitúa al usuario en el centro del control: redactas tu mensaje, la IA analiza y genera sugerencias gramaticales y de estilo en tiempo real, y tú decides con un solo clic si enviar el texto original o la versión optimizada por IA.

---

## ✨ Características Principales

*   **🧠 Privacidad Total (IA Local o Nube Privada):** Soporte nativo para **LM Studio** para correr modelos de lenguaje localmente (Llama 3, Mistral, Gemma, etc.) en tu propia máquina sin que tus borradores o chats salgan a internet. También admite **Cloudflare AI Workers** para una nube distribuida y segura.
*   **🔒 Cifrado Extremo a Extremo (E2EE):** Motor criptográfico híbrido integrado (RSA-OAEP + AES-GCM) para asegurar la confidencialidad de tus mensajes e intercambio seguro de claves.
*   **📞 Llamadas VoIP y Compartir Pantalla:** Arquitectura de comunicación multimedia integrada mediante **WebRTC** y Socket.io, permitiendo llamadas de voz en tiempo real y transmisión de pantalla directa desde el navegador.
*   **⚡ Rendimiento Offline-First:** Caché multinivel estructurada. El frontend almacena chats, mensajes y archivos locales en **IndexedDB**, logrando tiempos de carga instantáneos, mientras que el backend maneja colas de sincronización asíncronas para evitar bloqueos del hilo principal.
*   **⭕ Archivado e Ingestión de Estados:** Monitoreo automatizado de estados (historias). El sistema marca como vistos y descarga el contenido multimedia en una base de datos local para consultarlos posteriormente desde el Sidebar.
*   **🔌 Extensibilidad Multicanal:** Diseñado con un registro central de adaptadores (`BaseAdapter`). Aunque WhatsApp está implementado por defecto a través de `whatsapp-web.js`, la arquitectura está lista para desplegar integraciones con Telegram u otros proveedores sin modificar el frontend.

---

## 🛠️ Stack Tecnológico

*   **Frontend:** React, Vite, Vanilla CSS, IndexedDB (PWA Ready, Service Workers con Workbox).
*   **Backend:** Node.js, Express, Socket.io, Mongoose (MongoDB).
*   **Integración WhatsApp:** `whatsapp-web.js` con sesión persistente (`LocalAuth`).
*   **IA de Asistencia:** LM Studio (API local) / Cloudflare AI Workers.
*   **Despliegue:** Docker y Docker Compose.

---

## 🚀 Instalación y Configuración Rápida

### Requisitos Previos

*   [Docker](https://www.docker.com/) y [Docker Compose](https://docs.docker.com/compose/) instalados.
*   (Opcional para IA local) [LM Studio](https://lmstudio.ai/) ejecutándose en tu máquina.

### Paso 1: Configurar la IA Local (LM Studio)

1. Abre **LM Studio** y descarga cualquier modelo ligero de texto (ej. `Llama 3.1 8B Instruct` o `Mistral 7B`).
2. Ve a la pestaña **AI Server** en el menú lateral.
3. Inicia el servidor local en el puerto `1234`.
4. Asegúrate de que el modelo esté cargado en la memoria de tu GPU/CPU.

### Paso 2: Desplegar la Infraestructura

Clona este repositorio y ejecuta el siguiente comando en la raíz del proyecto para construir y levantar los contenedores:

```bash
docker compose up --build
```

Esto desplegará de forma automática:
*   `tudex-live-chat-backend` en `http://localhost:3005` (servidor Express principal).
*   `tudex-live-chat-mongo` en `mongodb://localhost:27017` (base de datos MongoDB).
*   El frontend estático de producción servido y previsualizado por Vite en `http://localhost:8080`.

### Paso 3: Sincronizar WhatsApp

1. Abre tu navegador e ingresa a `http://localhost:8080`.
2. La interfaz te mostrará un código QR para vincular tu dispositivo.
3. Abre WhatsApp en tu teléfono móvil > **Dispositivos vinculados** > **Vincular un dispositivo** y escanea el código.
4. La sesión se guardará persistentemente en un volumen de Docker (`whatsapp_auth`) para evitar que tengas que volver a escanearlo tras reiniciar los servicios.

---

## 📐 Arquitectura del Sistema

El flujo de información está estructurado para maximizar el rendimiento percibido por el usuario mediante un modelo de caché multinivel de lectura rápida:

```text
========================================================================================
                               TUDEX LIVE CHAT SYSTEM
========================================================================================
[ 1. SIDEBAR (Izquierda / Principal) ]      | [ 2. CHAT PANEL (Derecha / Activo) ]
--------------------------------------------+-------------------------------------------
| HEADER:                                   | | HEADER:                                 |
| [ Título de Tab ] [🔄 Reload] [👤 Avatar]*| | [← Volver] [📁 Recursos] [🔄] [👤 Avatar]*|
|-------------------------------------------| |-----------------------------------------|
| STATUS BAR:                               | |                                         |
|  ● Conectado/Reconectando · Unread count  | | AREA DE MENSAJES (Burbujas en Cascada):  |
|-------------------------------------------| |  - [Burbuja Propia] ✓✓ (Leído)          |
| SEARCH / DISCOVERY:                       | |  - [Burbuja Remota] (Grammar check error)|
|  [ 🔍 Buscar chat o estado...  ]  [ ➕ ]  | |  - [Previsualización de Audio/Video/Img]|
|-------------------------------------------| |  - [Sugerencias en paralelo de la IA]   |
| CONTENT FEED AREA (Dinámico por Tab):     | |                                         |
|  - TAB CHATS: Lista de chats recientes    | |-----------------------------------------|
|  - TAB ESTADOS: Lista de estados archiv.  | | COMPOSER FOOTER (Creador de mensajes):  |
|  - TAB NOTIF: Alertas en segundo plano    | |  - [ Panel de Respuestas Paralelas ]    |
|-------------------------------------------| |  - [ Input de texto / borrador (Draft) ]|
| BOTTOM NAVIGATION BAR:                    | |  - [✨ Sugerencia] [📤 Enviar original]  |
|  [ ⭕ Estados ] [ 💬 Chats ] [ 🔔 Notif. ]| |                                         |
========================================================================================
*Nota: Al pulsar cualquier [👤 Avatar] (arriba a la derecha), se despliega el menú general.
```

Para más detalles técnicos de bajo nivel, consulta las guías en la carpeta `docs`:
*   [Arquitectura de Mensajería Centralizada](./docs/CENTRALIZED_MESSAGING_ARCHITECTURE.md)
*   [Esquema de Pantallas e Interfaz](./docs/INTERFACE_AND_CONFIG_SCHEMA.md)
*   [Manual de Operaciones y Runbook](./docs/OPERATIONS_RUNBOOK.md)

---

## 🔐 Cláusula de Soberanía y Ética (Nodo Soberano)

Como parte de nuestro compromiso con la descentralización, privacidad y la autogestión de la infraestructura, Tudex Live Chat adopta la siguiente política ética:

> [!IMPORTANT]
> **Responsabilidad del Nodo Soberano**
> Los administradores de cada nodo asumen un compromiso técnico y ético inquebrantable. Tienen estrictamente prohibido interceptar, analizar o monetizar el tráfico y los metadatos de su instancia. Deben garantizar el soporte absoluto para el cifrado extremo a extremo (E2EE), operar sobre infraestructura libre de dependencias corporativas y asegurar una federación transparente para no fragmentar la red.

---

## ⚙️ Variables de Entorno

Puedes configurar el comportamiento del servidor inyectando las siguientes variables de entorno a través del archivo `docker-compose.yml` o un archivo `.env` en el backend:

| Variable | Tipo / Valor por defecto | Descripción |
| :--- | :--- | :--- |
| `PORT` | `3005` | Puerto de escucha del backend de Express. |
| `MONGODB_URI` | `mongodb://mongo:27017/tudex_live_chat` | URI de conexión para la base de datos MongoDB. |
| `LM_STUDIO_URL` | `http://host.docker.internal:1234` | Endpoint base para el servidor de LM Studio. |
| `AI_PROVIDER` | `lmstudio` o `cloudflare` | Proveedor activo para la corrección de mensajes. |
| `CLOUDFLARE_ACCOUNT_ID`| String | ID de cuenta de Cloudflare (obligatorio si usas Cloudflare). |
| `CLOUDFLARE_API_TOKEN` | String | Token de API secreto para acceder a Cloudflare Workers AI. |
| `MODEL_NAME` | `llama-3.1-8b-instruct` | Nombre del modelo a utilizar para las sugerencias. |
| `AI_TEMPERATURE` | `0.7` | Grado de creatividad del modelo de lenguaje (`0.0` a `2.0`). |
| `AI_MAX_TOKENS` | `180` | Límite máximo de tokens en la respuesta corregida. |
| `AI_TIMEOUT_MS` | `15000` | Tiempo de espera máximo (ms) para las respuestas de la IA. |
| `STATUS_POLL_INTERVAL_MS`| `60000` | Frecuencia de revisión y guardado de nuevos estados de WhatsApp. |
| `API_KEY` | String | Clave para proteger los endpoints públicos (vacío para desactivar). |

---

## 📡 API de Integración Externa

Tudex Live Chat expone una API REST para poder publicar mensajes o imágenes en tus chats activos desde servicios o scripts externos (como bots o sistemas de alerta remotos).

### Enviar Mensaje

*   **Ruta:** `POST /api/send`
*   **Encabezados Requeridos:** `X-API-Key` (si la variable `API_KEY` está configurada).
*   **Cuerpo (JSON):**

```json
{
  "chatId": "1234567890@newsletter",
  "text": "🚀 Mensaje de notificación automática",
  "mediaUrl": "https://ejemplo.com/imagen.jpg"
}
```

### Ejemplo de uso con `curl`:

```bash
curl -X POST http://localhost:3005/api/send \
  -H "Content-Type: application/json" \
  -H "X-API-Key: tu_api_key_secreta" \
  -d '{
    "chatId": "54911xxxxxxx@c.us",
    "text": "Prueba de envío automático a través de la API externa."
  }'
```

---

## ⚖️ Licencia

Este proyecto está bajo la Licencia **MIT**. Consulta el archivo `LICENSE` para más detalles.
