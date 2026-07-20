# Tudex Live Chat

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-Supported-blue.svg)](https://www.docker.com/)
[![PWA](https://img.shields.io/badge/PWA-Installable-purple.svg)](https://web.dev/progressive-web-apps/)

**Tudex Live Chat ** es una plataforma de mensajería soberana y descentralizada de alto rendimiento en formato Progressive Web App (PWA). Diseñado para operar sobre infraestructura independiente y libre de corporaciones, Tudex sitúa el control absoluto de los datos, el cifrado y la gobernanza en manos de la comunidad.

A través de un modelo de federación transparente y cifrado extremo a extremo (E2EE), Tudex conecta a personas, comunidades y organizaciones garantizando total confidencialidad y autonomía tecnológica, libre de dependencias o vigilancias comerciales.

---

## 🏛️ Pilares del Proyecto

*   **🌐 Descentralización & Federación Transparente:** La red de Tudex no depende de un servidor central ni de un único proveedor corporativo. Cualquier persona u organización puede levantar su propio nodo Tudex. Estos nodos se comunican e intercambian mensajes entre sí de manera abierta y transparente, tejiendo una red global, distribuida y altamente resiliente.
*   **🔒 Cifrado Extremo a Extremo (E2EE):** Seguridad criptográfica garantizada. Los mensajes se cifran en el dispositivo de origen (frontend) utilizando un motor híbrido robusto (RSA-OAEP + AES-GCM) y solo el destinatario legítimo posee las claves para descifrarlos. Ningún nodo intermediario ni administrador puede acceder al contenido de tus conversaciones.
*   **🧠 Privacidad Total con IA Soberana:** Soporte nativo para asistentes de IA de manera 100% local a través de **LM Studio** (Llama, Mistral, Gemma, etc.) o en una nube distribuida y segura mediante **Cloudflare AI Workers**. Tus borradores, correcciones y sugerencias se procesan dentro de tu propia infraestructura, asegurando que tus textos nunca sean expuestos a terceros.
*   **⚙️ Infraestructura Libre de Dependencias Corporativas:** Diseñado para ejecutarse íntegramente sobre hardware independiente (VPS, servidores comunitarios o hardware local) mediante contenedores Docker. Sin APIs comerciales obligatorias, sin suscripciones a Big Tech y sin el riesgo de suspensión de cuentas por decisiones unilaterales corporativas.
*   **👥 Gobernanza y Comunidad:** Tudex es software libre creado por y para la comunidad. Promovemos un modelo donde cada comunidad gestiona su propio nodo, define de manera transparente sus políticas internas de convivencia y contribuye a la mejora del protocolo general en condiciones de igualdad.

---

## 🛠️ Stack Tecnológico

*   **Frontend:** React, Vite, Vanilla CSS, IndexedDB (PWA Ready, Service Workers con Workbox).
*   **Backend:** Node.js, Express, Socket.io, Mongoose (MongoDB).
*   **Federación y Red:** Protocolo de mensajería federado sobre WebSockets y comunicación de nodo a nodo (P2P/Federated).
*   **Seguridad:** Motor criptográfico híbrido local (RSA-OAEP + AES-GCM) para intercambio seguro de claves e inicio de sesión criptográfico.
*   **IA de Asistencia:** LM Studio (API local) / Cloudflare AI Workers.
*   **Despliegue:** Docker y Docker Compose.

---

## 🚀 Instalación y Despliegue de un Nodo Soberano

### Requisitos Previos

*   [Docker](https://www.docker.com/) y [Docker Compose](https://docs.docker.com/compose/) instalados.
*   (Opcional) [LM Studio](https://lmstudio.ai/) ejecutándose en tu máquina para soporte de IA local.

### Paso 1: Configurar la IA Local (Opcional)

1. Abre **LM Studio** y descarga cualquier modelo ligero de texto (ej. `Llama 3.1 8B Instruct` o `Mistral 7B`).
2. Ve a la pestaña **AI Server** e inicia el servidor local en el puerto `1234`.
3. Asegúrate de que el modelo esté cargado en la memoria de tu GPU/CPU.

### Paso 2: Desplegar la Infraestructura del Nodo

Clona este repositorio y ejecuta el siguiente comando en la raíz del proyecto para construir y levantar los contenedores de tu nodo:

```bash
docker compose up --build
```

Esto desplegará de forma automática:
*   `tudex-live-chat-backend` en `http://localhost:3005` (servidor Express principal de tu nodo).
*   `tudex-live-chat-mongo` en `mongodb://localhost:27017` (base de datos local del nodo).
*   El frontend estático de producción de Tudex en `http://localhost:8080`.

### Paso 3: Inicializar tu Cuenta y unirse a la Federación

1. Abre tu navegador en `http://localhost:8080`.
2. Crea tu par de claves criptográficas y perfil local (se almacenará de forma segura en tu navegador usando **IndexedDB**).
3. Tu nodo Tudex se enlazará automáticamente a la red federada pública o a los nodos configurados en tu archivo de entorno, permitiendo descubrir chats y canales comunitarios de forma transparente.

---

## 📐 Arquitectura del Nodo Federado

La arquitectura de Tudex está diseñada para maximizar el rendimiento mediante IndexedDB en el cliente y sincronización asíncrona federada en el backend:

```text
========================================================================================
                               TUDEX FEDERATED NODE ARCHITECTURE
========================================================================================
[ NODO LOCAL (Tudex Backend) ]               | [ RED FEDERADA (Otros Nodos Tudex) ]
--------------------------------------------+-------------------------------------------
| - Servicio de Mensajería y Colas          | | - Enlace WebSocket de Nodo a Nodo        |
| - Base de datos local (MongoDB)           | | - Descubrimiento de Nodos y Canales      |
| - Integración IA Local / Nube Privada     | | - Transmisión de Mensajes Cifrados       |
|-------------------------------------------| |-----------------------------------------|
| [ CLIENTE PWA (Navegador / IndexedDB) ]    |                                           |
|  - Cifrado E2EE local (RSA/AES)           |                                           |
|  - Caché Offline-First (Chats y Archivos) |                                           |
|  - Interfaz de Usuario React + WebRTC     |                                           |
========================================================================================
```

Para más detalles técnicos de bajo nivel, consulta las guías en la carpeta `docs`:
*   [Protocolo de Federación y Gobernanza (Democracia 4.0)](./docs/FEDERATION_PROTOCOL.md)
*   [Arquitectura de Mensajería Centralizada](./docs/CENTRALIZED_MESSAGING_ARCHITECTURE.md)
*   [Esquema de Pantallas e Interfaz](./docs/INTERFACE_AND_CONFIG_SCHEMA.md)
*   [Manual de Operaciones y Runbook](./docs/OPERATIONS_RUNBOOK.md)

---

## 🔐 Cláusula de Soberanía y Ética (Nodo Soberano)

Como parte de nuestro compromiso inquebrantable con la descentralización, privacidad y la autogestión de la infraestructura, Tudex adopta la siguiente política ética:

> [!IMPORTANT]
> **Responsabilidad del Nodo Soberano**
> Los administradores de cada nodo asumen un compromiso técnico y ético inquebrantable. Tienen estrictamente prohibido interceptar, analizar o monetizar el tráfico y los metadatos de su instancia. Deben garantizar el soporte absoluto para el cifrado extremo a extremo (E2EE), operar sobre infraestructura libre de dependencias corporativas y asegurar una federación transparente para no fragmentar la red. La comunidad es el núcleo de este ecosistema y su soberanía es inalienable.

---

## ⚙️ Variables de Entorno

Puedes configurar tu nodo Tudex inyectando las siguientes variables de entorno a través del archivo `docker-compose.yml` o un archivo `.env` en el backend:

| Variable | Tipo / Valor por defecto | Descripción |
| :--- | :--- | :--- |
| `PORT` | `3005` | Puerto de escucha del backend de Express. |
| `MONGODB_URI` | `mongodb://mongo:27017/tudex_live_chat` | URI de conexión para la base de datos MongoDB. |
| `LM_STUDIO_URL` | `http://host.docker.internal:1234` | Endpoint base para el servidor de LM Studio. |
| `AI_PROVIDER` | `lmstudio` o `cloudflare` | Proveedor activo para la asistencia de IA. |
| `CLOUDFLARE_ACCOUNT_ID`| String | ID de cuenta de Cloudflare (obligatorio si usas Cloudflare). |
| `CLOUDFLARE_API_TOKEN` | String | Token de API secreto para acceder a Cloudflare Workers AI. |
| `MODEL_NAME` | `llama-3.1-8b-instruct` | Nombre del modelo a utilizar para las sugerencias. |
| `AI_TEMPERATURE` | `0.7` | Grado de creatividad del modelo de lenguaje (`0.0` a `2.0`). |
| `FEDERATION_NODES` | String (Separado por comas) | Lista de endpoints de otros nodos para federación inicial. |
| `API_KEY` | String | Clave para proteger los endpoints públicos (vacío para desactivar). |

---

## 📡 API de Integración Externa

El nodo expone una API REST para poder publicar mensajes o alertas en tus canales o chats activos desde servicios o scripts locales (como bots o sistemas de alerta de tus propios servidores).

### Enviar Mensaje Federado

*   **Ruta:** `POST /api/send`
*   **Encabezados Requeridos:** `X-API-Key` (si la variable `API_KEY` está configurada).
*   **Cuerpo (JSON):**

```json
{
  "chatId": "usuario@nodo-remoto.tudex",
  "text": "🚀 Mensaje federado de notificación automática",
  "mediaUrl": "https://ejemplo-soberano.org/imagen.jpg"
}
```

### Ejemplo de uso con `curl`:

```bash
curl -X POST http://localhost:3005/api/send \
  -H "Content-Type: application/json" \
  -H "X-API-Key: tu_api_key_secreta" \
  -d '{
    "chatId": "admin@mi-nodo-tudex.local",
    "text": "Prueba de envío automático a través de la API externa."
  }'
```

---

## ⚖️ Licencia

Este proyecto está bajo la Licencia **MIT**. Consulta el archivo `LICENSE` para más detalles.
