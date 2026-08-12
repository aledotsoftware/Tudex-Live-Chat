# Business Rules - WebRTC Voice Call Signaling

## 1. Overview
The Voice Call domain handles peer-to-peer audio calls between users using WebRTC P2P mesh architecture with Socket.io signaling and STUN/TURN NAT traversal.

---

## 2. Core Business Rules

### BR-VOICE-001: WebRTC Room Management
- **Rule**: Voice calls are grouped into unique `roomId` containers (e.g. `voice_{chatId}`).
- **Behavior**: Joining a voice room emits `voice-peer-joined` to active members and returns `voice-room-peers` to the joiner containing current participant socket IDs.

### BR-VOICE-002: Signaling Protocol Passthrough
- **Rule**: The server acts strictly as an opaque signaling relay for WebRTC SDP offers, SDP answers, and ICE candidate objects (`send-voice-signal` -> `voice-signal`).
- **Behavior**: Audio streams MUST pass directly between peers (P2P) without being recorded or stored on the application server.

### BR-VOICE-003: Call Cancellation & Rejection Handling
- **Rule**:
  - If the recipient rejects an incoming call (`reject-voice-call`), the host receives `voice-call-rejected`, closing the pending call UI.
  - If the caller hangs up before the recipient answers (`cancel-voice-call`), the recipient receives `voice-call-cancelled`.
  - Disconnecting from WebSockets automatically cleans up active room memberships and notifies peers (`voice-peer-left`).
