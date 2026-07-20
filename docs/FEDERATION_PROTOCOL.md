# 🌐 PROTOCOLO DE FEDERACIÓN Y COMUNICACIÓN INTER-NODO (Tudex Live Chat)
## Ecosistema de Mensajería y Gobernanza bajo Democracia Líquida

Este documento define las especificaciones técnicas y conceptuales del protocolo de federación de Tudex Live Chat, diseñado sobre los principios de **Democracia Líquida**. Este modelo busca no solo habilitar un chat técnico descentralizado, sino también dotar a las comunidades de herramientas integradas para la gobernanza colectiva, la confianza líquida, la privacidad criptográfica y la toma de decisiones descentralizada.

---

## 1. Fundamentos de Democracia Líquida en la Red

Tudex concibe la mensajería como un derecho fundamental y una herramienta de organización civil. La infraestructura de comunicación debe estar alineada con una gobernanza que evite la centralización de poder técnico o político. Para ello, el protocolo se asienta sobre cuatro pilares democráticos:

1.  **Identidades Soberanas (Self-Sovereign Identity - SSI):** Los usuarios y los nodos son dueños exclusivos de sus llaves criptográficas de identidad. No existen servidores de nombres centralizados.
2.  **Confianza Líquida (Liquid Trust):** La confianza en la red se delega y retira de forma dinámica. La reputación de los nodos y moderadores fluye a través de la red de relaciones comunitarias.
3.  **Votación Líquida e Inmutable:** Herramientas de consulta y voto integradas directamente en el flujo de chat. Los usuarios pueden votar directamente o delegar su voto de manera revocable en tiempo real.
4.  **Gobernanza Transparente y Libre de Corporaciones:** Las reglas de federación, la admisión de nuevos nodos y la moderación general se deciden a través de mecanismos de consenso democrático registrados de forma inmutable.

---

## 2. Capa de Identidad y Confianza Líquida

### 2.1 Direccionamiento y Llaves de Identidad
Cada usuario e instancia se identifica bajo el esquema estándar federado:
`usuario@dominio-del-nodo.org` o `nodo@dominio-del-nodo.org`

Al inicializar un perfil en el cliente PWA:
1.  Se genera un par de llaves asimétricas **RSA de 4096 bits** (o curvas elípticas Ed25519) en el almacenamiento local del dispositivo (IndexedDB).
2.  La **Llave Pública de Identidad ($K_{pub}$)** se publica en el nodo local.
3.  La **Llave Privada ($K_{priv}$)** nunca sale del navegador del usuario.

### 2.2 Red de Confianza Líquida (Trust Graph)
Para evitar que nodos maliciosos spammeen la red sin recurrir a una lista negra centralizada:
*   **Acreditación Mutua:** Un nodo A puede firmar digitalmente una declaración de confianza sobre el nodo B: $Sign_{A}(Trust(B))$.
*   **Transitividad:** Si la comunidad confía en el Nodo A, y el Nodo A confía en el Nodo B, se establece un canal de federación implícito.
*   **Revocación Instantánea:** Si el Nodo B aloja tráfico malicioso o incumple el compromiso ético, el Nodo A puede revocar su firma. La pérdida de reputación se propaga por el grafo de confianza de forma inmediata, aislando al nodo infractor de la federación.

---

## 3. Arquitectura del Enrutamiento y Mensajería Federada

La comunicación inter-nodo funciona mediante canales WebSocket seguros (`wss://`) y colas de sincronización asíncrona respaldadas por MongoDB.

```text
  [ CLIENTE A1 ]              [ NODO ORIGEN ]              [ NODO DESTINO ]              [ CLIENTE B1 ]
  (usuario@nodoA)                 (Nodo A)                     (Nodo B)                  (receptor@nodoB)
        |                            |                            |                            |
        |--- 1. Enviar cifrado ----->|                            |                            |
        |    E2EE(Msg) + Firma(A1)   |                            |                            |
        |                            |--- 2. Validar firma A1 ----|                            |
        |                            |    y enrutar por WSS ---->|                            |
        |                            |                            |--- 3. Guardar en cola ---->|
        |                            |                            |    e IndexedDB local       |
        |                            |                            |                            |
        |                            |                            |<-- 4. Confirmación firma --|
```

### 3.1 Flujo de Envío de Mensajes
1.  **Cifrado y Firma (Cliente Emisor):**
    *   El cliente cifra el contenido del mensaje con una llave simétrica efímera (AES-GCM-256).
    *   Cifra la llave efímera con la llave pública del destinatario (RSA-OAEP).
    *   Genera una firma digital del payload cifrado utilizando la llave privada del emisor.
2.  **Validación y Enrutamiento (Nodo de Origen):**
    *   El Nodo A recibe el payload. Verifica que el emisor pertenezca a su base de datos local y que la firma sea válida.
    *   Identifica el dominio del destinatario (`nodoB`). Si no hay un canal de WebSocket abierto con `nodoB`, inicia el protocolo de descubrimiento y handshake de federación.
3.  **Entrega y Almacenamiento (Nodo de Destino):**
    *   El Nodo B recibe el mensaje federado. Comprueba que el Nodo A esté dentro de su umbral de confianza del Trust Graph.
    *   Almacena el mensaje cifrado en su base de datos y lo notifica al cliente receptor a través de WebSockets o Service Workers (PWA Push Notifications).
4.  **Descifrado (Cliente Receptor):**
    *   El navegador del cliente receptor descarga el payload cifrado, verifica la firma digital del emisor original para confirmar la autoría, y descifra el mensaje usando su llave privada local.

---

## 4. Gobernanza y Consenso Democrático (Democracia 4.0)

Tudex implementa herramientas para que la comunidad tome decisiones directamente dentro del ecosistema de mensajería.

### 4.1 Voto Líquido Integrado (Liquid Voting)
Cuando una comunidad federada requiere tomar una decisión (ej. actualizar reglas de uso de un canal compartido, elegir moderadores, o votar sobre la exclusión de un nodo malicioso):
*   **Propuesta Criptográfica:** Se emite una propuesta estructurada firmada por el proponente.
*   **Voto Directo:** Los usuarios pueden emitir un voto firmado criptográficamente: `Sign_User(Vote(Propuesta_ID, A favor/En contra))`.
*   **Voto Delegado:** Los usuarios pueden delegar su representación de voto en otro miembro de la comunidad de forma general o por áreas de especialización (ej. "delego mi voto en temas de moderación técnica a @admin").
*   **Revocabilidad:** La delegación puede revocarse o cambiarse instantáneamente en cualquier momento si el representante deja de reflejar la voluntad del usuario.

### 4.2 Registro Inmutable de Acuerdos (Federated Ledger)
Para asegurar la transparencia y evitar fraudes:
*   Cada nodo mantiene un registro local secuencial (libro contable o ledger de solo adición) de los votos y propuestas del canal federado.
*   Los registros de votación se replican y sincronizan entre todos los nodos participantes del canal mediante hashes criptográficos en cadena (Merkle Trees).
*   Cualquier cliente puede auditar de forma matemática el resultado de una votación descargando y verificando las firmas de los votos individuales.

---

## 5. Pruebas de Conocimiento Cero (Zero-Knowledge Proofs)

Para salvaguardar la privacidad de los miembros frente a administradores de nodos remotos:
*   **Verificación de Pertenencia Anónima:** Un usuario de la comunidad puede demostrar que pertenece a un grupo privado federado o que tiene derecho a voto en un canal sin revelar cuál es su dirección de correo o identidad específica.
*   Mediante firmas de anillo (ring signatures) o pruebas criptográficas ZKP (como zk-SNARKs), el nodo de destino puede validar que el mensaje proviene de un miembro autorizado del nodo de origen, manteniendo el anonimato total del emisor frente a la red exterior.
