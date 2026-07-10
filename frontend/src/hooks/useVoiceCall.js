import { useState, useEffect, useRef } from "react";

export function useVoiceCall({
  socketRef,
  socketConnected,
  currentUser,
  selectedChat,
  showNotice,
  iceServers,
  setNotifications
}) {
  const [inVoiceCall, setInVoiceCall] = useState(false);
  const [voiceRoomId, setVoiceRoomId] = useState(null);
  const [isCallMinimized, setIsCallMinimized] = useState(false);
  const [voicePeers, setVoicePeers] = useState([]);
  const [isMuted, setIsMuted] = useState(false);
  const [screenStream, setScreenStream] = useState(null);
  const [callVolume, setCallVolume] = useState(80);
  const [activeCallState, setActiveCallState] = useState("idle"); // idle, calling, incoming, connected
  const [incomingCallInfo, setIncomingCallInfo] = useState(null);
  const [outgoingCallInfo, setOutgoingCallInfo] = useState(null);

  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const peerConnectionsRef = useRef(new Map()); // socketId -> RTCPeerConnection
  const candidateQueueRef = useRef(new Map()); // socketId -> Array of ICE candidates
  const callAudioCtxRef = useRef(null);
  const callRingtoneIntervalRef = useRef(null);

  // Manage ringtone playback using Web Audio API
  const startRingtone = (isIncoming) => {
    stopRingtone();
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      callAudioCtxRef.current = new AudioCtx();
      
      const playBeep = () => {
        if (!callAudioCtxRef.current || callAudioCtxRef.current.state === 'suspended') return;
        const osc1 = callAudioCtxRef.current.createOscillator();
        const osc2 = callAudioCtxRef.current.createOscillator();
        const gainNode = callAudioCtxRef.current.createGain();
        
        osc1.frequency.value = isIncoming ? 400 : 440;
        osc2.frequency.value = isIncoming ? 450 : 480;
        
        gainNode.gain.setValueAtTime(0, callAudioCtxRef.current.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.15, callAudioCtxRef.current.currentTime + 0.1);
        gainNode.gain.setValueAtTime(0.15, callAudioCtxRef.current.currentTime + (isIncoming ? 1.5 : 1.2));
        gainNode.gain.linearRampToValueAtTime(0, callAudioCtxRef.current.currentTime + (isIncoming ? 1.7 : 1.4));
        
        osc1.connect(gainNode);
        osc2.connect(gainNode);
        gainNode.connect(callAudioCtxRef.current.destination);
        
        osc1.start();
        osc2.start();
        osc1.stop(callAudioCtxRef.current.currentTime + 2.0);
        osc2.stop(callAudioCtxRef.current.currentTime + 2.0);
      };
      
      playBeep();
      callRingtoneIntervalRef.current = setInterval(playBeep, isIncoming ? 3000 : 4000);
    } catch (e) {
      console.warn("AudioContext ringtone failed to start:", e);
    }
  };

  const stopRingtone = () => {
    if (callRingtoneIntervalRef.current) {
      clearInterval(callRingtoneIntervalRef.current);
      callRingtoneIntervalRef.current = null;
    }
    if (callAudioCtxRef.current) {
      try {
        callAudioCtxRef.current.close();
      } catch (e) {}
      callAudioCtxRef.current = null;
    }
  };

  // Create WebRTC peer connection
  function createPeerConnection(peerSocketId, peerInfo, isOfferOriginator) {
    const pc = new RTCPeerConnection({
      iceServers: iceServers || []
    });

    peerConnectionsRef.current.set(peerSocketId, pc);

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('send-voice-signal', {
          to: peerSocketId,
          signal: { candidate: event.candidate }
        });
      }
    };

    pc.onnegotiationneeded = async () => {
      if (pc.signalingState !== "stable") return;
      try {
        if (socketRef.current) {
          console.log("[WebRTC] Negotiation needed. Creating offer...");
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socketRef.current.emit('send-voice-signal', {
            to: peerSocketId,
            signal: { sdp: pc.localDescription }
          });
        }
      } catch (e) {
        console.error("Error creating WebRTC offer on negotiationneeded:", e);
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        showNotice(`Warning Se cortó la conexión con ${peerInfo.username || "un participante"}.`, "warning");
        setVoicePeers(prev => prev.filter(p => p.socketId !== peerSocketId));
      }
    };

    pc.ontrack = (event) => {
      const remoteStream = event.streams[0];
      setVoicePeers(prev => prev.map(p => {
        if (p.socketId === peerSocketId) {
          return { ...p, stream: remoteStream };
        }
        return p;
      }));
    };

    if (isOfferOriginator && socketRef.current) {
      pc.createOffer().then(offer => {
        return pc.setLocalDescription(offer);
      }).then(() => {
        socketRef.current.emit('send-voice-signal', {
          to: peerSocketId,
          signal: { sdp: pc.localDescription }
        });
      }).catch(e => console.error("Error creating WebRTC offer:", e));
    }

    return pc;
  }

  // Join Voice Call
  async function joinVoiceRoom(roomId, isAccepting = false) {
    if (!roomId) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      
      if (socketRef.current) {
        socketRef.current.emit('join-voice-room', { roomId });
      }
      setInVoiceCall(true);
      setVoiceRoomId(roomId);
      setIsCallMinimized(false);
      
      if (isAccepting) {
        stopRingtone();
        setActiveCallState("connected");
        setIncomingCallInfo(null);
      } else {
        setActiveCallState("calling");
        setOutgoingCallInfo({ roomId, recipientName: selectedChat?.name || "Usuario" });
        startRingtone(false);
      }
      
      showNotice("Mic Canal de voz iniciado.", "success");
    } catch (e) {
      console.error("Error joining voice room:", e);
      showNotice("No se pudo acceder al micrófono para la llamada.", "error");
      stopRingtone();
      setActiveCallState("idle");
    }
  }

  // Leave / Disconnect Voice Call
  function leaveVoiceRoom() {
    stopRingtone();
    if (socketRef.current) {
      if (activeCallState === "calling" && voiceRoomId) {
        socketRef.current.emit('cancel-voice-call', { roomId: voiceRoomId });
      }
      socketRef.current.emit('leave-voice-room');
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
    }
    setScreenStream(null);
    peerConnectionsRef.current.forEach(pc => pc.close());
    peerConnectionsRef.current.clear();
    candidateQueueRef.current.clear();
    setInVoiceCall(false);
    setVoiceRoomId(null);
    setVoicePeers([]);
    setIsMuted(false);
    setActiveCallState("idle");
    setIncomingCallInfo(null);
    setOutgoingCallInfo(null);
    setIsCallMinimized(false);
    showNotice(" Has abandonado la llamada.", "info");
  }

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      const nextMute = !isMuted;
      audioTracks.forEach(track => {
        track.enabled = !nextMute;
      });
      setIsMuted(nextMute);
      showNotice(nextMute ? " Micrófono silenciado" : " Micrófono activo", "info");
    }
  };

  const startScreenShare = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      showNotice("La compartición de pantalla no está soportada en este navegador, dispositivo móvil o contexto no seguro (debe ser HTTPS).", "error");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenStreamRef.current = stream;
      setScreenStream(stream);

      const videoTrack = stream.getVideoTracks()[0];
      
      peerConnectionsRef.current.forEach(pc => {
        const senders = pc.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        if (videoSender) {
          videoSender.replaceTrack(videoTrack);
        } else {
          pc.addTrack(videoTrack, stream);
        }
      });

      videoTrack.onended = () => {
        stopScreenShare();
      };
      
      showNotice("Screen Compartiendo pantalla.", "success");
    } catch (e) {
      console.error("Error starting screen share:", e);
      showNotice("No se pudo iniciar la compartición de pantalla.", "error");
    }
  };

  const stopScreenShare = () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
    }
    setScreenStream(null);
    peerConnectionsRef.current.forEach(pc => {
      const senders = pc.getSenders();
      const videoSender = senders.find(s => s.track && s.track.kind === 'video');
      if (videoSender) {
        pc.removeTrack(videoSender);
      }
    });
    showNotice("Screen Se dejó de compartir pantalla.", "info");
  };

  // Bind Voice WebRTC events when socket is connected
  useEffect(() => {
    const socket = socketRef?.current;
    if (!socket || !socketConnected) return;

    const handleVoiceRoomPeers = ({ peers }) => {
      setVoicePeers(peers.map(p => ({ ...p, stream: null })));
      peers.forEach(peer => {
        createPeerConnection(peer.socketId, peer, true);
      });
    };

    const handleVoicePeerJoined = (peer) => {
      stopRingtone();
      setActiveCallState("connected");
      setVoicePeers(prev => {
        if (prev.some(p => p.socketId === peer.socketId)) return prev;
        return [...prev, { ...peer, stream: null }];
      });
      createPeerConnection(peer.socketId, peer, false);
    };

    const handleVoicePeerLeft = ({ socketId }) => {
      setVoicePeers(prev => prev.filter(p => p.socketId !== socketId));
      const pc = peerConnectionsRef.current.get(socketId);
      if (pc) {
        pc.close();
        peerConnectionsRef.current.delete(socketId);
      }
    };

    const handleVoiceSignal = ({ from, signal }) => {
      const pc = peerConnectionsRef.current.get(from);
      if (!pc) return;
      if (signal.sdp) {
        pc.setRemoteDescription(new RTCSessionDescription(signal.sdp)).then(() => {
          const queue = candidateQueueRef.current.get(from) || [];
          queue.forEach(candidate => {
            pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error("Error adding queued ICE candidate:", e));
          });
          candidateQueueRef.current.delete(from);

          if (signal.sdp.type === 'offer') {
            return pc.createAnswer().then(answer => {
              return pc.setLocalDescription(answer);
            }).then(() => {
              socket.emit('send-voice-signal', {
                to: from,
                signal: { sdp: pc.localDescription }
              });
            });
          }
        }).catch(e => console.error("Error setting remote SDP:", e));
      }
      if (signal.candidate) {
        if (pc.remoteDescription && pc.remoteDescription.type) {
          pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(e => console.error("Error adding ICE candidate:", e));
        } else {
          if (!candidateQueueRef.current.has(from)) {
            candidateQueueRef.current.set(from, []);
          }
          candidateQueueRef.current.get(from).push(signal.candidate);
        }
      }
    };

    const handleIncomingVoiceCall = ({ roomId, hostName, hostId, hostSocketId }) => {
      setActiveCallState("incoming");
      setIncomingCallInfo({ roomId, hostName, hostId, hostSocketId: hostSocketId || hostId });
      startRingtone(true);
      showNotice(`Call Llamada de voz entrante de ${hostName}.`, "info");
      
      if (document.hidden && "Notification" in window && Notification.permission === "granted") {
        try {
          const title = `Llamada entrante - Tapchat`;
          const options = {
            body: `${hostName} te está llamando de voz.`,
            icon: '/pwa-192x192.png',
            tag: roomId
          };
          if (navigator.serviceWorker && navigator.serviceWorker.ready) {
            navigator.serviceWorker.ready.then(registration => {
              registration.showNotification(title, options);
            });
          } else {
            new Notification(title, options);
          }
        } catch (e) {
          console.error("Error creating call notification:", e);
        }
      }
      
      if (setNotifications) {
        setNotifications(prev => [
          {
            id: Date.now(),
            type: 'call',
            text: `Llamada entrante de ${hostName}`,
            time: 'Ahora'
          },
          ...prev
        ]);
      }
    };

    const handleVoiceCallRejected = () => {
      stopRingtone();
      leaveVoiceRoom();
      showNotice("Close La llamada fue rechazada.", "error");
    };

    const handleVoiceCallCancelled = () => {
      stopRingtone();
      setActiveCallState("idle");
      setIncomingCallInfo(null);
      showNotice("Call La llamada fue cancelada.", "info");
    };

    socket.on("voice-room-peers", handleVoiceRoomPeers);
    socket.on("voice-peer-joined", handleVoicePeerJoined);
    socket.on("voice-peer-left", handleVoicePeerLeft);
    socket.on("voice-signal", handleVoiceSignal);
    socket.on("incoming-voice-call", handleIncomingVoiceCall);
    socket.on("voice-call-rejected", handleVoiceCallRejected);
    socket.on("voice-call-cancelled", handleVoiceCallCancelled);

    return () => {
      socket.off("voice-room-peers", handleVoiceRoomPeers);
      socket.off("voice-peer-joined", handleVoicePeerJoined);
      socket.off("voice-peer-left", handleVoicePeerLeft);
      socket.off("voice-signal", handleVoiceSignal);
      socket.off("incoming-voice-call", handleIncomingVoiceCall);
      socket.off("voice-call-rejected", handleVoiceCallRejected);
      socket.off("voice-call-cancelled", handleVoiceCallCancelled);
      
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }
      peerConnectionsRef.current.forEach(pc => pc.close());
      peerConnectionsRef.current.clear();
      stopRingtone();
    };
  }, [socketConnected]);

  return {
    inVoiceCall,
    voiceRoomId,
    isCallMinimized,
    voicePeers,
    isMuted,
    screenStream,
    callVolume,
    activeCallState,
    incomingCallInfo,
    outgoingCallInfo,
    joinVoiceRoom,
    leaveVoiceRoom,
    toggleMute,
    startScreenShare,
    stopScreenShare,
    setIsCallMinimized,
    setCallVolume,
    setActiveCallState,
    setIncomingCallInfo
  };
}
export default useVoiceCall;
