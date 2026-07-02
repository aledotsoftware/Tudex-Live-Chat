import React from "react";

export function VoiceCallOverlay({
  mode = "overlay", // "maximized" or "overlay"
  inVoiceCall,
  voiceRoomId,
  selectedChatId,
  isCallMinimized,
  voicePeers,
  isMuted,
  screenStream,
  callVolume,
  currentUser,
  getAvatarGradient,
  toggleMute,
  startScreenShare,
  stopScreenShare,
  setCallVolume,
  setIsCallMinimized,
  leaveVoiceRoom,
  apiUrl,
  activeCallState,
  incomingCallInfo,
  outgoingCallInfo,
  joinVoiceRoom,
  setSelectedChatId,
  setViewMode,
  socketRef,
  setActiveCallState,
  setIncomingCallInfo
}) {
  // Helper to stop ringing (since we encapsulate the state but WebRTC hooks trigger on sockets,
  // we can emit decline/cancel events or call leave/join).
  const rejectCall = () => {
    if (socketRef && socketRef.current && incomingCallInfo) {
      socketRef.current.emit("reject-voice-call", {
        roomId: incomingCallInfo.roomId,
        hostId: incomingCallInfo.hostSocketId
      });
    }
    if (setActiveCallState) setActiveCallState("idle");
    if (setIncomingCallInfo) setIncomingCallInfo(null);
  };

  // 1. Fullscreen Outgoing Call Overlay
  if (mode === "overlay" && activeCallState === "calling" && outgoingCallInfo) {
    return (
      <div style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(11, 15, 26, 0.95)',
        backdropFilter: 'blur(20px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        color: '#fff',
        textAlign: 'center'
      }}>
        <div style={{
          width: '120px',
          height: '120px',
          borderRadius: '50%',
          background: getAvatarGradient(selectedChatId),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '3rem',
          fontWeight: 'bold',
          boxShadow: '0 0 30px rgba(255, 111, 36, 0.3)',
          marginBottom: '20px',
          animation: 'pulse 1.8s infinite',
          overflow: 'hidden'
        }}>
          <span style={{ fontSize: '3rem' }}>Call</span>
        </div>
        <h2 style={{ fontSize: '1.75rem', fontWeight: '700', margin: '10px 0' }}>{outgoingCallInfo.recipientName}</h2>
        <p style={{ color: '#ff6f24', fontSize: '1.05rem', fontWeight: '600', marginBottom: '40px', animation: 'pulse 1.5s infinite' }}>
          Llamando...
        </p>
        <div>
          <button
            onClick={leaveVoiceRoom}
            style={{
              background: '#ef4444',
              color: '#fff',
              border: 'none',
              borderRadius: '50%',
              width: '60px',
              height: '60px',
              fontSize: '1.5rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 8px 24px rgba(239, 68, 68, 0.4)',
              transition: 'all 0.2s',
              margin: '0 auto'
            }}
            title="Cancelar llamada"
          >
            Muted
          </button>
        </div>
      </div>
    );
  }

  // 2. Fullscreen Incoming Call Overlay
  if (mode === "overlay" && activeCallState === "incoming" && incomingCallInfo) {
    return (
      <div style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(11, 15, 26, 0.95)',
        backdropFilter: 'blur(20px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        color: '#fff',
        textAlign: 'center'
      }}>
        <div style={{
          width: '120px',
          height: '120px',
          borderRadius: '50%',
          background: getAvatarGradient(incomingCallInfo.hostId),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '3rem',
          fontWeight: 'bold',
          boxShadow: '0 0 30px rgba(0, 230, 118, 0.3)',
          marginBottom: '20px',
          animation: 'pulse 1.8s infinite',
          overflow: 'hidden'
        }}>
          <span style={{ fontSize: '3rem' }}>Call</span>
        </div>
        <h2 style={{ fontSize: '1.75rem', fontWeight: '700', margin: '10px 0' }}>{incomingCallInfo.hostName}</h2>
        <p style={{ color: '#00e676', fontSize: '1.05rem', fontWeight: '600', marginBottom: '40px' }}>
          Llamada de voz entrante
        </p>
        
        <div style={{ display: 'flex', gap: '30px' }}>
          {/* Accept Button */}
          <button
            onClick={() => {
              if (setSelectedChatId) setSelectedChatId(incomingCallInfo.roomId);
              if (joinVoiceRoom) joinVoiceRoom(incomingCallInfo.roomId, true);
            }}
            style={{
              background: '#00e676',
              color: '#fff',
              border: 'none',
              borderRadius: '50%',
              width: '60px',
              height: '60px',
              fontSize: '1.5rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 8px 24px rgba(0, 230, 118, 0.4)',
              transition: 'all 0.2s'
            }}
            title="Aceptar llamada"
          >
            Call
          </button>
          
          {/* Decline Button */}
          <button
            onClick={rejectCall}
            style={{
              background: '#ef4444',
              color: '#fff',
              border: 'none',
              borderRadius: '50%',
              width: '60px',
              height: '60px',
              fontSize: '1.5rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 8px 24px rgba(239, 68, 68, 0.4)',
              transition: 'all 0.2s'
            }}
            title="Rechazar llamada"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  // 3. Floating Call Widget (PIP)
  if (mode === "overlay" && inVoiceCall && (isCallMinimized || voiceRoomId !== selectedChatId)) {
    return (
      <div style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        background: 'rgba(15, 23, 42, 0.95)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '16px',
        padding: '12px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: '15px',
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)',
        zIndex: 9999,
        color: '#fff',
        animation: 'slideIn 0.3s ease-out'
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} /> En llamada
          </span>
          <span style={{ fontSize: '0.85rem', fontWeight: '600' }}>
            {voicePeers.length > 0 ? `${voicePeers.length + 1} participantes` : "Esperando..."}
          </span>
        </div>
        
        <div style={{ display: 'flex', gap: '8px' }}>
          {/* Quick Mute */}
          <button
            onClick={toggleMute}
            style={{
              background: isMuted ? '#ef4444' : 'rgba(255,255,255,0.1)',
              border: 'none',
              color: '#fff',
              borderRadius: '50%',
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: '0.9rem',
              padding: 0
            }}
          >
            {isMuted ? "Muted" : "Mic"}
          </button>
          
          {/* Maximizar */}
          <button
            onClick={() => {
              if (voiceRoomId && setSelectedChatId) {
                setSelectedChatId(voiceRoomId);
                if (setViewMode) setViewMode("chats");
              }
              if (setIsCallMinimized) setIsCallMinimized(false);
            }}
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              color: '#fff',
              borderRadius: '50%',
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: '0.9rem',
              padding: 0
            }}
            title="Maximizar"
          >
            
          </button>

          {/* Hang Up */}
          <button
            onClick={leaveVoiceRoom}
            style={{
              background: '#ef4444',
              color: '#fff',
              border: 'none',
              borderRadius: '50%',
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: '0.9rem',
              padding: 0
            }}
            title="Desconectar"
          >
            Call
          </button>
        </div>
      </div>
    );
  }

  if (mode === "overlay") {
    return null;
  }

  // 4. Standard Call Overlay (Maximized inside Chat layout)
  if (!inVoiceCall || voiceRoomId !== selectedChatId || isCallMinimized) {
    return null;
  }

  const isSomeoneSharingScreen = screenStream || voicePeers.some(p => p.stream && p.stream.getVideoTracks().length > 0);
  const activeVideoPeer = !screenStream && voicePeers.find(p => p.stream && p.stream.getVideoTracks().length > 0);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      width: 'calc(100% - 24px)',
      background: '#0b0f19',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      borderRadius: '16px',
      margin: '12px auto',
      padding: '16px',
      gap: '16px',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
      zIndex: 10,
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Header Info */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        paddingBottom: '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: '#10b981',
            boxShadow: '0 0 8px #10b981',
            display: 'inline-block'
          }} />
          <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: '600' }}>
            Llamada de voz · {voicePeers.length + 1} participantes
          </span>
        </div>
        <button
          onClick={() => setIsCallMinimized(true)}
          style={{
            background: 'rgba(255, 255, 255, 0.06)',
            border: 'none',
            color: '#94a3b8',
            borderRadius: '6px',
            padding: '4px 10px',
            cursor: 'pointer',
            fontSize: '0.75rem',
            fontWeight: '600',
            transition: 'all 0.2s'
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#fff'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#94a3b8'; }}
        >
           Minimizar
        </button>
      </div>

      {/* Main Area: Screen share or Participant Cards Grid */}
      {isSomeoneSharingScreen ? (
        <div style={{
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px'
        }}>
          {/* Main Video Box */}
          <div style={{
            width: '100%',
            height: '340px',
            background: '#04060b',
            borderRadius: '12px',
            overflow: 'hidden',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid rgba(255, 255, 255, 0.06)'
          }}>
            {screenStream ? (
              <video
                autoPlay
                playsInline
                muted
                ref={el => { if (el && el.srcObject !== screenStream) el.srcObject = screenStream; }}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            ) : (
              activeVideoPeer && (
                <video
                  autoPlay
                  playsInline
                  ref={el => { if (el && el.srcObject !== activeVideoPeer.stream) el.srcObject = activeVideoPeer.stream; }}
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              )
            )}
            
            {/* Label Overlay */}
            <div style={{
              position: 'absolute',
              bottom: '12px',
              left: '12px',
              background: 'rgba(15, 23, 42, 0.75)',
              backdropFilter: 'blur(4px)',
              padding: '6px 12px',
              borderRadius: '20px',
              fontSize: '0.75rem',
              color: '#fff',
              fontWeight: '600',
              border: '1px solid rgba(255,255,255,0.1)'
            }}>
              {screenStream ? "Estás compartiendo tu pantalla" : `Pantalla compartida de ${activeVideoPeer?.username}`}
            </div>
          </div>

          {/* Shrunk Participant Avatars strip */}
          <div style={{
            display: 'flex',
            gap: '8px',
            justifyContent: 'center',
            flexWrap: 'wrap',
            marginTop: '4px'
          }}>
            {/* Local participant bubble */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(255,255,255,0.05)',
              padding: '4px 10px',
              borderRadius: '16px',
              border: '1px solid rgba(255,255,255,0.08)'
            }}>
              <div style={{
                width: '18px',
                height: '18px',
                borderRadius: '50%',
                background: currentUser?.avatarUrl ? 'transparent' : getAvatarGradient(currentUser?.avatarColor || currentUser?.id || 'me'),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.6rem',
                fontWeight: '700',
                color: '#fff',
                overflow: 'hidden'
              }}>
                {currentUser?.avatarUrl ? (
                  <img src={currentUser.avatarUrl} alt="Yo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  (currentUser?.username || "Yo").slice(0, 2).toUpperCase()
                )}
              </div>
              <span style={{ fontSize: '0.7rem', color: '#ccc' }}>Tú {isMuted ? 'Muted' : 'Mic'}</span>
            </div>

            {/* Remote participants bubbles */}
            {voicePeers.map(peer => (
              <div key={peer.socketId} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'rgba(255,255,255,0.05)',
                padding: '4px 10px',
                borderRadius: '16px',
                border: '1px solid rgba(255,255,255,0.08)'
              }}>
                <div style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  background: peer.avatarUrl ? 'transparent' : getAvatarGradient(peer.avatarColor || peer.userId),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.6rem',
                  fontWeight: '700',
                  color: '#fff',
                  overflow: 'hidden'
                }}>
                  {peer.avatarUrl ? (
                    <img src={peer.avatarUrl} alt={peer.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    peer.username.slice(0, 2).toUpperCase()
                  )}
                </div>
                <span style={{ fontSize: '0.7rem', color: '#ccc' }}>{peer.username}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* Grid of large participant cards */
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '12px',
          width: '100%',
          minHeight: '140px',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          {/* Local participant card */}
          <div style={{
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            borderRadius: '12px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            position: 'relative'
          }}>
            <div style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              background: currentUser?.avatarUrl ? 'transparent' : getAvatarGradient(currentUser?.avatarColor || currentUser?.id || 'me'),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.2rem',
              fontWeight: '700',
              color: '#fff',
              overflow: 'hidden',
              boxShadow: !isMuted ? '0 0 12px rgba(16, 185, 129, 0.3)' : 'none',
              border: !isMuted ? '2px solid #10b981' : '2px solid rgba(255,255,255,0.1)'
            }}>
              {currentUser?.avatarUrl ? (
                <img src={currentUser.avatarUrl} alt="Yo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                (currentUser?.username || "Yo").slice(0, 2).toUpperCase()
              )}
            </div>
            <span style={{ fontSize: '0.75rem', color: '#fff', fontWeight: '600' }}>Tú</span>
            <div style={{
              position: 'absolute',
              top: '8px',
              right: '8px',
              background: isMuted ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)',
              borderRadius: '50%',
              width: '18px',
              height: '18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.65rem'
            }}>
              {isMuted ? "Muted" : "Mic"}
            </div>
          </div>

          {/* Remote participants cards */}
          {voicePeers.map(peer => (
            <div key={peer.socketId} style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              borderRadius: '12px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              position: 'relative'
            }}>
              <div style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                background: peer.avatarUrl ? 'transparent' : getAvatarGradient(peer.avatarColor || peer.userId),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.2rem',
                fontWeight: '700',
                color: '#fff',
                overflow: 'hidden',
                boxShadow: '0 0 12px rgba(16, 185, 129, 0.2)',
                border: '2px solid rgba(255,255,255,0.15)'
              }}>
                {peer.avatarUrl ? (
                  <img src={peer.avatarUrl} alt={peer.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  peer.username.slice(0, 2).toUpperCase()
                )}
              </div>
              <span style={{ fontSize: '0.75rem', color: '#fff', fontWeight: '600' }}>{peer.username}</span>
              <div style={{
                position: 'absolute',
                top: '8px',
                right: '8px',
                background: 'rgba(16, 185, 129, 0.2)',
                borderRadius: '50%',
                width: '18px',
                height: '18px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.65rem'
              }}>
                Mic
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Control Toolbar at the bottom */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
        width: '100%',
        marginTop: '8px',
        borderTop: '1px solid rgba(255, 255, 255, 0.06)',
        paddingTop: '14px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Mute Button */}
          <button
            onClick={toggleMute}
            style={{
              background: isMuted ? '#ef4444' : 'rgba(255, 255, 255, 0.08)',
              border: 'none',
              color: '#fff',
              borderRadius: '50%',
              width: '40px',
              height: '40px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: '1.1rem',
              transition: 'all 0.2s',
              boxShadow: '0 4px 10px rgba(0,0,0,0.3)'
            }}
            title={isMuted ? "Activar micrófono" : "Silenciar micrófono"}
          >
            {isMuted ? "Muted" : "Mic"}
          </button>
          
          {/* Screen Share Button */}
          <button
            onClick={screenStream ? stopScreenShare : startScreenShare}
            style={{
              background: screenStream ? '#10b981' : 'rgba(255, 255, 255, 0.08)',
              border: 'none',
              color: '#fff',
              borderRadius: '50%',
              width: '40px',
              height: '40px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: '1.1rem',
              transition: 'all 0.2s',
              boxShadow: '0 4px 10px rgba(0,0,0,0.3)'
            }}
            title={screenStream ? "Dejar de compartir pantalla" : "Compartir pantalla"}
          >
            Screen
          </button>

          {/* Volume Control */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'rgba(255, 255, 255, 0.04)',
            padding: '6px 12px',
            borderRadius: '20px',
            border: '1px solid rgba(255, 255, 255, 0.06)'
          }}>
            <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}></span>
            <input
              type="range"
              min="0"
              max="100"
              value={callVolume}
              onChange={(e) => setCallVolume(parseInt(e.target.value))}
              style={{
                width: '60px',
                height: '4px',
                accentColor: '#a855f7',
                cursor: 'pointer'
              }}
              title={`Volumen: ${callVolume}%`}
            />
          </div>
          
          {/* Decline/Disconnect Button */}
          <button
            onClick={leaveVoiceRoom}
            style={{
              background: '#ef4444',
              border: 'none',
              color: '#fff',
              borderRadius: '20px',
              padding: '8px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontWeight: '700',
              boxShadow: '0 4px 10px rgba(239, 68, 68, 0.3)',
              transition: 'all 0.2s'
            }}
          >
            Desconectar
          </button>
        </div>
      </div>

      {/* Audio elements to play peer audio streams */}
      <div style={{ display: 'none' }}>
        {voicePeers.map(peer => {
          if (!peer.stream) return null;
          return (
            <audio
              key={peer.socketId}
              autoPlay
              playsInline
              ref={el => {
                if (el && el.srcObject !== peer.stream) {
                  el.srcObject = peer.stream;
                }
                if (el) {
                  el.volume = callVolume / 100;
                }
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
export default VoiceCallOverlay;
