import React, { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import QRCode from "react-qr-code";
import {
  getCachedChats,
  getCachedMessages,
  setCachedChats,
  setCachedMessages,
  clearCache,
  getOfflineQueue,
  setOfflineQueue
} from "./cacheStore";

const defaultApiUrl = typeof window !== "undefined" ? window.location.origin : "http://localhost:3005";

console.log("[Tapchat] API target:", defaultApiUrl);

const API_URL = import.meta.env.VITE_API_URL || defaultApiUrl;
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || defaultApiUrl;
const MOBILE_BREAKPOINT_PX = 920;
const DEFAULT_PROVIDER = "whatsapp";
const DEFAULT_ACCOUNT_ID = "default";

// We will extract these dynamic parameters where applicable if needed.

function parseApiItemsPayload(payload) {
  if (Array.isArray(payload)) {
    return {
      items: payload,
      syncState: null
    };
  }
  return {
    items: Array.isArray(payload?.items) ? payload.items : [],
    syncState: payload?.syncState || null
  };
}

const originalFetch = window.fetch;
window.fetch = async (...args) => {
  let [resource, config] = args;
  const key = localStorage.getItem("tapchat_token") || localStorage.getItem("tapchat_api_key");
  
  if (key) {
    config = config || {};
    let headers = config.headers || {};
    
    if (headers instanceof Headers) {
      headers.set("Authorization", `Bearer ${key}`);
      headers.set("X-API-Key", key);
    } else if (Array.isArray(headers)) {
      headers.push(["Authorization", `Bearer ${key}`]);
      headers.push(["X-API-Key", key]);
    } else {
      headers["Authorization"] = `Bearer ${key}`;
      headers["X-API-Key"] = key;
    }
    config.headers = headers;
    args[1] = config;
  }
  
  const response = await originalFetch(...args);
  if (response.status === 401) {
    console.warn("Auth failure for:", resource);
    window.dispatchEvent(new Event('tapchat_auth_error'));
  }
  return response;
};

// ⚡ Bolt: Cache Intl.DateTimeFormat instances to avoid expensive instantiation on every render for large lists
const timeFormatter = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" });
const dateFormatter = new Intl.DateTimeFormat([], { day: "2-digit", month: "2-digit" });
const dateTimeFormatter = new Intl.DateTimeFormat([], {
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit"
});

function formatTime(unixTs) {
  const value = Number(unixTs) || Math.floor(Date.now() / 1000);
  return timeFormatter.format(value * 1000);
}

function formatChatTime(unixTs) {
  const value = Number(unixTs);
  if (!value) return "";
  const date = new Date(value * 1000);
  const now = new Date();
  const sameDay =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();
  if (sameDay) return formatTime(value);
  return dateFormatter.format(value * 1000);
}

function formatStatusDate(unixTs) {
  const value = Number(unixTs);
  if (!value) return "";
  return dateTimeFormatter.format(value * 1000);
}

function messageId(msg) {
  return msg.id || `${msg.chatId}-${msg.timestamp}-${msg.body}-${msg.fromMe}`;
}

function initialsForChat(chat) {
  if (chat?.isGroup) return "GR";
  const base = (chat?.name || chat?.id || "?").trim();
  if (!base) return "?";
  const parts = base.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || "").join("") || "?";
}

function getAvatarGradient(id) {
  const str = String(id || "default");
  if (str.startsWith("hsl") || str.startsWith("#") || str.startsWith("rgb") || str.includes("linear-gradient")) {
    if (str.includes("linear-gradient")) return str;
    return `linear-gradient(135deg, ${str} 0%, rgba(0,0,0,0.3) 100%)`;
  }
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const c1 = `hsl(${Math.abs(hash) % 360}, 65%, 35%)`;
  const c2 = `hsl(${(Math.abs(hash) + 40) % 360}, 75%, 45%)`;
  return `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`;
}

function PhoneCallIcon({ size = 16, className = "" }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
    </svg>
  );
}

function ChatIcon({ size = 20, className = "" }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function StatusIcon({ size = 20, className = "" }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a10 10 0 0 1 10 10" strokeDasharray="3 3" />
    </svg>
  );
}

function ProximityIcon({ size = 20, className = "" }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function MuroIcon({ size = 20, className = "" }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="9" y1="21" x2="9" y2="9" />
    </svg>
  );
}

function AlertIcon({ size = 20, className = "" }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function SettingsIcon({ size = 20, className = "" }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function PlusIcon({ size = 20, className = "" }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function CloseIcon({ size = 20, className = "" }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function SaveIcon({ size = 20, className = "" }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

function SearchIcon({ size = 20, className = "" }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function SendIcon({ size = 20, className = "" }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function TestIcon({ size = 20, className = "" }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <path d="M4.5 16.5c-1.5 1.26-2 3.18-1 4.5s3.24.54 4.5-1L18 8l-4-4L4.5 16.5z" />
      <path d="M12 2l10 10" />
      <path d="M9 5l10 10" />
    </svg>
  );
}

function HappyIcon({ size = 20, className = "" }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <circle cx="12" cy="12" r="10" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <line x1="9" y1="9" x2="9.01" y2="9" />
      <line x1="15" y1="9" x2="15.01" y2="9" />
    </svg>
  );
}

function SadIcon({ size = 20, className = "" }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <circle cx="12" cy="12" r="10" />
      <path d="M16 16s-1.5-2-4-2-4 2-4 2" />
      <line x1="9" y1="9" x2="9.01" y2="9" />
      <line x1="15" y1="9" x2="15.01" y2="9" />
    </svg>
  );
}

function LogoutIcon({ size = 20, className = "" }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function WarningIcon({ size = 20, className = "" }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function InfoIcon({ size = 20, className = "" }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function AttachmentIcon({ size = 20, className = "" }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function HeartIcon({ size = 20, className = "", filled = false }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function EyeIcon({ size = 20, className = "" }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon({ size = 20, className = "" }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function ReloadIcon({ size = 20, className = "" }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <path d="M23 4v6h-6" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function UserIcon({ size = 20, className = "" }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function AckIcon({ status }) {
  if (status === 3) return <span role="status" aria-label="Leído" className="ackDoubleBlue" aria-hidden="false"><span aria-hidden="true">✓✓</span></span>;
  if (status === 2) return <span role="status" aria-label="Entregado" className="ackDouble" aria-hidden="false"><span aria-hidden="true">✓✓</span></span>;
  if (status === 1) return <span role="status" aria-label="Enviado" className="ackSingle" aria-hidden="false"><span aria-hidden="true">✓</span></span>;
  if (status === 'sending') return <span role="status" aria-label="Enviando" className="ackClock" aria-hidden="false"><span aria-hidden="true">⏲</span></span>;
  if (status === 'offline_pending') return <span role="status" aria-label="Pendiente sin conexión" className="ackOffline" aria-hidden="false"><span aria-hidden="true">🕒</span></span>;
  return null;
}

const ChatSentiment = React.memo(function ChatSentiment({ lastMsg }) {
  if (!lastMsg) return null;
  const text = String(lastMsg.body || '').toLowerCase();
  const positive = ['bien', 'feliz', 'buen', 'genial', 'excelente', 'gracias', 'jaja', 'súper', 'super', ':)'];
  const negative = ['mal', 'triste', 'enojado', 'problema', 'tarde', 'perdón', 'perdon', 'fallo', 'error', ':('];
  let score = 0;
  positive.forEach(w => { if (text.includes(w)) score += 1; });
  negative.forEach(w => { if (text.includes(w)) score -= 1; });

  let sentiment = null;
  if (score > 0) sentiment = { emoji: "😊", color: "#10b981", label: "Positivo" };
  else if (score < 0) sentiment = { emoji: "😕", color: "#f43f5e", label: "Negativo" };

  if (!sentiment) return null;
  return (
    <span
      title={`Análisis de Sentimiento: ${sentiment.label}`}
      style={{
        fontSize: '11px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '18px',
        height: '18px',
        borderRadius: '50%',
        background: `${sentiment.color}20`,
        border: `1px solid ${sentiment.color}`,
        color: sentiment.color,
        marginLeft: '4px'
      }}
    >
      {sentiment.emoji}
    </span>
  );
});

function App() {
  const socketRef = useRef(null);
  const selectedChatIdRef = useRef("");
  const chatsRef = useRef([]);
  const messagesAreaRef = useRef(null);
  const shouldStickToBottomRef = useRef(true);
  const previousMessageCountRef = useRef(0);
  const previousSelectedChatIdRef = useRef("");
  const messageFetchReqIdRef = useRef(0);
  const grammarCheckInFlightRef = useRef(new Set());
  const grammarQueueRef = useRef([]);
  const grammarQueueSetRef = useRef(new Set());
  const grammarWorkersRef = useRef(0);
  const grammarInsightsRef = useRef({});
  const grammarFailuresRef = useRef(0);
  const grammarCooldownUntilRef = useRef(0);
  const grammarCooldownNoticeRef = useRef(0);
  const lastGrammarCheckAtRef = useRef(0);
  const searchInputRef = useRef(null);
  const draftInputRef = useRef(null);
  const syncRetryTimeoutRef = useRef(null);
  const syncAttemptsRef = useRef(0);

  const [apiAuthenticated, setApiAuthenticated] = useState(false);
  const [inputApiKey, setInputApiKey] = useState(localStorage.getItem("tapchat_api_key") || "");
  const [showApiKey, setShowApiKey] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [authError, setAuthError] = useState("");

  const [sessionStatus, setSessionStatus] = useState("connecting");
  const [socketConnected, setSocketConnected] = useState(false);
  const [qr, setQr] = useState("");
  const [backendStatus, setBackendStatus] = useState({
    providerStatus: "unknown",
    uptimeSec: 0,
    statusArchive: null
  });

  const [toasts, setToasts] = useState([]);

  function showNotice(text, type = "info") {
    const id = Date.now() + Math.random().toString(36);
    setToasts(prev => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  }

  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState({});
  const [correcting, setCorrecting] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendingType, setSendingType] = useState(null);
  const [correctingAndSending, setCorrectingAndSending] = useState(false);
  const [showResources, setShowResources] = useState(false);
  const [resources, setResources] = useState({ media: [], links: [], statuses: [] });
  const [loadingResources, setLoadingResources] = useState(false);
  const [loadingAiConfig, setLoadingAiConfig] = useState(false);
  const [savingAiConfig, setSavingAiConfig] = useState(false);
  const [checkingAiHealth, setCheckingAiHealth] = useState(false);
  const [aiHealth, setAiHealth] = useState(null);
  const [aiModels, setAiModels] = useState([]);
  const [showCloudflareToken, setShowCloudflareToken] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [offlineQueue, setOfflineQueueState] = useState([]);
  const [pwaUpdateAvailable, setPwaUpdateAvailable] = useState(null);
  const [isMobileLayout, setIsMobileLayout] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`).matches
      : false
  );

  const [chatSearch, setChatSearch] = useState("");
  const [localChatSearch, setLocalChatSearch] = useState("");
  const chatSearchDebounceRef = useRef(null);

  useEffect(() => {
    setLocalChatSearch(chatSearch);
  }, [chatSearch]);

  const handleChatSearchChange = (e) => {
    const val = e.target.value;
    setLocalChatSearch(val);
    if (chatSearchDebounceRef.current) {
      clearTimeout(chatSearchDebounceRef.current);
    }
    // ⚡ Bolt: Debounce the search input to prevent excessive React re-renders and hook recalculations
    chatSearchDebounceRef.current = setTimeout(() => {
      setChatSearch(val);
    }, 300);
  };

  const [chats, setChats] = useState([]);
  const [viewMode, setViewMode] = useState("chats");
  const [messagesByChat, setMessagesByChat] = useState({});
  const [selectedChatId, setSelectedChatId] = useState("");
  const [messages, setMessages] = useState([]);
  const [statusArchiveItems, setStatusArchiveItems] = useState([]);
  const [loadingStatusArchive, setLoadingStatusArchive] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [pendingIncomingCount, setPendingIncomingCount] = useState(0);
  const [draftsByChat, setDraftsByChat] = useState(() => { try { return JSON.parse(localStorage.getItem("tapchat_drafts") || "{}"); } catch (e) { return {}; } });
  const draft = draftsByChat[selectedChatId] || "";
  const setDraft = (val) => setDraftsByChat(prev => ({ ...prev, [selectedChatId]: val }));

  useEffect(() => {
    localStorage.setItem("tapchat_drafts", JSON.stringify(draftsByChat));
  }, [draftsByChat]);
  const [correctedDraft, setCorrectedDraft] = useState("");
  const debouncedDraftRef = useRef(null);
  const [replyTarget, setReplyTarget] = useState(null);
  const [grammarInsights, setGrammarInsights] = useState({});
  const [replyQueue, setReplyQueue] = useState([]);
  const [sendingReplyQueueIds, setSendingReplyQueueIds] = useState({});
  const [syncingChat, setSyncingChat] = useState(false);
  const [syncingChats, setSyncingChats] = useState(false);
  const [aiConfig, setAiConfig] = useState({
    provider: "lmstudio",
    aiBaseUrl: "",
    lmStudioBaseUrl: "",
    cloudflareAccountId: "",
    cloudflareApiToken: "",
    cloudflareBaseUrl: "",
    modelName: "",
    temperature: 0.7,
    maxTokens: 180,
    timeoutMs: 15000,
    systemPrompt: "",
    userPromptTemplate: ""
  });

  const [typingStates, setTypingStates] = useState({});
  const [showSetupWizard, setShowSetupWizard] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState("profile");

  const [currentUser, setCurrentUser] = useState(null);
  const currentUserRef = useRef(currentUser);
  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
  }, [selectedChatId]);
  const [authMode, setAuthMode] = useState("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [searchUserQuery, setSearchUserQuery] = useState("");
  const [searchUserResults, setSearchUserResults] = useState([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const searchUserDebounceRef = useRef(null);

  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [userBioInput, setUserBioInput] = useState("");
  const [userAvatarColorInput, setUserAvatarColorInput] = useState("");
  const [userUsernameInput, setUserUsernameInput] = useState("");
  const [userEmailInput, setUserEmailInput] = useState("");
  const [userPasswordInput, setUserPasswordInput] = useState("");
  const [userAvatarUrlInput, setUserAvatarUrlInput] = useState("");
  const [showNewStatusModal, setShowNewStatusModal] = useState(false);
  const [newStatusBody, setNewStatusBody] = useState("");
  const [newStatusBgTheme, setNewStatusBgTheme] = useState("landscape1");
  const [storyPlayList, setStoryPlayList] = useState([]);
  const [notifications, setNotifications] = useState([
    { id: 1, type: 'info', text: '¡Bienvenido a Tapchat! Comienza a chatear con otros usuarios buscando en la red.', time: 'Ahora' },
    { id: 2, type: 'success', text: 'Tu Asistente de IA personal está activo en el chat "AI Companion".', time: 'Hace 2 min' },
    { id: 3, type: 'warning', text: 'El servidor de IA está listo para recibir tus mensajes.', time: 'Hace 5 min' }
  ]);

  // States for Proximity Grid, Snapchat-style Public Wall, and Followed Stories
  const [proximityUsers, setProximityUsers] = useState([]);
  const [loadingProximity, setLoadingProximity] = useState(false);
  const [publicStatuses, setPublicStatuses] = useState([]);
  const [loadingPublicStatuses, setLoadingPublicStatuses] = useState(false);
  const [followedStories, setFollowedStories] = useState([]);
  const [loadingStories, setLoadingStories] = useState(false);
  const [newPublicStatusBody, setNewPublicStatusBody] = useState("");
  const [publishingStatus, setPublishingStatus] = useState(false);
  const [activeStoryIndex, setActiveStoryIndex] = useState(null);

  // States for Discord-style WebRTC Voice Calls
  const [localStream, setLocalStream] = useState(null);
  const [screenStream, setScreenStream] = useState(null);
  const [inVoiceCall, setInVoiceCall] = useState(false);
  const [voiceRoomId, setVoiceRoomId] = useState(null);
  const [voicePeers, setVoicePeers] = useState([]);
  const [isMuted, setIsMuted] = useState(false);
  const [activeCallState, setActiveCallState] = useState("idle"); // "idle", "calling", "incoming", "connected"
  const [incomingCallInfo, setIncomingCallInfo] = useState(null);
  const [outgoingCallInfo, setOutgoingCallInfo] = useState(null);
  const [callVolume, setCallVolume] = useState(80);

  useEffect(() => {
    if (isOffline && inVoiceCall) {
      showNotice("⚠️ Conexión perdida. Saliendo de la llamada...", "warning");
      leaveVoiceRoom();
    }
  }, [isOffline, inVoiceCall]);

  const peerConnectionsRef = useRef(new Map());
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const callRingtoneIntervalRef = useRef(null);
  const callAudioCtxRef = useRef(null);

  const startRingtone = (isIncoming) => {
    try {
      if (callAudioCtxRef.current) return;
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
  const candidateQueueRef = useRef(new Map()); // socketId -> Array of ICE candidates

  useEffect(() => {
    if (activeStoryIndex === null) return;
    const timer = setTimeout(() => {
      if (activeStoryIndex < storyPlayList.length - 1) {
        setActiveStoryIndex(activeStoryIndex + 1);
      } else {
        setActiveStoryIndex(null);
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, [activeStoryIndex, storyPlayList.length]);

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    if (currentUser) {
      setUserBioInput(currentUser.bio || "¡Hola! Estoy usando Tapchat.");
      setUserAvatarColorInput(currentUser.avatarColor || "hsl(200, 70%, 40%)");
      setUserUsernameInput(currentUser.username || "");
      setUserEmailInput(currentUser.email || "");
      setUserPasswordInput("");
      setUserAvatarUrlInput(currentUser.avatarUrl || "");
    }
  }, [currentUser]);

  function createPeerConnection(peerSocketId, peerInfo, isOfferOriginator) {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
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

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        showNotice(`⚠️ Se cortó la conexión con ${peerInfo.username || "un participante"}.`, "warning");
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

    if (isOfferOriginator) {
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

  async function joinVoiceRoom(roomId, isAccepting = false) {
    if (!roomId) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      setLocalStream(stream);
      
      socketRef.current.emit('join-voice-room', { roomId });
      setInVoiceCall(true);
      setVoiceRoomId(roomId);
      
      if (isAccepting) {
        stopRingtone();
        setActiveCallState("connected");
        setIncomingCallInfo(null);
      } else {
        setActiveCallState("calling");
        setOutgoingCallInfo({ roomId, recipientName: selectedChat?.name || "Usuario" });
        startRingtone(false);
      }
      
      showNotice("🎙️ Canal de voz iniciado.", "success");
    } catch (e) {
      console.error("Error joining voice room:", e);
      showNotice("No se pudo acceder al micrófono para la llamada.", "error");
      stopRingtone();
      setActiveCallState("idle");
    }
  }

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
    setLocalStream(null);
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
    showNotice("🚪 Has abandonado la llamada.", "info");
  }

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      const nextMute = !isMuted;
      audioTracks.forEach(track => {
        track.enabled = !nextMute;
      });
      setIsMuted(nextMute);
      showNotice(nextMute ? "🎤 Micrófono silenciado" : "🎤 Micrófono activo", "info");
    }
  };

  const startScreenShare = async () => {
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
      
      showNotice("🖥️ Compartiendo pantalla.", "success");
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
    showNotice("🖥️ Se dejó de compartir pantalla.", "info");
  };

  async function saveUserProfile() {
    const profilePayload = {
      username: userUsernameInput,
      email: userEmailInput,
      password: userPasswordInput,
      bio: userBioInput,
      avatarColor: userAvatarColorInput,
      avatarUrl: userAvatarUrlInput
    };
    if (!navigator.onLine || isOffline) {
      setCurrentUser(prev => ({
        ...prev,
        username: userUsernameInput,
        email: userEmailInput,
        bio: userBioInput,
        avatarColor: userAvatarColorInput,
        avatarUrl: userAvatarUrlInput
      }));
      const provider = "local";
      const accountId = currentUser?.id || DEFAULT_ACCOUNT_ID;
      const optimisticAction = {
        _uiId: `profile-${Date.now()}`,
        type: 'update_profile',
        payload: profilePayload
      };
      const nextQueue = [...offlineQueue, optimisticAction];
      setOfflineQueueState(nextQueue);
      await setOfflineQueue(provider, accountId, nextQueue);
      showNotice("📱 Sin conexión. Cambios de perfil guardados localmente y se sincronizarán al reconectar.", "success");
      setShowProfileMenu(false);
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/auth/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profilePayload)
      });
      if (res.ok) {
        const data = await res.json();
        setCurrentUser(prev => ({
          ...prev,
          username: data.user.username,
          email: data.user.email,
          bio: data.user.bio,
          avatarColor: data.user.avatarColor,
          avatarUrl: data.user.avatarUrl
        }));
        showNotice("Perfil actualizado correctamente.", "success");
        setShowProfileMenu(false);
      } else {
        const errorData = await res.json();
        showNotice(errorData.error || "No se pudo actualizar el perfil.", "error");
      }
    } catch (err) {
      showNotice("Error de conexión al guardar el perfil.", "error");
    }
  }

  const toggleProfileMenu = () => {
    const nextVal = !showProfileMenu;
    setShowProfileMenu(nextVal);
    if (nextVal) {
      fetchAiConfig();
      fetchAiModels();
    }
  };

  async function loadProximityUsers() {
    setLoadingProximity(true);
    try {
      const res = await fetch(`${API_URL}/api/users/proximity`);
      if (res.ok) {
        const data = await res.json();
        setProximityUsers(data);
      }
    } catch (err) {
      console.error("Error loading proximity users:", err);
    } finally {
      setLoadingProximity(false);
    }
  }

  async function toggleFollowUser(userId, isFollowed) {
    if (!navigator.onLine || isOffline) {
      setProximityUsers(prev => prev.map(u => u._id === userId ? { ...u, isFollowed: !isFollowed } : u));
      const provider = "local";
      const accountId = currentUser?.id || DEFAULT_ACCOUNT_ID;
      const optimisticAction = {
        _uiId: `follow-${Date.now()}`,
        type: 'toggle_follow',
        payload: { userId, isFollowed }
      };
      const nextQueue = [...offlineQueue, optimisticAction];
      setOfflineQueueState(nextQueue);
      await setOfflineQueue(provider, accountId, nextQueue);
      showNotice(isFollowed ? "📱 Sin conexión. Se dejará de seguir al reconectarse." : "📱 Sin conexión. Se seguirá al reconectarse.", "success");
      return;
    }
    try {
      const endpoint = isFollowed ? 'unfollow' : 'follow';
      const res = await fetch(`${API_URL}/api/users/${userId}/${endpoint}`, {
        method: "POST"
      });
      if (res.ok) {
        const data = await res.json();
        setProximityUsers(prev => prev.map(u => u._id === userId ? { ...u, isFollowed: !isFollowed } : u));
        showNotice(isFollowed ? "Dejaste de seguir al usuario." : "¡Ahora sigues a este usuario!", "success");
        loadFollowedStories();
      }
    } catch (err) {
      console.error("Error toggling follow:", err);
    }
  }

  async function loadPublicStatuses() {
    setLoadingPublicStatuses(true);
    try {
      const res = await fetch(`${API_URL}/api/public-statuses`);
      if (res.ok) {
        const data = await res.json();
        setPublicStatuses(data);
      }
    } catch (err) {
      console.error("Error loading public statuses:", err);
    } finally {
      setLoadingPublicStatuses(false);
    }
  }

  async function publishPublicStatus() {
    if (!newPublicStatusBody.trim()) return;
    const bgImages = [
      "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=400&q=80",
      "https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&w=400&q=80",
      "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=400&q=80",
      "https://images.unsplash.com/photo-1475924156734-496f6cac6ec1?auto=format&fit=crop&w=400&q=80",
      "https://images.unsplash.com/photo-1433832597026-488b418f2bd3?auto=format&fit=crop&w=400&q=80"
    ];
    const randomBg = bgImages[Math.floor(Math.random() * bgImages.length)];

    if (!navigator.onLine || isOffline) {
      const optimisticStatus = {
        _id: `temp-status-${Date.now()}`,
        userId: currentUser?.id || 'me',
        username: currentUser?.username || 'Yo',
        avatarColor: currentUser?.avatarColor || 'hsl(200, 70%, 40%)',
        avatarUrl: currentUser?.avatarUrl || '',
        body: newPublicStatusBody,
        mediaUrl: randomBg,
        mediaType: "image",
        likesCount: 0,
        viewsCount: 0,
        likedBy: [],
        viewedBy: [],
        createdAt: new Date().toISOString(),
        isOfflinePending: true
      };
      setPublicStatuses(prev => [optimisticStatus, ...prev]);
      const provider = "local";
      const accountId = currentUser?.id || DEFAULT_ACCOUNT_ID;
      const optimisticAction = {
        _uiId: `publish-pub-${Date.now()}`,
        type: 'publish_status_public',
        payload: { body: newPublicStatusBody, mediaUrl: randomBg, mediaType: "image" }
      };
      const nextQueue = [...offlineQueue, optimisticAction];
      setOfflineQueueState(nextQueue);
      await setOfflineQueue(provider, accountId, nextQueue);
      setNewPublicStatusBody("");
      showNotice("📱 Sin conexión. Estado en cola para publicar en el muro.", "info");
      return;
    }

    setPublishingStatus(true);
    try {
      const res = await fetch(`${API_URL}/api/public-statuses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: newPublicStatusBody,
          mediaUrl: randomBg,
          mediaType: "image"
        })
      });
      if (res.ok) {
        setNewPublicStatusBody("");
        showNotice("¡Estado publicado en el muro!", "success");
        loadPublicStatuses();
      }
    } catch (err) {
      console.error("Error publishing status:", err);
      showNotice("Error al publicar estado.", "error");
    } finally {
      setPublishingStatus(false);
    }
  }

  async function publishPersonalStatus() {
    if (!newStatusBody.trim()) return;
    const bgImages = {
      landscape1: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=400&q=80",
      landscape2: "https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&w=400&q=80",
      landscape3: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=400&q=80",
      landscape4: "https://images.unsplash.com/photo-1475924156734-496f6cac6ec1?auto=format&fit=crop&w=400&q=80",
      landscape5: "https://images.unsplash.com/photo-1433832597026-488b418f2bd3?auto=format&fit=crop&w=400&q=80"
    };
    const selectedBg = bgImages[newStatusBgTheme] || bgImages.landscape1;

    if (!navigator.onLine || isOffline) {
      const optimisticArchive = {
        _id: `temp-archive-${Date.now()}`,
        statusOwnerId: currentUser?.id || 'me',
        statusOwnerName: currentUser?.username || 'Yo',
        description: newStatusBody,
        imageUrl: selectedBg,
        mediaUrl: selectedBg,
        mediaType: "image",
        timestamp: Math.floor(Date.now() / 1000),
        isOfflinePending: true
      };
      setStatusArchiveItems(prev => [optimisticArchive, ...prev]);
      const provider = "local";
      const accountId = currentUser?.id || DEFAULT_ACCOUNT_ID;
      const optimisticAction = {
        _uiId: `publish-pers-${Date.now()}`,
        type: 'publish_status_personal',
        payload: { body: newStatusBody, mediaUrl: selectedBg, mediaType: "image" }
      };
      const nextQueue = [...offlineQueue, optimisticAction];
      setOfflineQueueState(nextQueue);
      await setOfflineQueue(provider, accountId, nextQueue);
      setNewStatusBody("");
      setShowNewStatusModal(false);
      showNotice("📱 Sin conexión. Estado personal en cola para publicar.", "info");
      return;
    }

    setPublishingStatus(true);
    try {
      const res = await fetch(`${API_URL}/api/public-statuses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: newStatusBody,
          mediaUrl: selectedBg,
          mediaType: "image"
        })
      });
      if (res.ok) {
        setNewStatusBody("");
        setShowNewStatusModal(false);
        showNotice("¡Tu estado ha sido publicado!", "success");
        loadPublicStatuses();
      }
    } catch (err) {
      console.error("Error publishing personal status:", err);
      showNotice("Error al publicar tu estado.", "error");
    } finally {
      setPublishingStatus(false);
    }
  }

  async function likePublicStatus(statusId) {
    if (!navigator.onLine || isOffline) {
      setPublicStatuses(prev => prev.map(s => {
        if (s._id !== statusId) return s;
        const willLike = !s.isLiked;
        return {
          ...s,
          isLiked: willLike,
          likesCount: Math.max(0, s.likesCount + (willLike ? 1 : -1))
        };
      }));
      const provider = "local";
      const accountId = currentUser?.id || DEFAULT_ACCOUNT_ID;
      const optimisticAction = {
        _uiId: `like-${statusId}-${Date.now()}`,
        type: 'like_status',
        payload: { statusId }
      };
      const nextQueue = [...offlineQueue, optimisticAction];
      setOfflineQueueState(nextQueue);
      await setOfflineQueue(provider, accountId, nextQueue);
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/public-statuses/${statusId}/like`, {
        method: "POST"
      });
      if (res.ok) {
        const data = await res.json();
        setPublicStatuses(prev => prev.map(s => s._id === statusId ? { ...s, likesCount: data.likesCount, isLiked: data.isLiked } : s));
      }
    } catch (err) {
      console.error("Error liking status:", err);
    }
  }

  async function viewPublicStatus(statusId) {
    if (!navigator.onLine || isOffline) {
      setPublicStatuses(prev => prev.map(s => {
        if (s._id !== statusId) return s;
        return {
          ...s,
          viewsCount: s.viewsCount + 1
        };
      }));
      const provider = "local";
      const accountId = currentUser?.id || DEFAULT_ACCOUNT_ID;
      const optimisticAction = {
        _uiId: `view-${statusId}-${Date.now()}`,
        type: 'view_status',
        payload: { statusId }
      };
      const nextQueue = [...offlineQueue, optimisticAction];
      setOfflineQueueState(nextQueue);
      await setOfflineQueue(provider, accountId, nextQueue);
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/public-statuses/${statusId}/view`, {
        method: "POST"
      });
      if (res.ok) {
        const data = await res.json();
        setPublicStatuses(prev => prev.map(s => s._id === statusId ? { ...s, viewsCount: data.viewsCount } : s));
      }
    } catch (err) {
      console.error("Error viewing status:", err);
    }
  }

  async function loadFollowedStories() {
    setLoadingStories(true);
    try {
      const res = await fetch(`${API_URL}/api/followed-statuses`);
      if (res.ok) {
        const data = await res.json();
        setFollowedStories(data);
      }
    } catch (err) {
      console.error("Error loading followed stories:", err);
    } finally {
      setLoadingStories(false);
    }
  }

  async function loadDirectoryUsers(query = "") {
    setSearchingUsers(true);
    try {
      const res = await fetch(`${API_URL}/api/users/search?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        setSearchUserResults(data);
      }
    } catch (err) {
      console.error("Error loading directory users:", err);
    } finally {
      setSearchingUsers(false);
    }
  }

  useEffect(() => {
    if (showNewChatModal) {
      loadDirectoryUsers("");
    } else {
      setSearchUserQuery("");
      setSearchUserResults([]);
    }
  }, [showNewChatModal]);

  const selectedChat = useMemo(
    () => chats.find((chat) => chat.id === selectedChatId),
    [chats, selectedChatId]
  );

  const filteredChats = useMemo(() => {
    const needle = chatSearch.trim().toLowerCase();
    if (!needle) return chats;
    return chats.filter((chat) => {
      const label = `${chat.name || ""} ${chat.id || ""}`.toLowerCase();
      return label.includes(needle);
    });
  }, [chats, chatSearch]);

  const totalUnread = useMemo(
    () => chats.reduce((acc, chat) => acc + Number(chat.unreadCount || 0), 0),
    [chats]
  );

  const filteredStatusArchive = useMemo(() => {
    const needle = chatSearch.trim().toLowerCase();
    if (!needle) return statusArchiveItems;
    return statusArchiveItems.filter((item) => {
      const haystack = `${item.statusOwnerName || ""} ${item.statusOwnerId || ""} ${item.description || ""}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [chatSearch, statusArchiveItems]);

  const filteredProximityUsers = useMemo(() => {
    const needle = chatSearch.trim().toLowerCase();
    if (!needle) return proximityUsers;
    return proximityUsers.filter((u) => {
      const label = `${u.username || ""} ${u.bio || ""}`.toLowerCase();
      return label.includes(needle);
    });
  }, [chatSearch, proximityUsers]);

  const filteredPublicStatuses = useMemo(() => {
    const needle = chatSearch.trim().toLowerCase();
    if (!needle) return publicStatuses;
    return publicStatuses.filter((s) => {
      const label = `${s.username || ""} ${s.body || ""}`.toLowerCase();
      return label.includes(needle);
    });
  }, [chatSearch, publicStatuses]);

  const connectionLabel = useMemo(() => {
    if (!socketConnected) return "Desconectado de la red de Tapchat";
    return "Servidor En línea (WebSocket)";
  }, [socketConnected]);

  const dotClass = useMemo(() => {
    if (!socketConnected) return "bad";
    return "ok";
  }, [socketConnected]);

  const authScreenLabel = useMemo(() => {
    if (!socketConnected) return "Conectando al servidor...";
    if (sessionStatus === "qr") return "Vincular proveedor";
    if (sessionStatus === "auth_failure") return "No se pudo iniciar sesión. Por favor, asegúrate de que el dispositivo siga vinculado.";
    if (sessionStatus === "disconnected") return "El proveedor se ha desconectado. Intenta reconectar.";
    return "Iniciando sesión con el proveedor...";
  }, [sessionStatus, socketConnected]);




  function isNearBottom(container) {
    if (!container) return true;
    return container.scrollHeight - container.scrollTop - container.clientHeight <= 84;
  }

  function scrollMessagesToBottom(behavior = "auto") {
    const container = messagesAreaRef.current;
    if (!container) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior
    });
    shouldStickToBottomRef.current = true;
    setShowJumpToLatest(false);
    setPendingIncomingCount(0);
  }

  function handleMessagesScroll() {
    const container = messagesAreaRef.current;
    if (!container) return;
    const nearBottom = isNearBottom(container);
    shouldStickToBottomRef.current = nearBottom;
    if (nearBottom) {
      setShowJumpToLatest(false);
      setPendingIncomingCount(0);
    } else if (messages.length > 0) {
      setShowJumpToLatest(true);
    }
  }

  function autoResizeDraftInput() {
    const input = draftInputRef.current;
    if (!input) return;
    const maxHeight = 180;
    input.style.height = "auto";
    const nextHeight = Math.min(input.scrollHeight, maxHeight);
    input.style.height = `${nextHeight}px`;
    input.style.overflowY = input.scrollHeight > maxHeight ? "auto" : "hidden";
  }

  function canonicalText(text) {
    return String(text || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function hasMeaningfulCorrection(original, corrected) {
    const a = canonicalText(original);
    const b = canonicalText(corrected);
    if (!a || !b) return false;
    return a !== b;
  }

  function onGrammarCheckFailure() {
    grammarFailuresRef.current += 1;
    if (grammarFailuresRef.current < 4) return;

    const cooldownMs = 45000;
    grammarCooldownUntilRef.current = Date.now() + cooldownMs;
    grammarFailuresRef.current = 0;

    if (Date.now() - grammarCooldownNoticeRef.current > 15000) {
      grammarCooldownNoticeRef.current = Date.now();
      showNotice("La revisión gramatical automática se pausó temporalmente por errores de IA.", "info");
    }
  }

  function onGrammarCheckSuccess() {
    grammarFailuresRef.current = 0;
  }

  async function checkGrammarForMessage(msg) {
    if (!msg || msg.fromMe) return;
    const text = String(msg.body || "").trim();
    if (!text || text.length < 3 || text.length > 450) return;
    if (Date.now() < grammarCooldownUntilRef.current) return;
    const key = msg._uiId || messageId(msg);
    if (!key) return;
    if (grammarCheckInFlightRef.current.has(key)) return;
    if (grammarInsightsRef.current[key] !== undefined) return;

    grammarCheckInFlightRef.current.add(key);
    try {
      const res = await fetch(`${API_URL}/api/correct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });
      if (!res.ok) {
        onGrammarCheckFailure();
        return;
      }
      const data = await res.json();
      const corrected = String(data.corrected || "").trim();
      const hasErrors = hasMeaningfulCorrection(text, corrected);
      onGrammarCheckSuccess();
      setGrammarInsights((prev) => ({
        ...prev,
        [key]: {
          hasErrors,
          original: text,
          corrected: corrected || text
        }
      }));
    } catch (_error) {
      onGrammarCheckFailure();
    } finally {
      grammarCheckInFlightRef.current.delete(key);
      grammarQueueSetRef.current.delete(key);
    }
  }

  const grammarTimerRef = useRef(null);
  function runGrammarQueue() {
    if (Date.now() < grammarCooldownUntilRef.current) return;
    if (grammarTimerRef.current) return;

    const now = Date.now();
    const timeSinceLast = now - lastGrammarCheckAtRef.current;
    if (timeSinceLast < 2000) {
      grammarTimerRef.current = setTimeout(() => {
        grammarTimerRef.current = null;
        runGrammarQueue();
      }, 2000 - timeSinceLast);
      return;
    }

    const maxWorkers = 1;
    if (grammarWorkersRef.current < maxWorkers && grammarQueueRef.current.length > 0) {
      const nextMsg = grammarQueueRef.current.shift();
      grammarWorkersRef.current += 1;
      lastGrammarCheckAtRef.current = Date.now();

      checkGrammarForMessage(nextMsg).finally(() => {
        grammarWorkersRef.current -= 1;
        grammarTimerRef.current = setTimeout(() => {
          grammarTimerRef.current = null;
          runGrammarQueue();
        }, 2000);
      });
    }
  }

  function enqueueGrammarCheck(msg) {
    const key = msg?._uiId || messageId(msg);
    if (!key) return;
    if (grammarInsightsRef.current[key] !== undefined) return;
    if (grammarCheckInFlightRef.current.has(key)) return;
    if (grammarQueueSetRef.current.has(key)) return;
    grammarQueueSetRef.current.add(key);
    grammarQueueRef.current.push(msg);
    runGrammarQueue();
  }

  function mergeLiveMessage(msg) {
    if (!msg?.chatId) return;
    const normalized = { ...msg, _uiId: messageId(msg) };
    
    const isCurrentChat = selectedChatIdRef.current === msg.chatId;
    const isAppBackgrounded = document.hidden;

    if (!msg.fromMe) {
      const senderName = msg.from === 'ai_assistant' ? 'AI Companion' : (msg.from || 'Usuario');
      const previewText = msg.body ? (msg.body.length > 50 ? `${msg.body.slice(0, 50)}...` : msg.body) : 'Nuevo archivo recibido';

      if (isCurrentChat) {
        markChatAsRead(msg.chatId);
      } else {
        // 1. In-app toast notification
        showNotice(`💬 ${senderName}: ${previewText}`, "info");

        // 2. Add to Notifications history
        setNotifications(prev => [
          {
            id: Date.now(),
            type: 'message',
            text: `Mensaje de ${senderName}: "${previewText}"`,
            time: 'Ahora'
          },
          ...prev
        ]);
      }

      // 3. Desktop/OS Browser Notification (if backgrounded or not in active chat)
      if (isAppBackgrounded || !isCurrentChat) {
        if ("Notification" in window && Notification.permission === "granted") {
          try {
            const title = `Tapchat - ${senderName}`;
            const options = {
              body: previewText,
              icon: '/pwa-192x192.png',
              tag: msg.chatId,
              data: { chatId: msg.chatId }
            };
            if (navigator.serviceWorker && navigator.serviceWorker.ready) {
              navigator.serviceWorker.ready.then(registration => {
                registration.showNotification(title, options);
              });
            } else {
              new Notification(title, options);
            }
          } catch (e) {
            console.error("Error creating browser notification:", e);
          }
        }
      }
    }
    setChats((prev) => {
      const exists = prev.find((chat) => chat.id === msg.chatId);
      if (!exists) {
        // Dynamic fetch of the newly created chat to ensure we load its readable metadata (name, avatar)
        setTimeout(() => {
          fetchChats(false);
        }, 100);
      }
      const next = exists
        ? prev.map((chat) => {
            if (chat.id !== msg.chatId) return chat;
            const isSelected = selectedChatIdRef.current === msg.chatId;
            const isIncoming = !msg.fromMe;
            const nextUnread = isIncoming && !isSelected ? Number(chat.unreadCount || 0) + 1 : 0;
            return {
              ...chat,
              timestamp: msg.timestamp || chat.timestamp,
              unreadCount: nextUnread
            };
          })
        : [
            {
              id: msg.chatId,
              name: msg.chatId,
              timestamp: msg.timestamp || Math.floor(Date.now() / 1000),
              unreadCount: msg.fromMe ? 0 : 1
            },
            ...prev
          ];

      return [...next].sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
    });

    setMessagesByChat((prev) => {
      const current = prev[msg.chatId] || [];
      if (current.some((item) => item._uiId === normalized._uiId)) return prev;
      const merged = [...current, normalized].sort(
        (a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0)
      );
      if (selectedChatIdRef.current === msg.chatId) {
        setMessages(merged);
      }
      return { ...prev, [msg.chatId]: merged };
    });
  }

  const handleLogout = () => {
    localStorage.removeItem("tapchat_token");
    localStorage.removeItem("tapchat_api_key");
    setApiAuthenticated(false);
    setCurrentUser(null);
    setSessionStatus("connecting");
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    clearCache().catch(() => {});
  };

  useEffect(() => {
    const handleAuthError = () => {
      handleLogout();
      setAuthError("La sesión expiró o es inválida.");
    };
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    const handlePwaUpdate = (e) => setPwaUpdateAvailable(() => e.detail.updateSW);

    window.addEventListener('tapchat_auth_error', handleAuthError);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener("pwa_update_available", handlePwaUpdate);

    return () => {
      window.removeEventListener('tapchat_auth_error', handleAuthError);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener("pwa_update_available", handlePwaUpdate);
    };
  }, []);

  useEffect(() => {
    if (apiAuthenticated && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().then(permission => {
        if (permission === "granted") {
          showNotice("🔔 ¡Notificaciones nativas del sistema activadas!", "success");
        }
      });
    }
  }, [apiAuthenticated]);


  const checkAuth = async (key) => {
    setAuthChecking(true);
    setAuthError("");
    try {
      const res = await originalFetch(`${API_URL}/api/check-auth`, {
        headers: { 'Authorization': `Bearer ${key}` }
      });
      if (res.ok) {
        const data = await res.json();
        localStorage.setItem("tapchat_token", key);
        localStorage.setItem("tapchat_cached_user", JSON.stringify(data.user));
        setCurrentUser(data.user);
        setApiAuthenticated(true);
      } else {
        setApiAuthenticated(false);
        setAuthError("Sesión inválida. Por favor, iniciá sesión.");
        localStorage.removeItem("tapchat_token");
        localStorage.removeItem("tapchat_api_key");
        localStorage.removeItem("tapchat_cached_user");
        clearCache().catch(() => {});
      }
    } catch (e) {
      const cachedUserStr = localStorage.getItem("tapchat_cached_user");
      if (cachedUserStr) {
        try {
          const cachedUser = JSON.parse(cachedUserStr);
          setCurrentUser(cachedUser);
          setApiAuthenticated(true);
          showNotice("📶 Modo sin conexión activado. Usando sesión guardada.", "info");
        } catch (_) {
          setApiAuthenticated(false);
          setAuthError("Error de conexión al verificar credenciales.");
        }
      } else {
        setApiAuthenticated(false);
        setAuthError("Error de conexión al verificar credenciales.");
      }
    }
    setAuthChecking(false);
  };

  useEffect(() => {
    const savedKey = localStorage.getItem("tapchat_token") || localStorage.getItem("tapchat_api_key");
    if (savedKey) checkAuth(savedKey);
    else setAuthChecking(false);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`);
    const handleChange = (event) => {
      setIsMobileLayout(event.matches);
      if (!event.matches && !selectedChatIdRef.current && chatsRef.current?.length > 0) {
        setSelectedChatId(chatsRef.current[0].id);
        selectedChatIdRef.current = chatsRef.current[0].id;
      }
    };
    setIsMobileLayout(mediaQuery.matches);
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  useEffect(() => {
    if (!apiAuthenticated) {
      if (socketRef.current) { socketRef.current.close(); socketRef.current = null; }
      return;
    }

    const socket = io(SOCKET_URL, {
      transports: ["websocket"],
      auth: { token: localStorage.getItem("tapchat_token") || localStorage.getItem("tapchat_api_key") || "" },
      reconnection: true,
      reconnectionAttempts: Infinity
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setSocketConnected(true);
      setSessionStatus("socket_connected");
    });
    socket.on("disconnect", () => {
      setSocketConnected(false);
    });
    socket.on("connect_error", () => {
      setSocketConnected(false);
    });
    socket.on("qr", (payload) => {
      const eventProvider = payload?.provider || DEFAULT_PROVIDER;
      const eventAccountId = payload?.accountId || DEFAULT_ACCOUNT_ID;
      const validAccountId = currentUserRef.current?.id || DEFAULT_ACCOUNT_ID;
      if (!(eventProvider === DEFAULT_PROVIDER && eventAccountId === DEFAULT_ACCOUNT_ID) && 
          !(eventProvider === 'local' && String(eventAccountId) === String(validAccountId))) {
        return;
      }
      setQr(payload?.qr || (typeof payload === 'string' ? payload : "")); // payload can be the string itself backward compat
      setSessionStatus("qr");
    });
    socket.on("ready", (payload) => {
      const eventProvider = payload?.provider || DEFAULT_PROVIDER;
      const eventAccountId = payload?.accountId || DEFAULT_ACCOUNT_ID;
      const validAccountId = currentUserRef.current?.id || DEFAULT_ACCOUNT_ID;
      if (!(eventProvider === DEFAULT_PROVIDER && eventAccountId === DEFAULT_ACCOUNT_ID) && 
          !(eventProvider === 'local' && String(eventAccountId) === String(validAccountId))) {
        return;
      }
      setQr("");
      setSessionStatus("authenticated");
    });
    socket.on("auth_failure", (payload) => {
      const eventProvider = payload?.provider || DEFAULT_PROVIDER;
      const eventAccountId = payload?.accountId || DEFAULT_ACCOUNT_ID;
      const validAccountId = currentUserRef.current?.id || DEFAULT_ACCOUNT_ID;
      if (!(eventProvider === DEFAULT_PROVIDER && eventAccountId === DEFAULT_ACCOUNT_ID) && 
          !(eventProvider === 'local' && String(eventAccountId) === String(validAccountId))) {
        return;
      }
      setSessionStatus("auth_failure");
      showNotice("Fallo de autenticación del proveedor.", "error");
    });
    socket.on("disconnected", (payload) => {
      const eventProvider = payload?.provider || DEFAULT_PROVIDER;
      const eventAccountId = payload?.accountId || DEFAULT_ACCOUNT_ID;
      const validAccountId = currentUserRef.current?.id || DEFAULT_ACCOUNT_ID;
      if (!(eventProvider === DEFAULT_PROVIDER && eventAccountId === DEFAULT_ACCOUNT_ID) && 
          !(eventProvider === 'local' && String(eventAccountId) === String(validAccountId))) {
        return;
      }
      setSessionStatus("disconnected");
      showNotice("La sesión del proveedor se desconectó.", "error");
    });
    const handleNewMessage = (payload) => {
      const eventProvider = payload?.provider || DEFAULT_PROVIDER;
      const eventAccountId = payload?.accountId || DEFAULT_ACCOUNT_ID;
      const validAccountId = currentUserRef.current?.id || DEFAULT_ACCOUNT_ID;
      if (!(eventProvider === DEFAULT_PROVIDER && eventAccountId === DEFAULT_ACCOUNT_ID) && 
          !(eventProvider === 'local' && String(eventAccountId) === String(validAccountId))) {
        return;
      }
      mergeLiveMessage(payload);
    };
    socket.on("new_message", handleNewMessage);
    socket.on("chat_state", (payload) => {
      if (payload && payload.chatId) {
        setTypingStates((prev) => ({
          ...prev,
          [payload.chatId]: payload.state === 'typing'
        }));
      }
    });
    socket.on("message_updated", (updated) => {
      const eventProvider = updated?.provider || DEFAULT_PROVIDER;
      const eventAccountId = updated?.accountId || DEFAULT_ACCOUNT_ID;
      const validAccountId = currentUserRef.current?.id || DEFAULT_ACCOUNT_ID;
      if (!(eventProvider === DEFAULT_PROVIDER && eventAccountId === DEFAULT_ACCOUNT_ID) && 
          !(eventProvider === 'local' && String(eventAccountId) === String(validAccountId))) {
        return;
      }

      const normalized = { ...updated, _uiId: messageId(updated) };
      setMessagesByChat((prev) => {
        const current = prev[updated.chatId] || [];
        const next = current.map((m) => (m.id === updated.id || m._uiId === updated._uiId) ? { ...m, ...normalized } : m);
        if (selectedChatIdRef.current === updated.chatId) {
          setMessages(next);
        }
        return { ...prev, [updated.chatId]: next };
      });
    });

    // 🎙️ Voice Calls Socket Listeners
    socket.on("voice-room-peers", ({ peers }) => {
      setVoicePeers(peers.map(p => ({ ...p, stream: null })));
      peers.forEach(peer => {
        createPeerConnection(peer.socketId, peer, true);
      });
    });

    socket.on("voice-peer-joined", (peer) => {
      stopRingtone();
      setActiveCallState("connected");
      setVoicePeers(prev => {
        if (prev.some(p => p.socketId === peer.socketId)) return prev;
        return [...prev, { ...peer, stream: null }];
      });
      createPeerConnection(peer.socketId, peer, false);
    });

    socket.on("voice-peer-left", ({ socketId }) => {
      setVoicePeers(prev => prev.filter(p => p.socketId !== socketId));
      const pc = peerConnectionsRef.current.get(socketId);
      if (pc) {
        pc.close();
        peerConnectionsRef.current.delete(socketId);
      }
    });

    socket.on("voice-signal", ({ from, signal }) => {
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
    });

    socket.on("incoming-voice-call", ({ roomId, hostName, hostId, hostSocketId }) => {
      setActiveCallState("incoming");
      setIncomingCallInfo({ roomId, hostName, hostId, hostSocketId: hostSocketId || hostId });
      startRingtone(true);
      showNotice(`📞 Llamada de voz entrante de ${hostName}.`, "info");
      
      if (document.hidden && "Notification" in window && Notification.permission === "granted") {
        try {
          new Notification(`Llamada entrante - Tapchat`, {
            body: `${hostName} te está llamando de voz.`,
            icon: '/pwa-192x192.png',
            tag: roomId
          });
        } catch (e) {
          console.error("Error creating call notification:", e);
        }
      }
      
      setNotifications(prev => [
        {
          id: Date.now(),
          type: 'call',
          text: `Llamada entrante de ${hostName}`,
          time: 'Ahora'
        },
        ...prev
      ]);
    });

    socket.on("voice-call-rejected", ({ roomId, rejecterId }) => {
      stopRingtone();
      leaveVoiceRoom();
      showNotice("❌ La llamada fue rechazada.", "error");
    });

    socket.on("voice-call-cancelled", ({ roomId }) => {
      stopRingtone();
      setActiveCallState("idle");
      setIncomingCallInfo(null);
      showNotice("📞 La llamada fue cancelada.", "info");
    });

    return () => {
      socket.off("new_message", handleNewMessage);
      socket.off("voice-room-peers");
      socket.off("voice-peer-joined");
      socket.off("voice-peer-left");
      socket.off("voice-signal");
      socket.off("incoming-voice-call");
      socket.off("voice-call-rejected");
      socket.off("voice-call-cancelled");
      socket.close();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }
      peerConnectionsRef.current.forEach(pc => pc.close());
      peerConnectionsRef.current.clear();
      stopRingtone();
    };
  }, [apiAuthenticated]);

  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
    setReplyTarget(null);
    setReplyQueue([]);
    setSendingReplyQueueIds({});
    setShowJumpToLatest(false);
    setPendingIncomingCount(0);
    shouldStickToBottomRef.current = true;
    previousMessageCountRef.current = 0;

    if (!selectedChatId) {
      setMessages([]);
      return;
    }

    setChats((prev) =>
      prev.map((item) => (item.id === selectedChatId ? { ...item, unreadCount: 0 } : item))
    );
    markChatAsRead(selectedChatId);
    const cached = messagesByChat[selectedChatId] || [];
    setMessages(cached);
    const needLoader = cached.length === 0;
    if (needLoader) {
      setLoadingMessages((prev) => ({ ...prev, [selectedChatId]: true }));
    }
    fetchMessages(selectedChatId, {
      withLoader: needLoader,
      background: !needLoader
    });
  }, [selectedChatId]);

  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      // Escape to close modals and clear context states
      if (e.key === 'Escape') {
        if (showResources) setShowResources(false);
        if (showProfileMenu) setShowProfileMenu(false);
        if (replyTarget) setReplyTarget(null);
        if (showNewChatModal) setShowNewChatModal(false);
        if (showNewStatusModal) setShowNewStatusModal(false);
        if (activeStoryIndex !== null) setActiveStoryIndex(null);
        return; // Don't prevent default, just handle our local logic
      }

      // Ctrl+K to search
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }

      // Alt + Up/Down to navigate chats
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        if (filteredChats.length === 0) return;

        const currentIndex = filteredChats.findIndex(c => c.id === selectedChatId);
        let nextIndex = 0;

        if (e.key === 'ArrowUp') {
          nextIndex = currentIndex <= 0 ? filteredChats.length - 1 : currentIndex - 1;
        } else {
          nextIndex = currentIndex >= filteredChats.length - 1 ? 0 : currentIndex + 1;
        }

        const nextChat = filteredChats[nextIndex];
        if (nextChat) {
          setSelectedChatId(nextChat.id);
          // Auto-scroll to active chat item could be added here
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [filteredChats, selectedChatId, showResources, showProfileMenu, replyTarget, showNewChatModal, showNewStatusModal, activeStoryIndex]);

  useEffect(() => {
    localStorage.setItem("tapchat_drafts", JSON.stringify(draftsByChat));
  }, [draftsByChat]);

  useEffect(() => {
    if (!apiAuthenticated) return;
    if (viewMode === "discover") {
      loadProximityUsers();
      loadFollowedStories();
    } else if (viewMode === "muro") {
      loadPublicStatuses();
    }
  }, [viewMode, apiAuthenticated]);

  useEffect(() => {
    if (!Array.isArray(chats) || chats.length === 0) return;
    setCachedChats("local", currentUser?.id || DEFAULT_ACCOUNT_ID, chats).catch(() => {});
  }, [chats]);

  useEffect(() => {
    if (!selectedChatId || !Array.isArray(messages) || messages.length === 0) return;
    setCachedMessages("local", currentUser?.id || DEFAULT_ACCOUNT_ID, selectedChatId, messages).catch(() => {});
  }, [messages, selectedChatId]);

  useEffect(() => {
    autoResizeDraftInput();
    if (shouldStickToBottomRef.current) {
      scrollMessagesToBottom("auto");
    }
  }, [draft, selectedChatId]);

  useEffect(() => {
    if (!apiAuthenticated) return;
    fetchChats(true);
  }, [apiAuthenticated]);

  useEffect(() => {
    if (!selectedChatId || !apiAuthenticated) return;
    const intervalMs = syncingChat ? 3000 : 15000;
    const timer = setInterval(() => {
      fetchMessages(selectedChatId, { withLoader: false, background: true });
    }, intervalMs);
    return () => clearInterval(timer);
  }, [selectedChatId, apiAuthenticated, syncingChat]);

  useEffect(() => {
    const container = messagesAreaRef.current;
    if (!container) return;

    const chatChanged = previousSelectedChatIdRef.current !== selectedChatId;
    const previousCount = previousMessageCountRef.current;
    const currentCount = messages.length;
    const hasNewMessages = currentCount > previousCount;
    const latestMessage = currentCount > 0 ? messages[currentCount - 1] : null;

    if (chatChanged) {
      requestAnimationFrame(() => {
        scrollMessagesToBottom("auto");
      });
    } else if (hasNewMessages) {
      const canAutoScroll = shouldStickToBottomRef.current || Boolean(latestMessage?.fromMe);
      if (canAutoScroll) {
        requestAnimationFrame(() => {
          scrollMessagesToBottom("smooth");
        });
      } else {
        setShowJumpToLatest(true);
        if (!latestMessage?.fromMe) {
          setPendingIncomingCount((prev) => prev + (currentCount - previousCount));
        }
      }
    }

    previousSelectedChatIdRef.current = selectedChatId;
    previousMessageCountRef.current = currentCount;
  }, [messages, selectedChatId]);

  useEffect(() => {
    grammarInsightsRef.current = grammarInsights;
  }, [grammarInsights]);

  useEffect(() => {
    const incoming = messages.filter((msg) => !msg.fromMe).slice(-40);
    incoming.forEach((msg) => {
      enqueueGrammarCheck(msg);
    });
  }, [messages]);

  const offlineQueueRef = useRef([]);
  useEffect(() => {
    offlineQueueRef.current = offlineQueue;
  }, [offlineQueue]);

  useEffect(() => {
    async function loadQueue() {
      const provider = "local";
      const accountId = currentUser?.id || DEFAULT_ACCOUNT_ID;
      const queue = await getOfflineQueue(provider, accountId);
      setOfflineQueueState(queue);
      if (queue.length > 0) {
        setMessagesByChat(prev => {
          const next = { ...prev };
          queue.forEach(msg => {
            if (msg.type === 'message' || !msg.type) {
              const current = next[msg.chatId] || [];
              if (!current.some(m => m._uiId === msg._uiId)) {
                next[msg.chatId] = [...current, msg].sort(
                  (a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0)
                );
              }
            }
          });
          return next;
        });

        // Update active messages if viewing a chat that has queued items
        if (selectedChatIdRef.current) {
          const chatQueue = queue.filter(q => (q.type === 'message' || !q.type) && q.chatId === selectedChatIdRef.current);
          if (chatQueue.length > 0) {
            setMessages(prev => {
              const next = [...prev];
              chatQueue.forEach(msg => {
                if (!next.some(m => m._uiId === msg._uiId)) {
                  next.push(msg);
                }
              });
              return next.sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
            });
          }
        }
      }
    }
    loadQueue();
  }, [currentUser]);

  async function processOfflineQueue() {
    if (offlineQueueRef.current.length === 0) return;
    if (!navigator.onLine || isOffline) return;

    if (syncRetryTimeoutRef.current) clearTimeout(syncRetryTimeoutRef.current);

    const provider = "local";
    const accountId = currentUser?.id || DEFAULT_ACCOUNT_ID;
    const queue = [...offlineQueueRef.current];

    if (syncAttemptsRef.current === 0) {
      showNotice("🔄 Sincronizando acciones pendientes...", "info");
    }

    for (const action of queue) {
      try {
        let res;
        const targetChatId = action.chatId || action.payload?.chatId;
        if (action.type === 'message' || !action.type) {
          const chat = chatsRef.current.find(c => c.id === targetChatId);
          const chatProvider = targetChatId === 'ai_assistant' ? 'local' : (chat?.provider || 'local');

          res = await fetch(`${API_URL}/api/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              provider: chatProvider,
              accountId,
              chatId: targetChatId,
              text: action.body || action.payload?.text,
              originalText: action.originalText || action.payload?.originalText || action.body || action.payload?.text,
              replyToMessageId: action.replyToMessageId || action.payload?.replyToMessageId || ""
            })
          });
        } else if (action.type === 'publish_status_public' || action.type === 'publish_status_personal') {
          res = await fetch(`${API_URL}/api/public-statuses`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(action.payload)
          });
        } else if (action.type === 'like_status') {
          res = await fetch(`${API_URL}/api/public-statuses/${action.payload.statusId}/like`, {
            method: "POST"
          });
        } else if (action.type === 'view_status') {
          res = await fetch(`${API_URL}/api/public-statuses/${action.payload.statusId}/view`, {
            method: "POST"
          });
        } else if (action.type === 'toggle_follow') {
          const endpoint = action.payload.isFollowed ? 'unfollow' : 'follow';
          res = await fetch(`${API_URL}/api/users/${action.payload.userId}/${endpoint}`, {
            method: "POST"
          });
        } else if (action.type === 'update_profile') {
          res = await fetch(`${API_URL}/api/auth/profile`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(action.payload)
          });
        }

        if (res && (res.ok || res.status < 500)) {
          syncAttemptsRef.current = 0;
          setOfflineQueueState(prev => {
            const next = prev.filter(item => item._uiId !== action._uiId);
            setOfflineQueue(provider, accountId, next);
            return next;
          });
          if (action.type === 'message' || !action.type) {
            await fetchMessages(targetChatId, { withLoader: false, background: true });
          } else if (action.type === 'publish_status_public' || action.type === 'like_status' || action.type === 'view_status') {
            loadPublicStatuses();
          } else if (action.type === 'publish_status_personal') {
            fetchStatusArchive(true);
          } else if (action.type === 'toggle_follow') {
            loadProximityUsers();
            loadFollowedStories();
          }
        } else {
          throw new Error(`Server returned error status ${res?.status}`);
        }
      } catch (err) {
        console.error("Error processing queued offline action:", err);
        syncAttemptsRef.current += 1;
        const delay = Math.min(30000, Math.pow(2, syncAttemptsRef.current) * 1000 + Math.random() * 1000);
        showNotice(`⚠️ Error de red. Reintentando sincronización en ${Math.round(delay/1000)}s...`, "warning");
        syncRetryTimeoutRef.current = setTimeout(processOfflineQueue, delay);
        break;
      }
    }
  }

  useEffect(() => {
    if (!isOffline && socketConnected && apiAuthenticated) {
      processOfflineQueue();
    }
  }, [isOffline, socketConnected, apiAuthenticated, offlineQueue.length]);



  useEffect(() => {
    if (!apiAuthenticated) return;
    const fetchStatus = async () => {
      try {
        const url = new URL(`${API_URL}/api/status`);
        url.searchParams.set("provider", DEFAULT_PROVIDER);
        url.searchParams.set("accountId", currentUserRef.current?.id || DEFAULT_ACCOUNT_ID);
        const res = await fetch(url.toString());
        if (!res.ok) return;
        const data = await res.json();
        setBackendStatus({
          providerStatus: data.providerStatus || "unknown",
          uptimeSec: Number(data.uptimeSec || 0),
          statusArchive: data.statusArchive || null
        });
      } catch (_error) {
        // silent on status poll
      }
    };
    fetchStatus();
    const timer = setInterval(fetchStatus, 10000);
    return () => clearInterval(timer);
  }, [apiAuthenticated]);

  async function fetchStatusArchive(background = false) {
    if (!apiAuthenticated) return;
    if (!navigator.onLine) return;
    if (!background) setLoadingStatusArchive(true);
    try {
      const url = new URL(`${API_URL}/api/status-archive`);
      url.searchParams.set("provider", DEFAULT_PROVIDER);
      url.searchParams.set("accountId", currentUser?.id || DEFAULT_ACCOUNT_ID);
      url.searchParams.set("limit", "120");
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("No se pudieron cargar los estados archivados.");
      const data = await res.json();
      setStatusArchiveItems(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      if (!background) showNotice(error.message, "error");
    } finally {
      if (!background) setLoadingStatusArchive(false);
    }
  }

  async function fetchResources() {
    if (!selectedChatId) return;
    if (!navigator.onLine) {
      showNotice("No se pueden cargar los recursos sin conexión.", "error");
      return;
    }
    setLoadingResources(true);
    setShowResources(true);
    try {
      const url = new URL(`${API_URL}/api/chats/${encodeURIComponent(selectedChatId)}/resources`);
      url.searchParams.set("provider", DEFAULT_PROVIDER);
      url.searchParams.set("accountId", currentUser?.id || DEFAULT_ACCOUNT_ID);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("No se pudieron cargar los recursos.");
      const data = await res.json();
      setResources(data);
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      setLoadingResources(false);
    }
  }

  useEffect(() => {
    if (!apiAuthenticated) return;
    fetchStatusArchive(true);
    const timer = setInterval(() => fetchStatusArchive(true), 60000);
    return () => clearInterval(timer);
  }, [apiAuthenticated]);

  async function fetchChats(selectFirst = false) {
    if (!apiAuthenticated) return;

    setLoadingChats(true);
    try {
      const cachedChats = await getCachedChats("local", currentUser?.id || DEFAULT_ACCOUNT_ID);
      if (cachedChats.length > 0) {
        const sortedCached = [...cachedChats].sort(
          (a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)
        );
        chatsRef.current = sortedCached;
        setChats(sortedCached);

        // PWA Hydration: Auto-select chat from cache immediately to prevent UI jumps
        const existsInCache = sortedCached.some((chat) => chat.id === selectedChatIdRef.current);
        const nextCachedId = existsInCache ? selectedChatIdRef.current : sortedCached[0].id;
        const shouldAutoSelectCache = !isMobileLayout && (selectFirst || !selectedChatIdRef.current || !existsInCache);

        if (shouldAutoSelectCache && sortedCached.length > 0) {
          selectedChatIdRef.current = nextCachedId;
          setSelectedChatId(nextCachedId);
        }
      }

      if (!navigator.onLine) {
         setLoadingChats(false);
         return;
      }

      const url = new URL(`${API_URL}/api/chats`);
      url.searchParams.set("provider", "local");
      if (currentUser?.id) {
        url.searchParams.set("accountId", currentUser.id);
      }
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("No se pudieron cargar los chats.");

      const payload = await res.json();
      const { items, syncState } = parseApiItemsPayload(payload);

      if (syncState && (syncState.status === 'syncing' || syncState.status === 'queued')) {
         setSyncingChats(true);
      } else {
         setSyncingChats(false);
      }

      const safeChats = items.sort(
        (a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)
      );
      chatsRef.current = safeChats;
      setChats(safeChats);

      if (safeChats.length === 0) {
        if (selectedChatIdRef.current) {
          selectedChatIdRef.current = "";
          setSelectedChatId("");
        }
        await clearCache();
        await setCachedChats("local", currentUser?.id || DEFAULT_ACCOUNT_ID, []);
        return;
      }

      const exists = safeChats.some((chat) => chat.id === selectedChatIdRef.current);
      const nextChatId = exists ? selectedChatIdRef.current : safeChats[0].id;
      const shouldAutoSelect = !isMobileLayout && (selectFirst || !selectedChatIdRef.current || !exists);

      if (shouldAutoSelect && safeChats.length > 0) {
        selectedChatIdRef.current = nextChatId; // Update ref immediately to avoid jumpy behavior
        setSelectedChatId(nextChatId);
      } else if (!exists && selectedChatIdRef.current) {
        selectedChatIdRef.current = "";
        setSelectedChatId("");
        setMessages([]);
      }

      await setCachedChats("local", currentUser?.id || DEFAULT_ACCOUNT_ID, safeChats);
    } catch (error) {
      console.error(error);
      showNotice(error.message, "error");
    } finally {
      setLoadingChats(false);
    }
  }

  async function fetchMessages(chatId, options = {}) {
    const { withLoader = true, background = false } = options;
    if (!chatId) return;
    const reqId = ++messageFetchReqIdRef.current;

    if (withLoader) setLoadingMessages(prev => ({ ...prev, [chatId]: true }));

    try {
      if (!background) {
        const cachedMessages = await getCachedMessages("local", currentUser?.id || DEFAULT_ACCOUNT_ID, chatId);
        if (cachedMessages.length > 0 && selectedChatIdRef.current === chatId) {
          setMessages(cachedMessages);
          setMessagesByChat((prev) => ({ ...prev, [chatId]: cachedMessages }));
          if (withLoader) setLoadingMessages(prev => ({ ...prev, [chatId]: false }));
        }
      }

      if (!navigator.onLine) {
        if (withLoader) setLoadingMessages(prev => ({ ...prev, [chatId]: false }));
        return;
      }

      const chat = chatsRef.current.find((c) => c.id === chatId);
      const provider = chatId === 'ai_assistant' ? 'local' : (chat?.provider || 'local');
      const url = new URL(`${API_URL}/api/chats/${encodeURIComponent(chatId)}/messages`);
      url.searchParams.set("provider", provider);
      if (currentUser?.id) {
        url.searchParams.set("accountId", currentUser.id);
      }
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("No se pudieron cargar los mensajes.");
      const payload = await res.json();
      if (reqId !== messageFetchReqIdRef.current) return;
      const { items, syncState } = parseApiItemsPayload(payload);

      if (syncState && (syncState.status === 'syncing' || syncState.status === 'queued')) {
         setSyncingChat(true);
      } else {
         setSyncingChat(false);
      }
      const safeMessages = items
        .map((msg) => ({ ...msg, _uiId: messageId(msg) }))
        .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));

      setMessagesByChat((prev) => ({ ...prev, [chatId]: safeMessages }));
      await setCachedMessages("local", currentUser?.id || DEFAULT_ACCOUNT_ID, chatId, safeMessages);
      if (selectedChatIdRef.current === chatId) {
        setMessages(prev => {
          // Keep optimistic messages that haven't been confirmed yet by the backend
          const pendingOptimistic = prev.filter(m =>
            (m.status === 'sending' || m.status === 'offline_pending') &&
            !safeMessages.some(sm => sm.body === m.body && sm.fromMe && sm.status !== 'sending')
          );
          return [...safeMessages, ...pendingOptimistic].sort(
            (a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0)
          );
        });
      }
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      if (withLoader) setLoadingMessages(prev => ({ ...prev, [chatId]: false }));
    }
  }

  async function markChatAsRead(chatId) {
    if (!chatId || !navigator.onLine) return;
    try {
      const chat = chatsRef.current.find((c) => c.id === chatId);
      const provider = chatId === 'ai_assistant' ? 'local' : (chat?.provider || 'local');
      const url = new URL(`${API_URL}/api/chats/${encodeURIComponent(chatId)}/read`);
      url.searchParams.set("provider", provider);
      await fetch(url.toString(), {
        method: "POST"
      });
      setChats((prev) =>
        prev.map((chat) => (chat.id === chatId ? { ...chat, unreadCount: 0 } : chat))
      );
    } catch (_error) {
      // no-op for optimistic UX
    }
  }

  async function correctDraft() {
    if (!draft.trim()) return;
    setCorrecting(true);
    try {
      const res = await fetch(`${API_URL}/api/correct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: draft })
      });
      if (!res.ok) throw new Error("No se pudo corregir el mensaje.");
      const data = await res.json();
      setCorrectedDraft(data.corrected || "");
      showNotice("Sugerencia de IA lista para revisar.", "success");
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      setCorrecting(false);
    }
  }

  async function correctAndSend() {
    if (!selectedChatId) {
      showNotice("Seleccioná un chat para enviar.", "error");
      return;
    }
    if (!draft.trim()) return;

    setCorrectingAndSending(true);
    try {
      const res = await fetch(`${API_URL}/api/correct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: draft })
      });
      if (!res.ok) throw new Error("No se pudo corregir el mensaje.");
      const data = await res.json();
      const corrected = (data.corrected || "").trim();
      if (!corrected) throw new Error("La IA devolvió texto vacío.");

      setCorrectedDraft(corrected);

      // Stop correcting spinner before triggering sending to allow the UI
      // to transition cleanly to the "Enviando versión IA..." state.
      setCorrectingAndSending(false);

      await sendMessage(corrected, "correctedAndSending");
    } catch (error) {
      showNotice(error.message, "error");
      setCorrectingAndSending(false);
    }
  }

  async function postSendMessage(payload) {
    if (!selectedChatId) {
      showNotice("Seleccioná un chat para enviar.", "error");
      return false;
    }
    const text = String(payload?.text || "").trim();
    if (!text) return false;

    const chat = chats.find(c => c.id === selectedChatId);
    const provider = selectedChatId === 'ai_assistant' ? 'local' : (chat?.provider || 'local');
    const accountId = currentUser?.id || DEFAULT_ACCOUNT_ID;

    try {
      const res = await fetch(`${API_URL}/api/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          accountId,
          chatId: selectedChatId,
          text,
          originalText: payload?.originalText || text,
          replyToMessageId: payload?.replyToMessageId || ""
        })
      });
      if (!res.ok) throw new Error("No se pudo enviar el mensaje.");
      return true;
    } catch (error) {
      showNotice(error.message, "error");
      return false;
    }
  }

  async function sendMessage(textToSend, type = "original") {
    if (!String(textToSend || "").trim()) return;
    if (!navigator.onLine || isOffline) {
      const offlineId = `offline-${Date.now()}`;
      const optimisticMsg = {
        _uiId: offlineId,
        chatId: selectedChatId,
        body: textToSend,
        fromMe: true,
        timestamp: Math.floor(Date.now() / 1000),
        status: 'offline_pending',
        originalText: draftsByChat[selectedChatId] || textToSend,
        replyToMessageId: replyTarget?.id || ""
      };
      setMessages(prev => [...prev, optimisticMsg]);
      setMessagesByChat(prev => {
        const current = prev[selectedChatId] || [];
        return { ...prev, [selectedChatId]: [...current, optimisticMsg] };
      });
      const provider = "local";
      const accountId = currentUser?.id || DEFAULT_ACCOUNT_ID;
      const nextQueue = [...offlineQueue, optimisticMsg];
      setOfflineQueueState(nextQueue);
      await setOfflineQueue(provider, accountId, nextQueue);
      setDraft("");
      setCorrectedDraft("");
      setReplyTarget(null);
      showNotice("📱 Sin conexión a Internet. Mensaje en cola para enviar al reconectar.", "info");
      return;
    }
    const optimisticMsg = {
      _uiId: `optimistic-${Date.now()}`,
      chatId: selectedChatId,
      body: textToSend,
      fromMe: true,
      timestamp: Math.floor(Date.now() / 1000),
      status: 'sending'
    };
    setMessages(prev => [...prev, optimisticMsg]);
    setSending(true);
    setSendingType(type);
    try {
      const ok = await postSendMessage({
        text: textToSend,
        originalText: draftsByChat[selectedChatId] || textToSend,
        replyToMessageId: replyTarget?.id || ""
      });
      if (!ok) {
        setMessages(prev => prev.filter(m => m._uiId !== optimisticMsg._uiId));
        return;
      }
      setDraft("");
      setCorrectedDraft("");
      setReplyTarget(null);
      showNotice(type === "corrected" || type === "correctedAndSending" ? "✨ Mensaje mejorado por IA y enviado." : "📤 Mensaje original enviado.", "success");
      await fetchMessages(selectedChatId, { withLoader: false, background: true });
    } catch (error) {
      setMessages(prev => prev.filter(m => m._uiId !== optimisticMsg._uiId));
      showNotice(error.message, "error");
    } finally {
      setSending(false);
      setSendingType(null);
    }
  }

  function handleDraftKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!sending && !correcting && !correctingAndSending && (draft.trim() || correctedDraft)) {
        if (event.ctrlKey || event.metaKey) {
          // Force send original
          sendMessage(draft, "original");
        } else {
          if (correctedDraft) {
            sendMessage(correctedDraft, "corrected");
          } else if (draft.trim()) {
            correctAndSend();
          }
        }
      }
    }
  }

  function startReply(msg) {
    const replyBody = (msg.body || "").trim();
    setReplyTarget({
      id: msg.id || msg._uiId,
      text: replyBody || (msg.mediaType === "image" ? "[Imagen]" : "[Mensaje vacío]"),
      fromMe: Boolean(msg.fromMe)
    });
  }

  function buildGrammarReplyTemplate(original, corrected) {
    const safeOriginal = String(original || "").trim();
    const safeCorrected = String(corrected || "").trim();
    if (!safeOriginal || !safeCorrected) return "";
    return `Se escribe "${safeCorrected}" y no "${safeOriginal}".`;
  }

  function updateQueuedReplyText(localId, text) {
    setReplyQueue((prev) =>
      prev.map((item) => (item.localId === localId ? { ...item, text } : item))
    );
  }

  function removeQueuedReply(localId) {
    setReplyQueue((prev) => prev.filter((item) => item.localId !== localId));
    setSendingReplyQueueIds((prev) => {
      if (!prev[localId]) return prev;
      const next = { ...prev };
      delete next[localId];
      return next;
    });
  }

  function loadQueuedReplyToComposer(item) {
    setReplyTarget({
      id: item.replyToMessageId,
      text: item.original,
      fromMe: false
    });
    setDraft(item.text);
    setCorrectedDraft("");
    setTimeout(() => draftInputRef.current?.focus(), 0);
  }

  async function sendQueuedReply(item, options = {}) {
    const { silent = false, skipRefresh = false } = options;
    if (!item?.text?.trim()) return false;
    setSendingReplyQueueIds((prev) => ({ ...prev, [item.localId]: true }));
    try {
      const ok = await postSendMessage({
        text: item.text,
        originalText: item.text,
        replyToMessageId: item.replyToMessageId
      });
      if (!ok) return false;
      setReplyQueue((prev) => prev.filter((entry) => entry.localId !== item.localId));
      if (!silent) {
        showNotice("Respuesta enviada.", "success");
      }
      if (!skipRefresh) {
        await fetchMessages(selectedChatId, { withLoader: false, background: true });
      }
      return true;
    } finally {
      setSendingReplyQueueIds((prev) => {
        const next = { ...prev };
        delete next[item.localId];
        return next;
      });
    }
  }

  async function sendAllQueuedReplies() {
    const pending = replyQueue.filter((item) => item.text.trim());
    if (pending.length === 0) return;
    await Promise.all(pending.map((item) => sendQueuedReply(item, { silent: true, skipRefresh: true })));
    showNotice("Respuestas en paralelo enviadas.", "success");
    await fetchMessages(selectedChatId, { withLoader: false, background: true });
  }

  function prepareGrammarReply(msg) {
    const key = msg?._uiId || messageId(msg);
    const insight = key ? grammarInsights[key] : null;
    if (!insight?.hasErrors) return;
    const template = buildGrammarReplyTemplate(insight.original, insight.corrected);
    if (!template) return;
    const localId = `grammar-${msg.id || msg._uiId}`;
    setReplyQueue((prev) => {
      const exists = prev.some((item) => item.localId === localId);
      if (exists) return prev;
      return [
        {
          localId,
          replyToMessageId: msg.id || msg._uiId,
          original: insight.original,
          text: template
        },
        ...prev
      ];
    });
    showNotice("Respuesta sugerida agregada a la cola paralela.", "info");
  }

  async function fetchAiConfig() {
    setLoadingAiConfig(true);
    try {
      const res = await fetch(`${API_URL}/api/ai/config`);
      if (!res.ok) throw new Error("No se pudo obtener configuración de IA.");
      const data = await res.json();
      setAiConfig({
        provider: data.provider || "lmstudio",
        aiBaseUrl: data.aiBaseUrl || "",
        lmStudioBaseUrl: data.lmStudioBaseUrl || "",
        cloudflareAccountId: data.cloudflareAccountId || "",
        cloudflareApiToken: data.cloudflareApiToken || "",
        cloudflareBaseUrl: data.cloudflareBaseUrl || "",
        modelName: data.modelName || "",
        temperature: Number(data.temperature ?? 0.7),
        maxTokens: Number(data.maxTokens ?? 180),
        timeoutMs: Number(data.timeoutMs ?? 90000),
        systemPrompt: data.systemPrompt || "",
        userPromptTemplate: data.userPromptTemplate || ""
      });
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      setLoadingAiConfig(false);
    }
  }

  async function fetchAiModels() {
    try {
      const res = await fetch(`${API_URL}/api/ai/models`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "No se pudieron cargar modelos.");
      }
      setAiModels(Array.isArray(data.models) ? data.models : []);
    } catch (error) {
      showNotice(error.message, "error");
      setAiModels([]);
    }
  }

  async function saveAiConfig() {
    setSavingAiConfig(true);
    try {
      const res = await fetch(`${API_URL}/api/ai/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: aiConfig.provider,
          lmStudioBaseUrl: aiConfig.lmStudioBaseUrl,
          cloudflareAccountId: aiConfig.cloudflareAccountId,
          cloudflareApiToken: aiConfig.cloudflareApiToken,
          cloudflareBaseUrl: aiConfig.cloudflareBaseUrl,
          modelName: aiConfig.modelName,
          temperature: aiConfig.temperature,
          maxTokens: aiConfig.maxTokens,
          timeoutMs: aiConfig.timeoutMs,
          systemPrompt: aiConfig.systemPrompt,
          userPromptTemplate: aiConfig.userPromptTemplate
        })
      });
      if (!res.ok) throw new Error("No se pudo guardar la configuración.");
      showNotice("Prompts y configuración IA guardados.", "success");
      await fetchAiConfig();
      await fetchAiModels();
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      setSavingAiConfig(false);
    }
  }

  async function checkAiHealth() {
    setCheckingAiHealth(true);
    setAiHealth(null);
    try {
      const res = await fetch(`${API_URL}/api/ai/health?probe=1`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setAiHealth({ ok: false, message: data.error || "El proveedor IA no responde." });
        return;
      }
      if (data.probeOk === false) {
        setAiHealth({
          ok: false,
          message: `Conexión OK, pero el modelo falló: ${data.probeError}`
        });
        return;
      }
      setAiHealth({
        ok: true,
        message: `Conectado (${data.provider}). Modelos detectados: ${data.modelCount}. Prueba de inferencia OK.`
      });
    } catch (error) {
      setAiHealth({ ok: false, message: error.message });
    } finally {
      setCheckingAiHealth(false);
    }
  }

  if (!apiAuthenticated) {
    return (
      <>
        <div className="bg-blob-container" aria-hidden="true">
          <div className="bg-blob blob-1"></div>
          <div className="bg-blob blob-2"></div>
        </div>
        <main className="authScreen">
          <section className="authCard" aria-labelledby="authHeading" style={{ maxWidth: '420px', padding: '40px', width: '90%' }}>
            <div style={{ textAlign: 'center', marginBottom: '25px' }}>
              <div style={{
                background: 'linear-gradient(135deg, #a855f7 0%, #6366f1 100%)',
                width: '64px',
                height: '64px',
                borderRadius: '20px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 10px 25px -5px rgba(99, 102, 241, 0.4)',
                marginBottom: '15px'
              }}>
                <span style={{ fontSize: '32px', color: '#fff' }}>💬</span>
              </div>
              <h1 id="authHeading" style={{ fontSize: '2.2rem', fontWeight: '800', margin: '0', background: 'linear-gradient(to right, #a855f7, #6366f1)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Tapchat</h1>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', marginTop: '5px' }}>
                {authMode === "login" ? "Conéctate de forma segura" : "Crea tu cuenta de chat"}
              </p>
            </div>

            {authError && (
              <div id="authError" role="alert" aria-live="assertive" className="notice error" style={{ marginBottom: '20px', borderRadius: '12px', padding: '12px' }}>
                {authError}
              </div>
            )}

            <div style={{
              display: 'flex',
              background: 'rgba(255, 255, 255, 0.05)',
              padding: '4px',
              borderRadius: '12px',
              marginBottom: '25px',
              border: '1px solid rgba(255, 255, 255, 0.08)'
            }}>
              <button
                type="button"
                style={{
                  flex: 1,
                  padding: '10px',
                  borderRadius: '10px',
                  border: 'none',
                  background: authMode === "login" ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                  color: authMode === "login" ? '#fff' : 'var(--text-muted)',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
                onClick={() => { setAuthMode("login"); setAuthError(""); }}
              >
                Ingresar
              </button>
              <button
                type="button"
                style={{
                  flex: 1,
                  padding: '10px',
                  borderRadius: '10px',
                  border: 'none',
                  background: authMode === "register" ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                  color: authMode === "register" ? '#fff' : 'var(--text-muted)',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
                onClick={() => { setAuthMode("register"); setAuthError(""); }}
              >
                Registrarse
              </button>
            </div>

            <form onSubmit={async (e) => {
              e.preventDefault();
              setAuthChecking(true);
              setAuthError("");
              try {
                if (authMode === "login") {
                  const res = await originalFetch(`${API_URL}/api/auth/login`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ identifier: email, password })
                  });
                  const data = await res.json();
                  if (res.ok) {
                    localStorage.setItem("tapchat_token", data.token);
                    localStorage.setItem("tapchat_cached_user", JSON.stringify(data.user));
                    setCurrentUser(data.user);
                    setApiAuthenticated(true);
                    showNotice("¡Bienvenido a Tapchat!", "success");
                  } else {
                    setAuthError(data.error || "Error al iniciar sesión.");
                  }
                } else {
                  if (password !== confirmPassword) {
                    setAuthError("Las contraseñas no coinciden.");
                    setAuthChecking(false);
                    return;
                  }
                  const res = await originalFetch(`${API_URL}/api/auth/register`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ username, email, password })
                  });
                  const data = await res.json();
                  if (res.ok) {
                    localStorage.setItem("tapchat_token", data.token);
                    localStorage.setItem("tapchat_cached_user", JSON.stringify(data.user));
                    setCurrentUser(data.user);
                    setApiAuthenticated(true);
                    showNotice("Cuenta creada con éxito.", "success");
                  } else {
                    setAuthError(data.error || "Error al registrar la cuenta.");
                  }
                }
              } catch (err) {
                setAuthError("Error de conexión con el servidor.");
              } finally {
                setAuthChecking(false);
              }
            }}>
              {authMode === "register" && (
                <div style={{ marginBottom: '18px' }}>
                  <label htmlFor="usernameInput" style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: '500' }}>Nombre de usuario</label>
                  <input
                    id="usernameInput"
                    className="authInput"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="ej. carlos_dev"
                    required
                    style={{ width: '100%' }}
                  />
                </div>
              )}

              <div style={{ marginBottom: '18px' }}>
                <label htmlFor="emailInput" style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: '500' }}>
                  {authMode === "login" ? "Usuario o Correo" : "Correo electrónico"}
                </label>
                <input
                  id="emailInput"
                  className="authInput"
                  type={authMode === "login" ? "text" : "email"}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={authMode === "login" ? "ej. admin o correo@ejemplo.com" : "ej. correo@ejemplo.com"}
                  required
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ marginBottom: authMode === "register" ? '18px' : '25px' }}>
                <label htmlFor="passwordInput" style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: '500' }}>Contraseña</label>
                <div className="passwordInputWrapper" style={{ width: '100%' }}>
                  <input
                    id="passwordInput"
                    className="authInput"
                    type={showApiKey ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    style={{ width: '100%' }}
                  />
                  <button
                    type="button"
                    className="passwordToggleBtn"
                    onClick={() => setShowApiKey(!showApiKey)}
                    aria-label={showApiKey ? "Ocultar" : "Mostrar"}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.6)' }}
                  >
                    {showApiKey ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                  </button>
                </div>
              </div>

              {authMode === "register" && (
                <div style={{ marginBottom: '25px' }}>
                  <label htmlFor="confirmPasswordInput" style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: '500' }}>Confirmar Contraseña</label>
                  <input
                    id="confirmPasswordInput"
                    className="authInput"
                    type={showApiKey ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    style={{ width: '100%' }}
                  />
                </div>
              )}

              <button
                type="submit"
                className="primary fullWidth"
                disabled={authChecking}
                style={{
                  background: 'linear-gradient(135deg, #a855f7 0%, #6366f1 100%)',
                  border: 'none',
                  padding: '12px',
                  borderRadius: '12px',
                  fontWeight: '600',
                  boxShadow: '0 4px 15px rgba(99, 102, 241, 0.3)',
                  transition: 'transform 0.2s ease',
                  cursor: 'pointer'
                }}
              >
                {authChecking ? (
                  <>
                    <span className="buttonSpinner" aria-hidden="true" />
                    <span>Procesando...</span>
                  </>
                ) : (
                  authMode === "login" ? "Ingresar de forma segura" : "Crear cuenta"
                )}
              </button>
            </form>
          </section>

          {toasts.length > 0 && (
            <div className="toast-container" aria-live="polite">
              {toasts.map(t => (
                <div key={t.id} className={`toast ${t.type}`}>
                  {t.text}
                </div>
              ))}
            </div>
          )}
        </main>
      </>
    );
  }

  // Revert: As per UX Audit and the repo state, 'connecting' should NOT be a blocking UI state. The user needs to see the warning banner instead.
  const isBlockingSessionState = false;
  if (isBlockingSessionState) {
    return (
      <>
        <div className="bg-blob-container" aria-hidden="true">
          <div className="bg-blob blob-1"></div>
          <div className="bg-blob blob-2"></div>
        </div>
        <main className="authScreen">
        <section className="authCard" aria-live="polite" aria-labelledby="waAuthHeading">
          <h1 id="waAuthHeading">Tapchat</h1>
          <h2>{authScreenLabel}</h2>

          {sessionStatus === "qr" && socketConnected && (
            <>
              {qr ? (
                <>
                  <div className="instructionList">
                    <p>Para usar el proveedor en Tapchat:</p>
                    <ol>
                      <li>Abre la aplicación del proveedor en tu teléfono</li>
                      <li>Toca el menú (tres puntos) o "Configuración"</li>
                      <li>Selecciona <strong>"Dispositivos vinculados"</strong></li>
                      <li>Toca <strong>"Vincular un dispositivo"</strong> y apunta tu cámara a esta pantalla</li>
                    </ol>
                  </div>
                  <div className="qrBox" role="img" aria-label="Código QR para vincular dispositivo">
                    <QRCode value={qr} size={230} />
                  </div>
                </>
              ) : (
                <div className="loadingSpinnerContainer" aria-busy="true" aria-live="polite">
                  <div className="largeSpinner" aria-hidden="true"></div>
                  <p className="helperText">Generando código QR...</p>
                </div>
              )}
              <div className="authRecoveryOptions mt-4">
                <button
                  className="secondary fullWidth"
                  aria-label="Cancelar y salir"
                  onClick={handleLogout}
                >
                  Cancelar y salir
                </button>
              </div>
            </>
          )}

          {sessionStatus === "connecting" && socketConnected && (
            <div className="loadingSpinnerContainer" aria-busy="true" aria-live="polite">
              <div className="largeSpinner" aria-hidden="true"></div>
              <p className="helperText">Sincronizando mensajes y contactos...</p>
            </div>
          )}

          {!socketConnected && (
             <div className="loadingSpinnerContainer" aria-busy="true" aria-live="assertive">
                <div className="largeSpinner warningSpinner" aria-hidden="true"></div>
                <p className="helperText errorText">Reconectando con el servidor...</p>
             </div>
          )}

          {(sessionStatus === "auth_failure" && socketConnected) && (
            <div className="authRecoveryOptions">
              <button
                className="primary fullWidth"
                aria-label="Reintentar conexión con el proveedor"
                onClick={() => fetchChats(true)}
              >
                Reintentar conexión
              </button>
              <button
                className="secondary fullWidth mt-2"
                aria-label="Cerrar sesión y volver al inicio"
                onClick={handleLogout}
              >
                Cerrar sesión
              </button>
              <div className="notice error mt-2" role="alert" aria-live="assertive">
                <p className="helperText errorText">
                  <strong>⚠️ Error de Autenticación de Proveedor</strong><br />
                  Si el problema persiste, es posible que el dispositivo haya sido desvinculado desde tu teléfono u origen.
                </p>
              </div>
            </div>
          )}
        </section>
      </main>
    </>
    );
  }

  return (
    <>
      <div className="bg-blob-container">
        <div className="bg-blob blob-1"></div>
        <div className="bg-blob blob-2"></div>
      </div>
      {pwaUpdateAvailable && (
        <div className="updateBanner" role="alert" aria-live="assertive">
          <InfoIcon size={16} style={{ marginRight: '6px', display: 'inline-block', verticalAlign: 'middle' }} /> Hay una nueva versión de Tapchat disponible.
          <button className="primary" onClick={() => pwaUpdateAvailable(true)}>Actualizar ahora</button>
          <button className="secondary" onClick={() => setPwaUpdateAvailable(null)}>Ignorar</button>
        </div>
      )}
      {isOffline && (
        <div className="offlineBanner" role="alert" aria-live="assertive">
          <WarningIcon size={16} style={{ marginRight: '6px', display: 'inline-block', verticalAlign: 'middle' }} /> Estás navegando sin conexión. Mostrando versión guardada.
        </div>
      )}
      {!isOffline && !socketConnected && (
        <div className="warningBanner" role="alert" aria-live="assertive">
          <InfoIcon size={16} style={{ marginRight: '6px', display: 'inline-block', verticalAlign: 'middle' }} /> Reconectando con el servidor...
        </div>
      )}
      {!isOffline && socketConnected && sessionStatus === "disconnected" && (
        <div className="warningBanner" role="alert" aria-live="assertive">
          <WarningIcon size={16} style={{ marginRight: '6px', display: 'inline-block', verticalAlign: 'middle' }} /> Proveedor desconectado. Revisa la conexión en tu teléfono.
        </div>
      )}
      {!isOffline && socketConnected && sessionStatus === "connecting" && (
        <div className="infoBanner" role="status" aria-live="polite">
          <ReloadIcon size={16} className="spinning" style={{ marginRight: '6px', display: 'inline-block', verticalAlign: 'middle' }} /> Estableciendo conexión con el proveedor...
        </div>
      )}
      <main className={`waApp ${selectedChatId || viewMode === "statuses" ? "chatOpen" : ""}`}>
        <aside className="sidebar">
        <header className="sidebarHeader">
          <h2>
            {viewMode === "chats" ? "Chats" : viewMode === "statuses" ? "Estados" : "Notificaciones"}
            {viewMode === "chats" && totalUnread > 0 && (
              <span className="pendingCounter" style={{ marginLeft: '8px', display: 'inline-flex', alignSelf: 'center' }}>{totalUnread}</span>
            )}
            {viewMode === "chats" && syncingChats && (
              <span className="syncIndicator" title="Sincronizando chats..." aria-live="polite"><ReloadIcon size={14} className="spinning" style={{ marginLeft: '6px', display: 'inline-block', verticalAlign: 'middle' }} /></span>
            )}
          </h2>
          <div className="headerActions" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              className="secondary"
              aria-label="Actualizar chats"
              onClick={() => fetchChats(false)}
              disabled={loadingChats}
              aria-busy={loadingChats}
              style={{
                width: '36px',
                height: '36px',
                padding: 0,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(255,255,255,0.15)',
                border: '1px solid rgba(255,255,255,0.3)',
                color: '#fff',
                fontSize: '0.9rem',
                cursor: 'pointer'
              }}
            >
              {loadingChats ? <span className="buttonSpinner" style={{ marginRight: 0 }} aria-hidden="true" /> : <ReloadIcon size={16} />}
            </button>
            <button
              type="button"
              onClick={toggleProfileMenu}
              aria-label="Perfil y configuraciones"
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                background: currentUser?.avatarUrl ? 'transparent' : getAvatarGradient(currentUser?.avatarColor || currentUser?.id || 'me'),
                color: '#fff',
                fontWeight: '700',
                border: '2px solid #fff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.85rem',
                boxShadow: '0 0 8px rgba(255,255,255,0.4)',
                transition: 'all 0.2s ease',
                padding: 0,
                flexShrink: 0,
                overflow: 'hidden'
              }}
            >
              {currentUser?.avatarUrl ? (
                <img src={currentUser.avatarUrl} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                (currentUser?.username || "Yo").slice(0, 2).toUpperCase()
              )}
            </button>
          </div>
        </header>

        <div className="searchWrap" style={{ display: 'flex', gap: '8px', alignItems: 'center', position: 'relative', width: '100%' }}>
          <label htmlFor="chatSearchInput" className="sr-only">
            {viewMode === "statuses" ? "Buscar estado" : "Buscar chat"}
          </label>
          <SearchIcon size={16} className="searchIconSvg" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input
            id="chatSearchInput"
            ref={searchInputRef}
            type="text"
            value={localChatSearch}
            onChange={handleChatSearchChange}
            placeholder={viewMode === "statuses" ? "Buscar estado..." : "Buscar chat... (Ctrl+K)"}
            style={{ flex: 1, paddingLeft: '36px', paddingRight: localChatSearch ? '36px' : '12px' }}
          />
          {localChatSearch && (
            <button
              className="iconButton"
              onClick={() => {
                setLocalChatSearch("");
                setChatSearch("");
                searchInputRef.current?.focus();
              }}
              title="Borrar búsqueda"
              aria-label="Borrar búsqueda"
              style={{
                position: 'absolute',
                right: viewMode !== "statuses" ? '46px' : '8px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 2
              }}
            >
              <CloseIcon size={14} />
            </button>
          )}
          {viewMode !== "statuses" && (
            <button
              type="button"
              onClick={() => setShowNewChatModal(true)}
              style={{
                background: 'linear-gradient(135deg, #a855f7 0%, #6366f1 100%)',
                color: '#fff',
                border: 'none',
                width: '38px',
                height: '38px',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1rem',
                cursor: 'pointer',
                transition: 'transform 0.2s ease',
                boxShadow: '0 4px 10px rgba(99, 102, 241, 0.2)',
                flexShrink: 0
              }}
              title="Iniciar nuevo chat"
              aria-label="Iniciar nuevo chat"
            >
              <PlusIcon size={18} />
            </button>
          )}
        </div>

        <div className="chatList">
          {/* Followed Stories Circular Bar */}
          {viewMode === "chats" && currentUser && (
            <div className="storiesBar" style={{
              display: 'flex',
              gap: '15px',
              padding: '10px 15px',
              overflowX: 'auto',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              background: 'rgba(255, 255, 255, 0.02)',
              borderRadius: '16px',
              marginBottom: '10px',
              scrollbarWidth: 'none' // hides scrollbar on Firefox
            }}>
              {/* My Status Bubble */}
              {(() => {
                const myActiveStatuses = publicStatuses.filter(s => String(s.userId) === String(currentUser?.id));
                const hasMyStatus = myActiveStatuses.length > 0;
                return (
                  <button
                    onClick={() => {
                      if (hasMyStatus) {
                        setStoryPlayList(myActiveStatuses);
                        setActiveStoryIndex(0);
                      } else {
                        setShowNewStatusModal(true);
                      }
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '4px',
                      cursor: 'pointer',
                      flexShrink: 0,
                      position: 'relative'
                    }}
                  >
                    <div style={{
                      width: '50px',
                      height: '50px',
                      borderRadius: '50%',
                      padding: '3px',
                      background: hasMyStatus ? 'linear-gradient(135deg, #00d2ff 0%, #00d2ff 100%)' : 'rgba(255,255,255,0.1)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      position: 'relative'
                    }}>
                      <div style={{
                        width: '100%',
                        height: '100%',
                        borderRadius: '50%',
                        background: (currentUser?.avatarUrl) ? 'transparent' : getAvatarGradient(currentUser?.avatarColor || currentUser?.id || 'me'),
                        border: '2px solid #0d1418',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: '700',
                        color: '#fff',
                        fontSize: '0.85rem',
                        overflow: 'hidden'
                      }}>
                        {currentUser?.avatarUrl ? (
                          <img src={currentUser.avatarUrl} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          (currentUser?.username || "Yo").slice(0, 2).toUpperCase()
                        )}
                      </div>
                      
                      {!hasMyStatus && (
                        <div style={{
                          position: 'absolute',
                          bottom: '-2px',
                          right: '-2px',
                          width: '18px',
                          height: '18px',
                          borderRadius: '50%',
                          background: '#ff6f24',
                          border: '2px solid #0d1418',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#fff',
                          fontSize: '0.75rem',
                          fontWeight: 'bold',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
                        }}>
                          +
                        </div>
                      )}
                    </div>
                    <span style={{
                      fontSize: '0.7rem',
                      color: hasMyStatus ? '#00d2ff' : 'var(--text-muted)',
                      fontWeight: '600',
                      maxWidth: '65px',
                      whiteSpace: 'nowrap',
                      textOverflow: 'ellipsis',
                      overflow: 'hidden'
                    }}>
                      {hasMyStatus ? 'Mi Estado' : 'Añadir'}
                    </span>
                  </button>
                );
              })()}

              {followedStories.map((story, idx) => (
                <button
                  key={story._id}
                  onClick={() => {
                    viewPublicStatus(story._id); // Mark as viewed on backend
                    setStoryPlayList(followedStories);
                    setActiveStoryIndex(idx);
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '4px',
                    cursor: 'pointer',
                    flexShrink: 0
                  }}
                >
                  <div style={{
                    width: '50px',
                    height: '50px',
                    borderRadius: '50%',
                    padding: '3px',
                    background: 'linear-gradient(135deg, #ff6f24 0%, #7c3aed 100%)', // Active story ring!
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <div style={{
                      width: '100%',
                      height: '100%',
                      borderRadius: '50%',
                      background: story.avatarUrl ? 'transparent' : getAvatarGradient(story.avatarColor || story.userId),
                      border: '2px solid #0d1418',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: '700',
                      color: '#fff',
                      fontSize: '0.85rem',
                      overflow: 'hidden'
                    }}>
                      {story.avatarUrl ? (
                        <img src={story.avatarUrl} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        story.username.slice(0, 2).toUpperCase()
                      )}
                    </div>
                  </div>
                  <span style={{ fontSize: '0.7rem', color: '#ccc', maxWidth: '55px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {story.username}
                  </span>
                </button>
              ))}
            </div>
          )}

          {viewMode === "statuses" && filteredStatusArchive.map((item) => (
            <button
              key={item._id || item.id || item.providerStatusMessageId}
              className="chatItem statusArchiveSidebarItem"
              onClick={() => setSelectedChatId("")}
            >
              <div className="chatAvatar statusArchiveThumb" aria-hidden="true">
                {(item.imageUrl || item.mediaUrl) ? (
                  <img
                    className="chatAvatarImg"
                    src={item.mediaUrl ? `${API_URL}${item.mediaUrl}` : `${API_URL}${item.imageUrl}`}
                    alt={`Estado de ${item.statusOwnerName || item.statusOwnerId}`}
                    loading="lazy"
                  />
                ) : "ST"}
              </div>
              <div className="chatText">
                <div className="chatNameRow">
                  <div className="chatName">{item.statusOwnerName || item.statusOwnerId || "Estado"}</div>
                  <div className="chatTopMeta">
                    {item.timestamp ? <time className="chatTime">{formatChatTime(item.timestamp)}</time> : null}
                  </div>
                </div>
                <div className="chatMeta">{item.description || "Estado sin descripción"}</div>
              </div>
            </button>
          ))}

          {viewMode === "discover" && (
            loadingProximity ? (
              <p className="helper">Cargando usuarios cercanos...</p>
            ) : filteredProximityUsers.length === 0 ? (
              <p className="helper">No se encontraron usuarios en la zona.</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', padding: '10px 5px' }}>
                {filteredProximityUsers.map((user) => (
                  <div
                    key={user._id}
                    style={{
                      background: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '18px',
                      padding: '14px',
                      textAlign: 'center',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '8px',
                      backdropFilter: 'blur(10px)',
                      boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.3)',
                      position: 'relative'
                    }}
                  >
                    {/* Status Dot */}
                    <span
                      style={{
                        position: 'absolute',
                        top: '12px',
                        right: '12px',
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: user.status === 'online' ? 'var(--success)' : '#64748b',
                        boxShadow: `0 0 8px ${user.status === 'online' ? 'var(--success)' : '#64748b'}`
                      }}
                    />
                    {/* Profile Avatar */}
                    <div
                      style={{
                        width: '54px',
                        height: '54px',
                        borderRadius: '50%',
                        background: user.avatarUrl ? 'transparent' : getAvatarGradient(user.avatarColor || user._id),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: '700',
                        color: '#fff',
                        fontSize: '1.2rem',
                        border: '2px solid rgba(255, 255, 255, 0.2)',
                        overflow: 'hidden'
                      }}
                    >
                      {user.avatarUrl ? (
                        <img src={user.avatarUrl} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        user.username.slice(0, 2).toUpperCase()
                      )}
                    </div>
                    {/* Name & Bio */}
                    <div>
                      <div style={{ fontWeight: '700', color: '#fff', fontSize: '0.9rem' }}>{user.username}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '120px' }}>
                        {user.bio || '¡Hola! Estoy usando Tapchat.'}
                      </div>
                    </div>
                    {/* Distance Badge */}
                    <span style={{
                      fontSize: '0.7rem',
                      padding: '2px 8px',
                      borderRadius: '20px',
                      background: 'rgba(255, 111, 36, 0.1)',
                      color: 'var(--accent-primary)',
                      border: '1px solid rgba(255, 111, 36, 0.2)',
                      fontWeight: '600'
                    }}>
                      📍 a {user.distanceMeters ? (user.distanceMeters < 1000 ? `${user.distanceMeters} m` : `${(user.distanceMeters/1000).toFixed(1)} km`) : '150 m'}
                    </span>
                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '6px', width: '100%', marginTop: '4px' }}>
                      <button
                        onClick={() => {
                          const localChat = {
                            id: user._id,
                            name: user.username,
                            provider: 'local',
                            accountId: currentUser?.id || 'default',
                            timestamp: Math.floor(Date.now() / 1000),
                            unreadCount: 0,
                            isGroup: false,
                            avatarColor: user.avatarColor || 'hsl(180, 50%, 40%)',
                            avatarUrl: user.avatarUrl || ''
                          };

                          setChats(prev => {
                            if (prev.some(c => c.id === user._id)) return prev;
                            return [localChat, ...prev];
                          });

                          setSelectedChatId(user._id);
                          selectedChatIdRef.current = user._id;
                          setViewMode("chats");
                        }}
                        style={{
                          flex: 1,
                          padding: '6px',
                          borderRadius: '10px',
                          border: 'none',
                          background: 'linear-gradient(135deg, #a855f7 0%, #6366f1 100%)',
                          color: '#fff',
                          fontSize: '0.75rem',
                          fontWeight: '600',
                          cursor: 'pointer'
                        }}
                      >
                        Chat
                      </button>
                      <button
                        onClick={() => toggleFollowUser(user._id, user.isFollowed)}
                        style={{
                          flex: 1,
                          padding: '6px',
                          borderRadius: '10px',
                          border: '1px solid rgba(255, 255, 255, 0.15)',
                          background: user.isFollowed ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                          color: user.isFollowed ? '#a855f7' : '#ccc',
                          fontSize: '0.75rem',
                          fontWeight: '600',
                          cursor: 'pointer'
                        }}
                      >
                        {user.isFollowed ? 'Seguido' : 'Seguir'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {viewMode === "muro" && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', padding: '5px' }}>
              {/* Post Composer Card */}
              <div style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '18px',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
              }}>
                <textarea
                  value={newPublicStatusBody}
                  onChange={(e) => setNewPublicStatusBody(e.target.value)}
                  placeholder="Comparte algo efímero con el mundo... (Dura 24 horas)"
                  aria-label="Publicar estado en el muro"
                  style={{
                    width: '100%',
                    background: 'rgba(0,0,0,0.15)',
                    border: '1px solid rgba(255,255,255,0.05)',
                    borderRadius: '12px',
                    padding: '10px',
                    color: '#fff',
                    fontSize: '0.85rem',
                    resize: 'none',
                    outline: 'none'
                  }}
                  rows={2}
                />
                <button
                  onClick={publishPublicStatus}
                  disabled={publishingStatus || !newPublicStatusBody.trim()}
                  style={{
                    background: 'linear-gradient(135deg, #ff6f24 0%, #7c3aed 100%)',
                    color: '#fff',
                    border: 'none',
                    padding: '8px',
                    borderRadius: '10px',
                    fontWeight: '600',
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px'
                  }}
                >
                  {publishingStatus ? 'Publicando...' : '📢 Publicar en Muro'}
                </button>
              </div>

              {/* Status Wall Feed */}
              {loadingPublicStatuses ? (
                <p className="helper">Cargando publicaciones efímeras...</p>
              ) : filteredPublicStatuses.length === 0 ? (
                <p className="helper">Aún no hay publicaciones en el muro. ¡Sé el primero!</p>
              ) : (
                filteredPublicStatuses.map((status) => (
                  <div
                    key={status._id}
                    onMouseEnter={() => viewPublicStatus(status._id)}
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '16px',
                      padding: '16px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px',
                      transition: 'all 0.2s ease',
                      position: 'relative'
                    }}
                  >
                    {/* Header: Publisher Info */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{
                        width: '38px',
                        height: '38px',
                        borderRadius: '50%',
                        background: status.avatarUrl ? 'transparent' : getAvatarGradient(status.avatarColor || status.userId),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: '700',
                        color: '#fff',
                        fontSize: '0.8rem',
                        overflow: 'hidden',
                        flexShrink: 0
                      }}>
                        {status.avatarUrl ? (
                          <img src={status.avatarUrl} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          (status.username || "Yo").slice(0, 2).toUpperCase()
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontWeight: '600', color: '#fff', fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {status.username || "Usuario"}
                          </span>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            · @{(status.username || "usuario").toLowerCase()}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)', marginTop: '2px' }}>
                          📍 {status.distanceMeters ? (status.distanceMeters < 1000 ? `${status.distanceMeters} m` : `${(status.distanceMeters/1000).toFixed(1)} km`) : '150 m'}
                        </div>
                      </div>
                      {status.isOfflinePending && (
                        <span style={{ fontSize: '0.7rem', color: '#ff9f43', background: 'rgba(255, 159, 67, 0.1)', padding: '2px 8px', borderRadius: '12px' }}>
                          🕒 Pendiente
                        </span>
                      )}
                    </div>

                    {/* Body text */}
                    <p style={{
                      fontSize: '0.95rem',
                      color: '#e2e8f0',
                      margin: 0,
                      lineHeight: '1.5',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word'
                    }}>
                      {status.body}
                    </p>

                    {/* Footer stats / actions */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '24px',
                      fontSize: '0.8rem',
                      color: 'var(--text-muted)',
                      borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                      paddingTop: '10px',
                      marginTop: '4px'
                    }}>
                      <button
                        onClick={() => likePublicStatus(status._id)}
                        aria-label={status.isLiked ? "Ya no me gusta" : "Me gusta"}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: status.isLiked ? '#ff5252' : '#94a3b8',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontWeight: '600',
                          padding: 0
                        }}
                      >
                        <HeartIcon size={16} filled={status.isLiked} /> {status.likesCount || 0}
                      </button>

                      <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8' }}>
                        <EyeIcon size={16} /> {status.viewsCount || 0}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {viewMode === "chats" && filteredChats.map((chat) => (
            <button
              key={chat.id}
              aria-label={`Chat con ${chat.name || chat.id}`}
              className={`chatItem ${chat.id === selectedChatId ? "active" : ""}`}
              onClick={() => setSelectedChatId(chat.id)}
              aria-current={chat.id === selectedChatId ? "page" : undefined}
            >
              <div
                className="chatAvatar"
                style={!chat.avatarUrl ? { background: getAvatarGradient(chat.id) } : {}}
                aria-hidden="true"
              >
                {chat.avatarUrl ? (
                  <img
                    className="chatAvatarImg"
                    src={chat.avatarUrl}
                    alt={`Foto de ${chat.name || chat.id}`}
                    loading="lazy"
                  />
                ) : (
                  initialsForChat(chat)
                )}
              </div>
              <div className="chatText">
                <div className="chatNameRow">
                  <div className="chatName">{chat.name || chat.id}</div>
                  <div className="chatTopMeta">
                    {chat.timestamp ? <time className="chatTime">{formatChatTime(chat.timestamp)}</time> : null}
                    {chat.isGroup ? <span className="chatKindBadge">Grupo</span> : null}
                    {(() => {
                      const chatMsgs = messagesByChat[chat.id] || [];
                      return <ChatSentiment lastMsg={chatMsgs.length > 0 ? chatMsgs[chatMsgs.length - 1] : null} />;
                    })()}
                    {chat.unreadCount > 0 ? (
                      <span className="unreadBadge">{chat.unreadCount}</span>
                    ) : null}
                  </div>
                </div>
                <div className="chatMeta" style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                  {(() => {
                    const chatMsgs = messagesByChat[chat.id] || [];
                    const lastMsg = chatMsgs.length > 0 ? chatMsgs[chatMsgs.length - 1] : null;
                    if (lastMsg) {
                      const prefix = lastMsg.fromMe ? "Tú: " : "";
                      return `${prefix}${lastMsg.body || (lastMsg.mediaType === "image" ? "📷 Imagen" : "Archivo")}`;
                    }
                    return chat.unreadCount
                      ? `${chat.isGroup ? "Grupo" : "Directo"} · Sin contestar`
                      : `${chat.isGroup ? "Grupo" : "Directo"} · Sin notificaciones`;
                  })()}
                </div>
              </div>
            </button>
          ))}

          {viewMode === "statuses" && filteredStatusArchive.length === 0 ? (
            <p className="helper">{loadingStatusArchive ? "Cargando estados..." : "No hay estados archivados."}</p>
          ) : null}
          {viewMode === "chats" && filteredChats.length === 0 ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '32px 16px',
              textAlign: 'center',
              color: 'var(--text-muted)'
            }}>
              <div style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: 'rgba(255, 255, 255, 0.05)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '16px',
                color: 'var(--text-secondary)'
              }}>
                <ChatIcon size={32} />
              </div>
              <h4 style={{ color: 'var(--text-primary)', marginBottom: '8px', fontSize: '1.1rem', fontWeight: '600' }}>No hay chats activos</h4>
              <p style={{ fontSize: '0.85rem', marginBottom: '20px', lineHeight: '1.4', maxWidth: '240px' }}>
                Conéctate con otros usuarios o inicia una nueva conversación.
              </p>
              <button
                className="primary"
                onClick={() => setShowNewChatModal(true)}
                style={{ padding: '10px 20px', borderRadius: '10px', fontSize: '0.9rem' }}
              >
                <PlusIcon size={16} /> Iniciar Chat
              </button>
            </div>
          ) : null}
          {viewMode === "discover" && filteredProximityUsers.length === 0 ? <p className="helper">No hay usuarios cercanos.</p> : null}
          {viewMode === "muro" && filteredPublicStatuses.length === 0 ? <p className="helper">No hay estados públicos.</p> : null}

          {viewMode === "notifications" && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '10px 0' }}>
              {notifications.length === 0 ? (
                <p className="helper">No tienes notificaciones nuevas.</p>
              ) : (
                notifications.map((notif) => (
                  <div
                    key={notif.id}
                    style={{
                      display: 'flex',
                      gap: '12px',
                      padding: '12px',
                      borderRadius: '14px',
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.05)',
                      fontSize: '0.85rem',
                      lineHeight: '1.4',
                      alignItems: 'flex-start'
                    }}
                  >
                    <span style={{ fontSize: '1.2rem', marginTop: '2px' }}>
                      {notif.type === 'message' ? '✉️' : notif.type === 'success' ? '✅' : notif.type === 'warning' ? '⚠️' : 'ℹ️'}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: '#fff', fontWeight: '500' }}>{notif.text}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '4px' }}>{notif.time}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setNotifications(prev => prev.filter(n => n.id !== notif.id))}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-muted)',
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                        padding: '0 4px',
                        display: 'inline-flex'
                      }}
                      title="Eliminar"
                      aria-label="Eliminar notificación"
                    >
                      ❌
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        <div style={{
          display: 'flex',
          background: 'rgba(13, 20, 24, 0.95)',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          padding: '10px 2px',
          justifyContent: 'space-around',
          alignItems: 'center'
        }}>
          <button
            type="button"
            onClick={() => {
              setViewMode("statuses");
              setSelectedChatId("");
              fetchStatusArchive(false);
            }}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              color: viewMode === "statuses" ? '#ff6f24' : 'var(--text-muted)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer',
              fontSize: '0.7rem',
              fontWeight: viewMode === "statuses" ? '700' : '500',
              transition: 'all 0.2s ease',
              textShadow: viewMode === "statuses" ? '0 0 10px rgba(255, 111, 36, 0.3)' : 'none'
            }}
          >
            <StatusIcon size={18} />
            Estados
          </button>
          
          <button
            type="button"
            onClick={() => setViewMode("chats")}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              color: viewMode === "chats" ? '#ff6f24' : 'var(--text-muted)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer',
              fontSize: '0.7rem',
              fontWeight: viewMode === "chats" ? '700' : '500',
              transition: 'all 0.2s ease',
              textShadow: viewMode === "chats" ? '0 0 10px rgba(255, 111, 36, 0.3)' : 'none'
            }}
          >
            <ChatIcon size={18} />
            Chats
          </button>

          <button
            type="button"
            onClick={() => {
              setViewMode("discover");
              setSelectedChatId("");
              loadProximityUsers();
            }}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              color: viewMode === "discover" ? '#ff6f24' : 'var(--text-muted)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer',
              fontSize: '0.7rem',
              fontWeight: viewMode === "discover" ? '700' : '500',
              transition: 'all 0.2s ease',
              textShadow: viewMode === "discover" ? '0 0 10px rgba(255, 111, 36, 0.3)' : 'none'
            }}
          >
            <ProximityIcon size={18} />
            Cercanos
          </button>

          <button
            type="button"
            onClick={() => {
              setViewMode("muro");
              setSelectedChatId("");
              loadPublicStatuses();
            }}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              color: viewMode === "muro" ? '#ff6f24' : 'var(--text-muted)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer',
              fontSize: '0.7rem',
              fontWeight: viewMode === "muro" ? '700' : '500',
              transition: 'all 0.2s ease',
              textShadow: viewMode === "muro" ? '0 0 10px rgba(255, 111, 36, 0.3)' : 'none'
            }}
          >
            <MuroIcon size={18} />
            Muro
          </button>
          
          <button
            type="button"
            onClick={() => {
              setViewMode("notifications");
              setSelectedChatId("");
            }}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              color: viewMode === "notifications" ? '#ff6f24' : 'var(--text-muted)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer',
              fontSize: '0.7rem',
              fontWeight: viewMode === "notifications" ? '700' : '500',
              transition: 'all 0.2s ease',
              textShadow: viewMode === "notifications" ? '0 0 10px rgba(255, 111, 36, 0.3)' : 'none',
              position: 'relative'
            }}
          >
            <AlertIcon size={18} />
            Alertas
            {notifications.length > 0 && (
              <span style={{
                position: 'absolute',
                top: '0px',
                right: '20%',
                background: '#ff6f24',
                color: '#fff',
                borderRadius: '50%',
                width: '14px',
                height: '14px',
                fontSize: '9px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: '800',
                border: '1px solid #1f2c33'
              }}>
                {notifications.length}
              </span>
            )}
          </button>
        </div>
      </aside>

      <section className="chatPanel">
        {viewMode === "statuses" ? (
          <>
            <header className="chatHeader">
              <div className="chatHeaderLeft">
                <button
                  className="secondary mobileBackBtn"
                  aria-label="Volver a la lista"
                  onClick={() => setViewMode("chats")}
                >
                  ←
                </button>
                <div className="chatHeaderAvatar statusArchivePanelIcon" aria-hidden="true">ST</div>
                <div className="chatHeaderInfo">
                  <h3>Estados archivados</h3>
                  <p>
                    {backendStatus.statusArchive?.lastRunAt
                      ? `Última revisión ${new Date(backendStatus.statusArchive.lastRunAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                      : "Escaneo automático cada minuto"}
                  </p>
                </div>
              </div>
              <div className="chatHeaderActions" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  className="secondary"
                  aria-label="Actualizar estados archivados"
                  onClick={() => fetchStatusArchive(false)}
                  disabled={loadingStatusArchive}
                  aria-busy={loadingStatusArchive}
                  style={{
                    width: '36px',
                    height: '36px',
                    padding: 0,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  {loadingStatusArchive ? <span className="buttonSpinner" style={{ marginRight: 0 }} aria-hidden="true" /> : "🔄"}
                </button>
                {isMobileLayout && (
                  <button
                    type="button"
                    onClick={toggleProfileMenu}
                    aria-label="Perfil y configuraciones"
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '50%',
                      background: currentUser?.avatarUrl ? 'transparent' : getAvatarGradient(currentUser?.avatarColor || currentUser?.id || 'me'),
                      color: '#fff',
                      fontWeight: '700',
                      border: '2px solid #fff',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.85rem',
                      boxShadow: '0 0 8px rgba(255,255,255,0.4)',
                      transition: 'all 0.2s ease',
                      padding: 0,
                      flexShrink: 0,
                      overflow: 'hidden'
                    }}
                  >
                    {currentUser?.avatarUrl ? (
                      <img src={currentUser.avatarUrl} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      (currentUser?.username || "Yo").slice(0, 2).toUpperCase()
                    )}
                  </button>
                )}
              </div>
            </header>

            <div className="messagesArea statusArchiveArea">
              {loadingStatusArchive ? <p className="helper">Cargando estados archivados...</p> : null}
              {!loadingStatusArchive && filteredStatusArchive.length === 0 ? (
                <p className="helper">Todavía no hay estados con imagen archivados.</p>
              ) : null}
              <div className="statusArchiveGrid">
                {filteredStatusArchive.map((item) => (
                  <article key={item._id || item.id || item.providerStatusMessageId} className="statusArchiveCard">
                    {item.mediaType === "video" && item.mediaUrl ? (
                      <video className="statusArchiveImage" src={`${API_URL}${item.mediaUrl}`} controls />
                    ) : (item.imageUrl || item.mediaUrl) ? (
                      <img
                        className="statusArchiveImage"
                        src={item.mediaUrl ? `${API_URL}${item.mediaUrl}` : `${API_URL}${item.imageUrl}`}
                        alt={`Estado de ${item.statusOwnerName || item.statusOwnerId}`}
                        loading="lazy"
                      />
                    ) : (
                      <div className="statusArchiveImage statusArchiveImageFallback">Sin imagen</div>
                    )}
                    <div className="statusArchiveBody">
                      <div className="statusArchiveCardHeader">
                        <h4>{item.statusOwnerName || item.statusOwnerId || "Estado"}</h4>
                        <time>{formatStatusDate(item.timestamp)}</time>
                      </div>
                      <p className="statusArchiveDescription">{item.description || "Sin descripción"}</p>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </>
        ) : !selectedChatId ? (
          <div className="chatIntroPanel" style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            padding: '24px',
            textAlign: 'center',
            color: 'rgba(255, 255, 255, 0.7)',
            background: 'rgba(255, 255, 255, 0.01)',
            backdropFilter: 'blur(10px)',
            borderRadius: '16px',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            margin: '16px'
          }}>
            <div style={{
              width: '82px',
              height: '82px',
              borderRadius: '50%',
              background: 'var(--accent-gradient)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              marginBottom: '24px',
              boxShadow: '0 8px 32px var(--accent-glow)'
            }}>
              <ChatIcon size={42} />
            </div>
            <h2 style={{ color: '#fff', marginBottom: '12px', fontSize: '1.8rem', fontWeight: '600' }}>Tapchat Premium</h2>
            <p style={{ maxWidth: '420px', fontSize: '0.95rem', lineHeight: '1.6', marginBottom: '24px', color: 'var(--text-muted)' }}>
              Comienza a chatear con otros usuarios buscando en la red o selecciona una conversación existente en la barra lateral.
            </p>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button className="primary" onClick={() => setViewMode("chats")} style={{ padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' }}>
                Ver Chats
              </button>
              <button className="secondary" onClick={() => setShowNewChatModal(true)} style={{ padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' }}>
                Buscar Usuario
              </button>
            </div>
          </div>
        ) : (
          <>
            <header className="chatHeader" style={{ position: 'relative' }}>
              <style>{`
                @keyframes tapchat-sync-shimmer {
                  0% { background-position: -200% 0; }
                  100% { background-position: 200% 0; }
                }
              `}</style>
              {syncingChat && (
                <div style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  width: '100%',
                  height: '3px',
                  background: 'linear-gradient(90deg, #ff6f24 25%, #ff8c42 50%, #ff6f24 75%)',
                  backgroundSize: '200% 100%',
                  animation: 'tapchat-sync-shimmer 1.5s infinite linear',
                  zIndex: 20
                }} />
              )}
              <div className="chatHeaderLeft">
                <button
                  className="secondary mobileBackBtn"
                  aria-label="Volver a lista de chats"
                  onClick={() => setSelectedChatId("")}
                >
                  ←
                </button>
                <div
                  className="chatHeaderAvatar"
                  style={!selectedChat?.avatarUrl ? { background: getAvatarGradient(selectedChat?.id) } : {}}
                  aria-hidden="true"
                >
                  {selectedChat?.avatarUrl ? (
                    <img
                      className="chatAvatarImg"
                      src={selectedChat.avatarUrl}
                      alt={`Foto de ${selectedChat.name || selectedChat.id}`}
                      loading="lazy"
                    />
                  ) : (
                    initialsForChat(selectedChat)
                  )}
                </div>
                <div className="chatHeaderInfo">
                  <h3>{selectedChat?.name || "Seleccioná un chat"}</h3>
                  <p>
                    {typingStates[selectedChatId] ? (
                      <span style={{ color: '#16a34a', fontWeight: '600' }}>Escribiendo...</span>
                    ) : (
                      <>
                        {selectedChat?.id || "Sin chat seleccionado"}
                        {selectedChat?.isGroup ? " · Grupo" : ""}
                      </>
                    )}
                  </p>
                </div>
              </div>
              <div className="chatHeaderActions" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  className={inVoiceCall && voiceRoomId === selectedChatId ? "primary" : "secondary"}
                  aria-label={inVoiceCall && voiceRoomId === selectedChatId ? "Salir de llamada de voz" : "Iniciar llamada de voz"}
                  onClick={() => {
                    if (inVoiceCall) {
                      leaveVoiceRoom();
                    } else {
                      joinVoiceRoom(selectedChatId);
                    }
                  }}
                  disabled={!selectedChatId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: inVoiceCall && voiceRoomId === selectedChatId ? '#ef4444' : undefined,
                    color: inVoiceCall && voiceRoomId === selectedChatId ? '#fff' : undefined,
                    border: inVoiceCall && voiceRoomId === selectedChatId ? 'none' : undefined,
                  }}
                >
                  <PhoneCallIcon size={16} />
                  <span className="hideOnMobile">
                    {inVoiceCall && voiceRoomId === selectedChatId ? "Salir" : "Llamar"}
                  </span>
                </button>
                <button
                  className="secondary"
                  aria-label="Ver recursos del contacto"
                  onClick={fetchResources}
                  disabled={!selectedChatId}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <AttachmentIcon size={16} />
                  <span className="hideOnMobile">Recursos</span>
                </button>
                <button
                  className="secondary"
                  aria-label="Recargar mensajes"
                  onClick={() => fetchMessages(selectedChatId, { withLoader: true })}
                  disabled={!selectedChatId || loadingMessages[selectedChatId]}
                  aria-busy={loadingMessages[selectedChatId]}
                  style={{
                    width: '36px',
                    height: '36px',
                    padding: 0,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  {loadingMessages[selectedChatId] ? <span className="buttonSpinner" style={{ marginRight: 0 }} aria-hidden="true" /> : <ReloadIcon size={16} />}
                </button>
                {isMobileLayout && (
                  <button
                    type="button"
                    onClick={toggleProfileMenu}
                    aria-label="Perfil y configuraciones"
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '50%',
                      background: currentUser?.avatarUrl ? 'transparent' : getAvatarGradient(currentUser?.avatarColor || currentUser?.id || 'me'),
                      color: '#fff',
                      fontWeight: '700',
                      border: '2px solid #fff',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.85rem',
                      boxShadow: '0 0 8px rgba(255,255,255,0.4)',
                      transition: 'all 0.2s ease',
                      padding: 0,
                      flexShrink: 0,
                      overflow: 'hidden'
                    }}
                  >
                    {currentUser?.avatarUrl ? (
                      <img src={currentUser.avatarUrl} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      (currentUser?.username || "Yo").slice(0, 2).toUpperCase()
                    )}
                  </button>
                )}
              </div>
            </header>

            {inVoiceCall && voiceRoomId === selectedChatId && (
              <div style={{ display: 'flex', flexDirection: 'column', width: '100%', zIndex: 10 }}>
                <div style={{
                  background: 'rgba(15, 23, 42, 0.95)',
                  backdropFilter: 'blur(10px)',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                  padding: '12px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '15px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        background: '#16a34a',
                        boxShadow: '0 0 10px #16a34a',
                        display: 'inline-block'
                      }} />
                      <span style={{ fontSize: '0.85rem', color: '#fff', fontWeight: '600' }}>Llamada de Voz Activa</span>
                    </div>
                    
                    {/* Participant Avatars */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '10px' }}>
                      {/* Local User */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'rgba(255,255,255,0.05)', padding: '4px 10px', borderRadius: '15px', border: '1px solid rgba(255,255,255,0.1)' }}>
                        <div style={{
                          width: '20px',
                          height: '20px',
                          borderRadius: '50%',
                          background: currentUser?.avatarUrl ? 'transparent' : getAvatarGradient(currentUser?.avatarColor || currentUser?.id || 'me'),
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.65rem',
                          fontWeight: '700',
                          color: '#fff',
                          overflow: 'hidden'
                        }}>
                          {currentUser?.avatarUrl ? <img src={currentUser.avatarUrl} alt="Yo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (currentUser?.username || "Yo").slice(0, 2).toUpperCase()}
                        </div>
                        <span style={{ fontSize: '0.75rem', color: '#eee' }}>Tú {isMuted ? '🔇' : '🎙️'}</span>
                      </div>

                      {/* Remote Peers */}
                      {voicePeers.map(peer => (
                        <div key={peer.socketId} style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'rgba(255,255,255,0.05)', padding: '4px 10px', borderRadius: '15px', border: '1px solid rgba(255,255,255,0.1)' }}>
                          <div style={{
                            width: '20px',
                            height: '20px',
                            borderRadius: '50%',
                            background: peer.avatarUrl ? 'transparent' : getAvatarGradient(peer.avatarColor || peer.userId),
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.65rem',
                            fontWeight: '700',
                            color: '#fff',
                            overflow: 'hidden'
                          }}>
                            {peer.avatarUrl ? <img src={peer.avatarUrl} alt={peer.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : peer.username.slice(0, 2).toUpperCase()}
                          </div>
                          <span style={{ fontSize: '0.75rem', color: '#eee' }}>{peer.username}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <button
                      onClick={toggleMute}
                      style={{
                        background: isMuted ? '#ef4444' : 'rgba(255,255,255,0.1)',
                        border: 'none',
                        color: '#fff',
                        borderRadius: '50%',
                        width: '36px',
                        height: '36px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        fontSize: '1rem',
                        transition: 'all 0.2s',
                        padding: 0
                      }}
                      title={isMuted ? "Activar micrófono" : "Silenciar micrófono"}
                    >
                      {isMuted ? "🔇" : "🎙️"}
                    </button>
                    <button
                      onClick={screenStream ? stopScreenShare : startScreenShare}
                      style={{
                        background: screenStream ? '#16a34a' : 'rgba(255,255,255,0.1)',
                        border: 'none',
                        color: '#fff',
                        borderRadius: '50%',
                        width: '36px',
                        height: '36px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        fontSize: '1.1rem',
                        transition: 'all 0.2s',
                        padding: 0
                      }}
                      title={screenStream ? "Dejar de compartir pantalla" : "Compartir pantalla"}
                    >
                      🖥️
                    </button>
                    
                    {/* Volume Slider Control */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.06)', padding: '4px 10px', borderRadius: '15px', border: '1px solid rgba(255,255,255,0.1)' }}>
                      <span style={{ fontSize: '0.8rem', color: '#ccc' }}>🔊</span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={callVolume}
                        onChange={(e) => setCallVolume(parseInt(e.target.value))}
                        style={{
                          width: '70px',
                          height: '4px',
                          accentColor: '#ff6f24',
                          cursor: 'pointer'
                        }}
                        title={`Volumen de llamada: ${callVolume}%`}
                      />
                    </div>

                    <button
                      onClick={leaveVoiceRoom}
                      style={{
                        background: '#ef4444',
                        border: 'none',
                        color: '#fff',
                        borderRadius: '8px',
                        padding: '8px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        fontWeight: '600'
                      }}
                    >
                      Desconectar
                    </button>
                  </div>
                </div>

                {/* Screen Share Video Stream Panel */}
                {(screenStream || voicePeers.some(p => p.stream && p.stream.getVideoTracks().length > 0)) && (
                  <div style={{
                    background: '#0a0f1d',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                    padding: '10px',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    maxHeight: '260px',
                    position: 'relative'
                  }}>
                    {screenStream ? (
                      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <video
                          autoPlay
                          playsInline
                          muted
                          ref={el => { if (el && el.srcObject !== screenStream) el.srcObject = screenStream; }}
                          style={{ maxWidth: '100%', maxHeight: '200px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}
                        />
                        <span style={{ fontSize: '0.75rem', color: '#a855f7', marginTop: '6px', fontWeight: '600' }}>Estás compartiendo tu pantalla</span>
                      </div>
                    ) : (
                      (() => {
                        const activeVideoPeer = voicePeers.find(p => p.stream && p.stream.getVideoTracks().length > 0);
                        if (!activeVideoPeer) return null;
                        return (
                          <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <video
                              autoPlay
                              playsInline
                              ref={el => { if (el && el.srcObject !== activeVideoPeer.stream) el.srcObject = activeVideoPeer.stream; }}
                              style={{ maxWidth: '100%', maxHeight: '200px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}
                            />
                            <span style={{ fontSize: '0.75rem', color: '#ff6f24', marginTop: '6px', fontWeight: '600' }}>Pantalla compartida de {activeVideoPeer.username}</span>
                          </div>
                        );
                      })()
                    )}
                  </div>
                )}
                
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
            )}

            <div
              className="messagesArea"
              ref={messagesAreaRef}
              onScroll={handleMessagesScroll}
            >
              {loadingMessages[selectedChatId] && messages.length === 0 ? (
                <>
                  <div className="skeleton-msg"></div>
                  <div className="skeleton-msg"></div>
                  <div className="skeleton-msg"></div>
                </>
              ) : null}
              {!loadingMessages[selectedChatId] && syncingChat && messages.length === 0 ? <p className="helper">Sincronizando...</p> : null}
              {!loadingMessages[selectedChatId] && !syncingChat && messages.length === 0 ? (
                <p className="helper">Este chat todavía no tiene mensajes visibles.</p>
              ) : null}

              {messages.map((msg, idx) => {
                const prevMsg = messages[idx - 1];
                const isConsecutive = prevMsg && prevMsg.fromMe === msg.fromMe;
                return (
                <div key={msg._uiId} className={`bubbleRow ${msg.fromMe ? "mine" : "theirs"} ${isConsecutive ? "consecutive" : ""} ${msg.isRevoked ? "revokedRow" : ""}`}>
                  <article
                    className={`bubble ${
                      !msg.fromMe && grammarInsights[msg._uiId]?.hasErrors ? "incomingGrammarError" : ""
                    } ${msg.isRevoked ? "isRevoked" : ""} ${msg.status === 'offline_pending' ? "is-offline" : ""}`}
                    tabIndex={!msg.fromMe && grammarInsights[msg._uiId]?.hasErrors ? 0 : undefined}
                    role={!msg.fromMe && grammarInsights[msg._uiId]?.hasErrors ? "button" : undefined}
                    aria-label={!msg.fromMe && grammarInsights[msg._uiId]?.hasErrors ? "Mensaje con errores gramaticales. Presionar para responder con corrección." : undefined}
                    onClick={
                      !msg.fromMe && grammarInsights[msg._uiId]?.hasErrors
                        ? () => prepareGrammarReply(msg)
                        : undefined
                    }
                    onKeyDown={
                      !msg.fromMe && grammarInsights[msg._uiId]?.hasErrors
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              prepareGrammarReply(msg);
                            }
                          }
                        : undefined
                    }
                  >
                    {msg.replyToText ? (
                      <div className="replyPreview">
                        <span className="replyLabel">Respuesta a</span>
                        <p>{msg.replyToText}</p>
                      </div>
                    ) : null}
                    {!msg.fromMe && grammarInsights[msg._uiId]?.hasErrors ? (
                      <span className="grammarErrorBadge">Posibles errores gramaticales · Presionar para responder</span>
                    ) : null}
                    {!msg.fromMe && Array.isArray(msg.mentionedIds) && msg.mentionedIds.length > 0 ? (
                      <span className="pingBadge">Ping</span>
                    ) : null}
                    {msg.isRevoked ? (
                      <div className="revokedNotice">🗑️ Mensaje eliminado</div>
                    ) : null}
                    {msg.mediaType === "image" && (msg.imageDataUrl || msg.mediaUrl) ? (
                      <img className="msgImage" src={msg.mediaUrl ? `${API_URL}${msg.mediaUrl}` : msg.imageDataUrl} alt="Imagen del chat" />
                    ) : null}
                    {msg.mediaType === "video" && msg.mediaUrl ? (
                      <video className="msgVideo" src={`${API_URL}${msg.mediaUrl}`} controls />
                    ) : null}
                    {msg.mediaType === "audio" && msg.mediaUrl ? (
                      <audio className="msgAudio" src={`${API_URL}${msg.mediaUrl}`} controls />
                    ) : null}
                    <p className={msg.isRevoked ? "revokedText" : ""}>{msg.body || "[mensaje vacío]"}</p>
                    <div className="bubbleMeta">
                      <time>{formatTime(msg.timestamp)}</time>
                      {msg.fromMe && <AckIcon status={msg.status || msg.ack} />}
                    </div>
                    <div className="bubbleActions">
                      <button
                        className="replyBtn"
                        aria-label="Responder a este mensaje"
                        onClick={(e) => {
                          e.stopPropagation();
                          startReply(msg);
                        }}
                      >
                        Responder
                      </button>
                    </div>
                  </article>
                </div>
              );})}
              {showJumpToLatest ? (
                <button
                  className="jumpToLatest"
                  aria-label="Ir al último mensaje"
                  onClick={() => scrollMessagesToBottom("smooth")}
                >
                  ↓ Ir al último
                  {pendingIncomingCount > 0 ? (
                    <span className="jumpToLatestCount">{pendingIncomingCount}</span>
                  ) : null}
                </button>
              ) : null}
            </div>

            <footer className="composer">
              {replyQueue.length > 0 ? (
                <section className="multiReplyPanel">
                  <div className="multiReplyHeader">
                    <p>{replyQueue.length} respuestas en paralelo listas</p>
                    <button
                      className="primary"
                      aria-label="Enviar todas las respuestas en cola"
                      onClick={sendAllQueuedReplies}
                    >
                      Enviar todas
                    </button>
                  </div>
                  {replyQueue.map((item) => (
                    <article key={item.localId} className="queuedReplyCard">
                      <p className="queuedReplyLabel">Respuesta sugerida</p>
                      <p className="queuedReplyOriginal">{item.original}</p>
                      <textarea
                        value={item.text}
                        onChange={(e) => updateQueuedReplyText(item.localId, e.target.value)}
                        rows={2}
                      />
                      <div className="composerActions">
                        <button
                          className="primary"
                          aria-label="Enviar respuesta sugerida"
                          disabled={Boolean(sendingReplyQueueIds[item.localId]) || !item.text.trim()}
                          onClick={() => sendQueuedReply(item)}
                          aria-busy={Boolean(sendingReplyQueueIds[item.localId])}
                        >
                          {sendingReplyQueueIds[item.localId] ? <><span className="buttonSpinner" aria-hidden="true" /><span>Enviando...</span></> : "Enviar"}
                        </button>
                        <button
                          className="secondary"
                          aria-label="Editar respuesta en el editor principal"
                          onClick={() => loadQueuedReplyToComposer(item)}
                        >
                          Editar en editor
                        </button>
                        <button
                          className="secondary"
                          aria-label="Quitar respuesta de la cola"
                          onClick={() => removeQueuedReply(item.localId)}
                        >
                          Quitar
                        </button>
                      </div>
                    </article>
                  ))}
                </section>
              ) : null}

              {replyTarget ? (
                <div className="replyTarget">
                  <div>
                    <p className="replyTargetLabel">
                      Respondiendo a {replyTarget.fromMe ? "tu mensaje" : "mensaje recibido"}
                    </p>
                    <p className="replyTargetText">{replyTarget.text}</p>
                  </div>
                  <button
                    className="secondary"
                    aria-label="Cancelar respuesta"
                    onClick={() => setReplyTarget(null)}
                  >
                    Cancelar
                  </button>
                </div>
              ) : null}

              {/* Suggestions displayed above the input pill exactly like a preview card */}
              {correctedDraft ? (
                <div className="correctedPreview" style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  backdropFilter: 'blur(16px)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '16px',
                  padding: '16px',
                  marginBottom: '12px',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.2)'
                }}>
                  <div className="correctedHeader" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <p className="correctedLabel" style={{ margin: 0, fontWeight: '700', color: 'var(--accent-primary)', fontSize: '0.85rem' }}>✨ Versión sugerida por IA</p>
                    <button
                      className="iconButton"
                      onClick={() => setCorrectedDraft("")}
                      style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.9rem' }}
                      title="Descartar"
                      aria-label="Descartar versión sugerida"
                    >
                      ✕
                    </button>
                  </div>
                  <p className="correctedText" style={{ margin: '0 0 12px 0', fontSize: '0.95rem', color: '#f8fafc', lineHeight: '1.4' }}>{correctedDraft}</p>

                  <div className="correctedActions" style={{ display: 'flex', gap: '8px' }}>
                    <button
                      className="primary sendCorrectedBtn"
                      onClick={() => sendMessage(correctedDraft, "corrected")}
                      style={{ flex: 1, padding: '8px 12px', borderRadius: '10px', fontWeight: '600' }}
                    >
                      🚀 Enviar versión IA
                    </button>
                    <button
                      className="secondary useCorrectedBtn"
                      onClick={() => {
                        setDraft(correctedDraft);
                        setCorrectedDraft("");
                      }}
                      style={{ padding: '8px 12px', borderRadius: '10px' }}
                    >
                      ✏️ Usar y editar
                    </button>
                  </div>
                </div>
              ) : null}

              {/* WhatsApp-style Composer Row */}
              <div className="whatsappComposerRow" style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: '12px',
                width: '100%'
              }}>
                {/* Rounded Pill */}
                <div className={`whatsappInputPill ${correcting || correctingAndSending ? "isCorrecting" : ""}`} style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '24px',
                  padding: '4px 16px',
                  gap: '8px',
                  minHeight: '48px',
                  transition: 'all 0.3s ease',
                  boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.2)'
                }}>
                  {/* Emoji Icon inside Pill */}
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label="Emojis"
                    title="Emojis"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.currentTarget.click();
                      }
                    }}
                    style={{ fontSize: '1.25rem', color: '#94a3b8', cursor: 'pointer', userSelect: 'none' }}
                  >
                    😊
                  </span>

                  {/* Textarea inside Pill */}
                  <textarea
                    ref={draftInputRef}
                    value={draft}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDraft(val);
                      if (correctedDraft) setCorrectedDraft("");

                      if (debouncedDraftRef.current) clearTimeout(debouncedDraftRef.current);
                      if (val.trim().length > 5) {
                        debouncedDraftRef.current = setTimeout(() => {
                          // Live correction trigger could go here
                        }, 1000);
                      }
                    }}
                    onKeyDown={handleDraftKeyDown}
                    placeholder={correctedDraft ? "Escribe un mensaje... (Enter: enviar versión IA)" : "Escribe un mensaje... (Enter: enviar original | botón ✨ para mejorar)"}
                    rows={1}
                    style={{
                      flex: 1,
                      background: 'transparent',
                      border: 'none',
                      outline: 'none',
                      color: '#fff',
                      fontSize: '1rem',
                      padding: '8px 0',
                      resize: 'none',
                      minHeight: '24px',
                      maxHeight: '120px',
                      overflowY: 'auto',
                      lineHeight: '1.4'
                    }}
                    disabled={sending || correcting || correctingAndSending}
                  />

                  {/* IA Magic button inside Pill */}
                  <button
                    type="button"
                    onClick={correctDraft}
                    disabled={!draft.trim() || correcting || correctingAndSending}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: draft.trim() ? 'var(--accent-primary)' : '#64748b',
                      fontSize: '1.25rem',
                      cursor: draft.trim() ? 'pointer' : 'not-allowed',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '4px',
                      transition: 'all 0.2s ease',
                      transform: draft.trim() ? 'scale(1.15)' : 'none'
                    }}
                    title="Mejorar redacción con IA (Ver sugerencia)"
                    aria-label="Mejorar redacción con IA"
                  >
                    ✨
                  </button>
                </div>

                {/* Circular Send Button */}
                <button
                  type="button"
                  onClick={() => {
                    if (draft.trim()) {
                      sendMessage(draft, "original");
                    }
                  }}
                  disabled={!draft.trim() || sending || correcting || correctingAndSending}
                  style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '50%',
                    background: draft.trim() ? 'var(--accent-gradient)' : 'rgba(255, 255, 255, 0.05)',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: draft.trim() ? 'pointer' : 'not-allowed',
                    color: '#fff',
                    fontSize: '1.2rem',
                    boxShadow: draft.trim() ? '0 4px 12px var(--accent-glow)' : 'none',
                    transition: 'all 0.25s ease',
                    flexShrink: 0
                  }}
                  title="Enviar original"
                  aria-label="Enviar original"
                >
                  <SendIcon size={20} />
                </button>
              </div>

              {/* Progress/Activity state indicators */}
              {(sending || correcting || correctingAndSending) ? (
                <div 
                  className={`activityStateBadge ${correctingAndSending ? "processingAndSending" : correcting ? "processing" : "sending"}`}
                  style={{ marginTop: '12px' }}
                >
                  <span className="spinner" aria-hidden="true" />
                  <span>{correctingAndSending ? "✨ Mejorando y enviando..." : correcting ? "✨ Mejorando redacción..." : sendingType === 'corrected' || sendingType === 'correctedAndSending' ? "✨ Enviando versión IA..." : "📤 Enviando mensaje original..."}</span>
                </div>
              ) : null}


            </footer>
          </>
        )}
      </section>

      {showResources ? (
        <section className="modalOverlay" onClick={() => setShowResources(false)}>
          <div
            className="modalCard resourcesModal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="resourcesModalHeading"
          >
            <div className="modalHeader">
              <h3 id="resourcesModalHeading">Recursos de {selectedChat?.name || selectedChatId}</h3>
              <button className="secondary" onClick={() => setShowResources(false)} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><CloseIcon size={16} /> Cerrar</button>
            </div>

            {loadingResources ? <p className="helper">Cargando recursos...</p> : (
              <div className="resourcesContent">
                <section className="resourceSection">
                  <h4 style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><AttachmentIcon size={18} /> Media ({resources.media.length})</h4>
                  <div className="resourceGrid">
                    {resources.media.map(m => (
                      <div key={m._id || m.id || m.providerMessageId} className="resourceItem">
                        {m.mediaType === 'image' ? (
                          <img src={`${API_URL}${m.mediaUrl}`} alt="media" />
                        ) : m.mediaType === 'video' ? (
                          <video src={`${API_URL}${m.mediaUrl}`} controls />
                        ) : (
                          <div className="mediaFallback">{m.mediaType}</div>
                        )}
                        <time>{formatTime(m.timestamp)}</time>
                      </div>
                    ))}
                    {resources.media.length === 0 && <p className="helper">No hay media.</p>}
                  </div>
                </section>

                <section className="resourceSection">
                  <h4 style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><AttachmentIcon size={18} style={{ transform: 'rotate(-45deg)' }} /> Enlaces ({resources.links.length})</h4>
                  <ul className="resourceList">
                    {resources.links.map((link, i) => (
                      <li key={i}>
                        <a href={link.url} target="_blank" rel="noopener noreferrer">{link.url}</a>
                        <time>{formatTime(link.timestamp)}</time>
                      </li>
                    ))}
                    {resources.links.length === 0 && <p className="helper">No hay enlaces.</p>}
                  </ul>
                </section>

                <section className="resourceSection">
                  <h4>📱 Estados Archivados ({resources.statuses.length})</h4>
                  <div className="resourceGrid">
                    {resources.statuses.map(s => (
                      <div key={s._id || s.id || s.providerStatusMessageId} className="resourceItem">
                         {s.mediaType === 'video' ? (
                          <video src={`${API_URL}${s.mediaUrl}`} controls />
                        ) : s.mediaUrl ? (
                          <img src={`${API_URL}${s.mediaUrl}`} alt="status" />
                        ) : (
                          <div className="mediaFallback">Texto</div>
                        )}
                        <time>{formatTime(s.timestamp)}</time>
                      </div>
                    ))}
                    {resources.statuses.length === 0 && <p className="helper">No hay estados.</p>}
                  </div>
                </section>
              </div>
            )}
          </div>
        </section>
      ) : null}

      {showProfileMenu && (
        <section className="modalOverlay fullscreenSettingsOverlay" onClick={() => setShowProfileMenu(false)}>
          <div
            className="modalCard profileSettingsModal fullscreen"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="profileSettingsModalHeading"
          >
            {/* Sidebar Left */}
            <aside className="settingsSidebar">
              <div className="settingsSidebarTitle">Ajustes de Usuario</div>
              <button
                type="button"
                className={`settingsSidebarTab ${activeSettingsTab === 'profile' ? 'active' : ''}`}
                onClick={() => setActiveSettingsTab('profile')}
              >
                👤 Mi Cuenta
              </button>
              <button
                type="button"
                className={`settingsSidebarTab ${activeSettingsTab === 'ai' ? 'active' : ''}`}
                onClick={() => setActiveSettingsTab('ai')}
              >
                ✨ Asistente de IA
              </button>
              <button
                type="button"
                className={`settingsSidebarTab ${activeSettingsTab === 'shortcuts' ? 'active' : ''}`}
                onClick={() => setActiveSettingsTab('shortcuts')}
              >
                ⌨️ Atajos y Teclas
              </button>
              <div style={{ flex: 1 }} />
              <button
                type="button"
                className="logoutBtn"
                onClick={() => {
                  handleLogout();
                  setShowProfileMenu(false);
                }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#ef4444',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px'
                }}
              >
                <LogoutIcon size={14} /> Cerrar Sesión
              </button>
            </aside>

            {/* Main Content Area */}
            <div className="settingsMainWrapper">
              <div className="settingsContentPane">
                
                {/* Float Close button (Discord style Esc button) */}
                <button
                  type="button"
                  className="settingsCloseButton"
                  onClick={() => setShowProfileMenu(false)}
                  title="Cerrar (Esc)"
                  aria-label="Cerrar configuración"
                >
                  <div className="settingsCloseButtonCircle">✕</div>
                  <span className="settingsCloseButtonText">Esc</span>
                </button>

                {/* Tab Content: Profile Settings */}
                {activeSettingsTab === 'profile' && (
                  <>
                    <h2 style={{ fontSize: '1.5rem', fontWeight: '700', color: '#fff', marginBottom: '8px' }}>Mi Cuenta</h2>
                    
                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px', background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.04)' }}>
                      <div
                        style={{
                          width: '64px',
                          height: '64px',
                          borderRadius: '50%',
                          background: (userAvatarUrlInput || currentUser?.avatarUrl) ? 'transparent' : getAvatarGradient(currentUser?.avatarColor || currentUser?.id || 'me'),
                          color: '#fff',
                          fontWeight: '700',
                          border: '2.5px solid #fff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '1.3rem',
                          boxShadow: '0 0 12px rgba(255,255,255,0.25)',
                          flexShrink: 0,
                          overflow: 'hidden'
                        }}
                      >
                        {(userAvatarUrlInput || currentUser?.avatarUrl) ? (
                          <img src={userAvatarUrlInput || currentUser?.avatarUrl} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          (currentUser?.username || "Yo").slice(0, 2).toUpperCase()
                        )}
                      </div>
                      <div style={{ overflow: 'hidden' }}>
                        <div style={{ fontWeight: '700', color: '#fff', fontSize: '1.2rem' }}>{currentUser?.username || 'Usuario'}</div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textOverflow: 'ellipsis', whiteSpace: 'nowrap', overflow: 'hidden' }}>{currentUser?.email || 'sin-correo@tapchat.com'}</div>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="userAvatarUploadInput" style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem', fontWeight: '600', color: '#ccc' }}>Foto de Perfil Personalizada</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <input
                          id="userAvatarUploadInput"
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                            const file = e.target.files[0];
                            if (file) {
                              const reader = new FileReader();
                              reader.onloadend = () => {
                                setUserAvatarUrlInput(reader.result);
                              };
                              reader.readAsDataURL(file);
                            }
                          }}
                          style={{ display: 'none' }}
                        />
                        <button
                          type="button"
                          onClick={() => document.getElementById('userAvatarUploadInput').click()}
                          className="secondary small"
                        >
                          <AttachmentIcon size={14} /> Subir Foto
                        </button>
                        {(userAvatarUrlInput || currentUser?.avatarUrl) && (
                          <button
                            type="button"
                            onClick={() => setUserAvatarUrlInput("")}
                            style={{
                              padding: '6px 12px',
                              borderRadius: '8px',
                              border: 'none',
                              background: 'rgba(239, 68, 68, 0.15)',
                              color: '#ef4444',
                              fontSize: '0.8rem',
                              cursor: 'pointer',
                              fontWeight: '600',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                          >
                            <CloseIcon size={12} /> Eliminar
                          </button>
                        )}
                      </div>
                    </div>

                    <div>
                      <label htmlFor="userUsernameInput">Nombre de Usuario</label>
                      <input
                        id="userUsernameInput"
                        type="text"
                        value={userUsernameInput}
                        onChange={(e) => setUserUsernameInput(e.target.value)}
                        placeholder="Nombre de usuario"
                      />
                    </div>

                    <div>
                      <label htmlFor="userEmailInput">Correo Electrónico</label>
                      <input
                        id="userEmailInput"
                        type="email"
                        value={userEmailInput}
                        onChange={(e) => setUserEmailInput(e.target.value)}
                        placeholder="tu@correo.com"
                      />
                    </div>

                    <div>
                      <label htmlFor="userPasswordInput">Nueva Contraseña (dejar en blanco para no cambiar)</label>
                      <input
                        id="userPasswordInput"
                        type="password"
                        value={userPasswordInput}
                        onChange={(e) => setUserPasswordInput(e.target.value)}
                        placeholder="••••••••"
                      />
                    </div>

                    <div>
                      <label htmlFor="userBioInput">Estado / Biografía</label>
                      <input
                        id="userBioInput"
                        type="text"
                        value={userBioInput}
                        onChange={(e) => setUserBioInput(e.target.value)}
                        placeholder="¡Hola! Estoy usando Tapchat."
                      />
                    </div>

                    <div>
                      <label>Color de Avatar Personalizado</label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
                        {[
                          '#ff6f24',
                          '#0284c7',
                          '#16a34a',
                          '#7c3aed',
                          '#db2777',
                          '#ef4444',
                          '#0f172a',
                          '#f59e0b'
                        ].map((color) => (
                          <button
                            key={color}
                            type="button"
                            onClick={() => setUserAvatarColorInput(color)}
                            aria-label={"Seleccionar color " + color}
                            style={{
                              width: '26px',
                              height: '26px',
                              borderRadius: '50%',
                              background: color,
                              border: userAvatarColorInput === color ? '2px solid #fff' : '1px solid rgba(255,255,255,0.2)',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                              transform: userAvatarColorInput === color ? 'scale(1.2)' : 'none',
                              boxShadow: userAvatarColorInput === color ? '0 0 10px rgba(255,255,255,0.6)' : 'none',
                              padding: 0
                            }}
                          />
                        ))}
                      </div>
                      <input
                        id="userAvatarColorInput"
                        type="text"
                        value={userAvatarColorInput}
                        onChange={(e) => setUserAvatarColorInput(e.target.value)}
                        placeholder="Ej. #ff6f24, hsl(200, 70%, 40%)"
                      />
                    </div>

                     <button
                      type="button"
                      className="primary"
                      onClick={saveUserProfile}
                      style={{ width: '100%', marginTop: '10px' }}
                    >
                      Guardar Cambios de Perfil
                    </button>

                    <div style={{ marginTop: '20px', background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.04)' }}>
                      <h4 style={{ color: '#fff', fontSize: '0.95rem', fontWeight: '600', marginBottom: '8px' }}>Notificaciones del Sistema</h4>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '12px', lineHeight: '1.4' }}>
                        Permite a la PWA enviar alertas nativas del sistema operativo en segundo plano.
                      </p>
                      {("Notification" in window) ? (
                        Notification.permission === "granted" ? (
                          <span style={{ fontSize: '0.85rem', color: 'var(--success)', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            ✓ Notificaciones nativas activadas
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => {
                              Notification.requestPermission().then(permission => {
                                if (permission === "granted") {
                                  showNotice("🔔 ¡Notificaciones nativas del sistema activadas!", "success");
                                  window.location.reload();
                                } else {
                                  showNotice("No se pudieron activar las notificaciones. Por favor revise los permisos del navegador.", "error");
                                }
                              });
                            }}
                            style={{ fontSize: '0.85rem', padding: '6px 12px' }}
                          >
                            Activar Notificaciones Nativa
                          </button>
                        )
                      ) : (
                        <span style={{ fontSize: '0.85rem', color: 'var(--error)' }}>Tu sistema operativo no soporta notificaciones de escritorio.</span>
                      )}
                    </div>
                  </>
                )}

                {/* Tab Content: AI Settings */}
                {activeSettingsTab === 'ai' && (
                  <>
                    <h2 style={{ fontSize: '1.5rem', fontWeight: '700', color: '#fff', marginBottom: '4px' }}>Ajustes del Asistente de IA</h2>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '16px' }}>Configure la conexión con su servidor LM Studio local o cuenta de Cloudflare AI.</p>

                    <div>
                      <label htmlFor="aiProvider">Proveedor de IA</label>
                      <select
                        id="aiProvider"
                        value={aiConfig.provider}
                        onChange={(e) => setAiConfig((prev) => ({ ...prev, provider: e.target.value }))}
                      >
                        <option value="lmstudio">LM Studio (Local)</option>
                        <option value="cloudflare">Cloudflare AI</option>
                      </select>
                    </div>

                    <div>
                      <label htmlFor="aiEndpoint">Endpoint Activo</label>
                      <input id="aiEndpoint" value={aiConfig.aiBaseUrl} readOnly style={{ opacity: 0.6 }} />
                    </div>

                    {aiConfig.provider === "lmstudio" ? (
                      <div>
                        <label htmlFor="lmStudioBaseUrl">URL de LM Studio</label>
                        <input
                          id="lmStudioBaseUrl"
                          value={aiConfig.lmStudioBaseUrl}
                          onChange={(e) => setAiConfig((prev) => ({ ...prev, lmStudioBaseUrl: e.target.value }))}
                        />
                      </div>
                    ) : (
                      <>
                        <div>
                          <label htmlFor="cfAccountId">Cloudflare Account ID</label>
                          <input
                            id="cfAccountId"
                            value={aiConfig.cloudflareAccountId}
                            onChange={(e) => setAiConfig((prev) => ({ ...prev, cloudflareAccountId: e.target.value }))}
                          />
                        </div>

                        <div>
                          <label htmlFor="cfApiToken">Cloudflare API Token</label>
                          <div className="passwordInputWrapper" style={{ position: 'relative' }}>
                            <input
                              id="cfApiToken"
                              type={showCloudflareToken ? "text" : "password"}
                              value={aiConfig.cloudflareApiToken}
                              onChange={(e) => setAiConfig((prev) => ({ ...prev, cloudflareApiToken: e.target.value }))}
                              style={{ paddingRight: '40px' }}
                            />
                            <button
                              type="button"
                              className="passwordToggleBtn"
                              onClick={() => setShowCloudflareToken(!showCloudflareToken)}
                              aria-label={showCloudflareToken ? "Ocultar Token" : "Mostrar Token"}
                              style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', color: 'rgba(255,255,255,0.6)', minWidth: '40px', minHeight: '40px' }}
                            >
                              {showCloudflareToken ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                            </button>
                          </div>
                        </div>

                        <div>
                          <label htmlFor="cfBaseUrl">Cloudflare Base URL (Opcional)</label>
                          <input
                            id="cfBaseUrl"
                            value={aiConfig.cloudflareBaseUrl}
                            onChange={(e) => setAiConfig((prev) => ({ ...prev, cloudflareBaseUrl: e.target.value }))}
                            placeholder="https://api.cloudflare.com/client/v4/accounts/{account_id}/ai"
                          />
                        </div>
                      </>
                    )}

                    <div>
                      <label htmlFor="aiModel">Modelo de Lenguaje</label>
                      <select
                        id="aiModel"
                        value={aiConfig.modelName}
                        onChange={(e) => setAiConfig((prev) => ({ ...prev, modelName: e.target.value }))}
                        style={{ marginBottom: '8px' }}
                      >
                        <option value="">Seleccionar modelo detectado...</option>
                        {aiModels.map((model) => (
                          <option key={model} value={model}>{model}</option>
                        ))}
                      </select>
                      <input
                        id="aiModelInput"
                        value={aiConfig.modelName}
                        onChange={(e) => setAiConfig((prev) => ({ ...prev, modelName: e.target.value }))}
                        placeholder="O escriba el nombre del modelo manualmente..."
                      />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div>
                        <label htmlFor="aiTemperature">Temperatura</label>
                        <input
                          id="aiTemperature"
                          type="number"
                          step="0.1"
                          min="0"
                          max="2"
                          value={aiConfig.temperature}
                          onChange={(e) => setAiConfig((prev) => ({ ...prev, temperature: Number(e.target.value) }))}
                        />
                      </div>

                      <div>
                        <label htmlFor="aiTimeoutMs">Timeout IA (ms)</label>
                        <input
                          id="aiTimeoutMs"
                          type="number"
                          min="5000"
                          step="1000"
                          value={aiConfig.timeoutMs}
                          onChange={(e) => setAiConfig((prev) => ({ ...prev, timeoutMs: Number(e.target.value) }))}
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="aiMaxTokens">Máximo de Tokens</label>
                      <input
                        id="aiMaxTokens"
                        type="number"
                        min="32"
                        value={aiConfig.maxTokens}
                        onChange={(e) => setAiConfig((prev) => ({ ...prev, maxTokens: Number(e.target.value) }))}
                      />
                    </div>

                    <div>
                      <label htmlFor="aiSystemPrompt">Prompt de Sistema (Instrucciones)</label>
                      <textarea
                        id="aiSystemPrompt"
                        rows={3}
                        value={aiConfig.systemPrompt}
                        onChange={(e) => setAiConfig((prev) => ({ ...prev, systemPrompt: e.target.value }))}
                      />
                    </div>

                    <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                      <button
                        type="button"
                        className="secondary"
                        onClick={checkAiHealth}
                        disabled={checkingAiHealth}
                        style={{ flex: 1 }}
                      >
                        {checkingAiHealth ? <span className="spinner" /> : <><TestIcon size={14} /> Probar Conexión</>}
                      </button>
                      <button
                        type="button"
                        className="primary"
                        onClick={saveAiConfig}
                        disabled={savingAiConfig}
                        style={{ flex: 1 }}
                      >
                        {savingAiConfig ? <span className="spinner" /> : <><SaveIcon size={14} /> Guardar Ajustes</>}
                      </button>
                    </div>

                    {aiHealth && (
                      <p className={`notice ${aiHealth.ok ? "success" : "error"}`} style={{ marginTop: '12px' }}>{aiHealth.message}</p>
                    )}
                  </>
                )}

                {/* Tab Content: Shortcuts */}
                {activeSettingsTab === 'shortcuts' && (
                  <>
                    <h2 style={{ fontSize: '1.5rem', fontWeight: '700', color: '#fff', marginBottom: '8px' }}>Atajos de Teclado</h2>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '16px' }}>Use atajos rápidos para navegar eficientemente por la interfaz de Tapchat.</p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.04)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '10px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <span style={{ fontWeight: '500', color: '#eee' }}>Buscar chats / usuarios</span>
                        <kbd style={{ background: '#1e1f22', padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem', color: 'var(--accent-primary)', border: '1px solid rgba(255, 111, 36, 0.3)', fontWeight: 'bold' }}>Ctrl + K</kbd>
                      </div>
                      
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '10px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <span style={{ fontWeight: '500', color: '#eee' }}>Siguiente Chat</span>
                        <kbd style={{ background: '#1e1f22', padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem', color: '#eee', border: '1px solid rgba(255,255,255,0.1)' }}>Alt + ↓</kbd>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '10px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <span style={{ fontWeight: '500', color: '#eee' }}>Chat Anterior</span>
                        <kbd style={{ background: '#1e1f22', padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem', color: '#eee', border: '1px solid rgba(255,255,255,0.1)' }}>Alt + ↑</kbd>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: '500', color: '#eee' }}>Cerrar Modales / Ajustes</span>
                        <kbd style={{ background: '#1e1f22', padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem', color: '#eee', border: '1px solid rgba(255,255,255,0.1)' }}>Esc</kbd>
                      </div>
                    </div>
                  </>
                )}

              </div>
            </div>

          </div>
        </section>
      )}

      {showNewChatModal && (
        <section className="modalOverlay" onClick={() => setShowNewChatModal(false)}>
          <div
            className="modalCard"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="newChatModalHeading"
            style={{ maxWidth: '480px', width: '90%', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
          >
            <div className="modalHeader" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '15px', marginBottom: '15px' }}>
              <h3 id="newChatModalHeading" style={{ margin: 0, fontSize: '1.25rem', fontWeight: '700', color: '#fff' }}>Nuevo Mensaje</h3>
              <button className="secondary" onClick={() => setShowNewChatModal(false)} style={{ borderRadius: '8px', padding: '6px 12px' }}>Cerrar</button>
            </div>

            <div>
              <input
                type="text"
                value={searchUserQuery}
                aria-label="Buscar usuario"
                onChange={(e) => {
                  const val = e.target.value;
                  setSearchUserQuery(val);

                  // ⚡ Bolt Optimization: Debounce directory search
                  // Impact: Reduces API requests to /api/users/search by avoiding a call on every keystroke
                  // Measurement: Observe Network tab - requests only fire after user pauses typing for 300ms
                  if (searchUserDebounceRef.current) {
                    clearTimeout(searchUserDebounceRef.current);
                  }

                  searchUserDebounceRef.current = setTimeout(() => {
                    loadDirectoryUsers(val);
                  }, 300);
                }}
                placeholder="Buscar por usuario o correo..."
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '10px',
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(0,0,0,0.2)',
                  color: '#fff',
                  fontSize: '0.95rem',
                  outline: 'none'
                }}
              />
            </div>

            <div style={{ marginTop: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
              {searchingUsers && <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Buscando usuarios...</p>}
              
              {!searchingUsers && searchUserResults.length === 0 && (
                <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  {searchUserQuery.trim() ? "No se encontraron usuarios." : "No hay otros usuarios registrados en el servidor todavía."}
                </p>
              )}

              {searchUserResults.map((user) => (
                <div
                  key={user._id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Iniciar chat con ${user.username}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.currentTarget.click();
                    }
                  }}
                  onClick={() => {
                    const localChat = {
                      id: user._id,
                      name: user.username,
                      provider: 'local',
                      accountId: currentUser?.id || 'default',
                      timestamp: Math.floor(Date.now() / 1000),
                      unreadCount: 0,
                      isGroup: false,
                      avatarColor: user.avatarColor || 'hsl(180, 50%, 40%)',
                      avatarUrl: user.avatarUrl || ''
                    };

                    setChats(prev => {
                      if (prev.some(c => c.id === user._id)) return prev;
                      return [localChat, ...prev];
                    });

                    setSelectedChatId(user._id);
                    selectedChatIdRef.current = user._id;
                    setShowNewChatModal(false);
                    setSearchUserQuery("");
                    setSearchUserResults([]);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '10px',
                    borderRadius: '10px',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.05)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                    e.currentTarget.style.transform = 'translateY(-1px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                    e.currentTarget.style.transform = 'none';
                  }}
                >
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%',
                      background: getAvatarGradient(user.avatarColor || user._id),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: '700',
                      color: '#fff',
                      fontSize: '0.95rem'
                    }}
                  >
                    {user.username.slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: '600', color: '#fff', fontSize: '0.95rem' }}>{user.username}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textOverflow: 'ellipsis', whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: '250px' }}>
                      {user.bio || 'Sin estado'}
                    </div>
                  </div>
                  <span style={{
                    fontSize: '0.75rem',
                    padding: '3px 8px',
                    borderRadius: '20px',
                    background: 'rgba(168, 85, 247, 0.1)',
                    color: '#a855f7',
                    border: '1px solid rgba(168, 85, 247, 0.2)'
                  }}>
                    Conectar
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {activeStoryIndex !== null && storyPlayList[activeStoryIndex] && (() => {
        const story = storyPlayList[activeStoryIndex];
        return (
          <section className="modalOverlay" onClick={() => setActiveStoryIndex(null)} style={{ background: 'rgba(0,0,0,0.85)', zIndex: 1100 }}>
            <div
              className="modalCard"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              style={{
                maxWidth: '440px',
                width: '90%',
                height: '75vh',
                display: 'flex',
                flexDirection: 'column',
                borderRadius: '24px',
                overflow: 'hidden',
                background: `linear-gradient(rgba(13, 20, 24, 0.7), rgba(13, 20, 24, 0.9)), url(${story.mediaUrl || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80'})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
                border: '1px solid rgba(255,255,255,0.1)',
                position: 'relative'
              }}
            >
              {/* Progress bars at top */}
              <div style={{
                position: 'absolute',
                top: '12px',
                left: '12px',
                right: '12px',
                display: 'flex',
                gap: '6px',
                zIndex: 10
              }}>
                {storyPlayList.map((s, idx) => {
                  let width = '0%';
                  if (idx < activeStoryIndex) width = '100%';
                  else if (idx === activeStoryIndex) width = '100%';
                  return (
                    <div key={s._id} style={{
                      flex: 1,
                      height: '3px',
                      background: 'rgba(255,255,255,0.2)',
                      borderRadius: '2px',
                      overflow: 'hidden'
                    }}>
                      <div style={{
                        width: width,
                        height: '100%',
                        background: '#fff',
                        transition: idx === activeStoryIndex ? 'width 5s linear' : 'none'
                      }} />
                    </div>
                  );
                })}
              </div>

              {/* Story Header */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '25px 20px 15px',
                zIndex: 10,
                background: 'linear-gradient(to bottom, rgba(0,0,0,0.6), transparent)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '50%',
                    background: story.avatarUrl ? 'transparent' : getAvatarGradient(story.avatarColor || story.userId),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: '700',
                    color: '#fff',
                    fontSize: '0.85rem',
                    overflow: 'hidden'
                  }}>
                    {story.avatarUrl ? (
                      <img src={story.avatarUrl} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      story.username.slice(0, 2).toUpperCase()
                    )}
                  </div>
                  <div>
                    <div style={{ fontWeight: '600', color: '#fff', fontSize: '0.95rem' }}>{story.username}</div>
                    <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.7)' }}>
                      {story.distanceMeters !== undefined ? `a ${story.distanceMeters < 1000 ? `${story.distanceMeters} m` : `${(story.distanceMeters / 1000).toFixed(1)} km`}` : 'Cerca de ti'}
                    </div>
                  </div>
                </div>
                <button 
                  onClick={() => setActiveStoryIndex(null)}
                  aria-label="Cerrar historia"
                  style={{
                    background: 'rgba(255,255,255,0.1)',
                    border: 'none',
                    borderRadius: '50%',
                    width: '32px',
                    height: '32px',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    fontSize: '1rem'
                  }}
                >
                  ✕
                </button>
              </div>

              {/* Story Content Area */}
              <div style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                padding: '20px',
                zIndex: 10,
                textAlign: 'center'
              }}>
                <div style={{
                  background: 'rgba(0, 0, 0, 0.45)',
                  backdropFilter: 'blur(16px)',
                  padding: '24px',
                  borderRadius: '20px',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  maxWidth: '90%',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.3)'
                }}>
                  <p style={{
                    fontSize: '1.25rem',
                    color: '#fff',
                    margin: 0,
                    fontWeight: '500',
                    lineHeight: '1.5',
                    wordBreak: 'break-word',
                    textShadow: '0 2px 4px rgba(0,0,0,0.5)'
                  }}>
                    {story.body}
                  </p>
                </div>
              </div>

              {/* Story Footer with Like / Next controls */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '20px',
                zIndex: 10,
                background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent)'
              }}>
                <button
                  disabled={activeStoryIndex === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveStoryIndex(activeStoryIndex - 1);
                  }}
                  style={{
                    background: 'rgba(255,255,255,0.1)',
                    border: 'none',
                    borderRadius: '12px',
                    padding: '8px 16px',
                    color: '#fff',
                    cursor: activeStoryIndex === 0 ? 'not-allowed' : 'pointer',
                    fontSize: '0.85rem',
                    opacity: activeStoryIndex === 0 ? 0.3 : 1
                  }}
                >
                  ◀ Anterior
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    likePublicStatus(story._id);
                  }}
                  aria-label={story.isLiked ? "Ya no me gusta" : "Me gusta"}
                  style={{
                    background: story.isLiked ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255,255,255,0.1)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '50%',
                    width: '45px',
                    height: '45px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: story.isLiked ? '#ef4444' : '#fff',
                    cursor: 'pointer',
                    fontSize: '1.2rem',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <HeartIcon size={16} filled={story.isLiked} />
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (activeStoryIndex < storyPlayList.length - 1) {
                      setActiveStoryIndex(activeStoryIndex + 1);
                    } else {
                      setActiveStoryIndex(null);
                    }
                  }}
                  style={{
                    background: 'rgba(255,255,255,0.1)',
                    border: 'none',
                    borderRadius: '12px',
                    padding: '8px 16px',
                    color: '#fff',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: '600'
                  }}
                >
                  {activeStoryIndex === storyPlayList.length - 1 ? 'Cerrar' : 'Siguiente'}
                </button>
              </div>
            </div>
          </section>
        );
      })()}

      {showNewStatusModal && (
        <section className="modalOverlay" onClick={() => setShowNewStatusModal(false)}>
          <div
            className="modalCard"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="newStatusModalHeading"
            style={{ maxWidth: '460px', width: '90%', display: 'flex', flexDirection: 'column', gap: '15px' }}
          >
            <div className="modalHeader" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '12px' }}>
              <h3 id="newStatusModalHeading" style={{ margin: 0, fontSize: '1.25rem', fontWeight: '700', color: '#fff' }}>⭕ Publicar Nuevo Estado</h3>
              <button className="secondary" onClick={() => setShowNewStatusModal(false)} style={{ borderRadius: '8px', padding: '6px 12px' }}>Cerrar</button>
            </div>

            <div>
              <label htmlFor="personalStatusInput" style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', fontWeight: '600', color: '#ccc' }}>¿Qué estás pensando?</label>
              <textarea
                id="personalStatusInput"
                value={newStatusBody}
                onChange={(e) => setNewStatusBody(e.target.value)}
                placeholder="Escribe algo increíble que tus seguidores verán durante 24 horas..."
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '10px',
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(0,0,0,0.2)',
                  color: '#fff',
                  fontSize: '0.9rem',
                  outline: 'none',
                  resize: 'none',
                  minHeight: '80px'
                }}
                rows={3}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem', fontWeight: '600', color: '#ccc' }}>Elige un Fondo Premium</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px' }}>
                {[
                  { id: 'landscape1', color: '#6366f1', label: 'Indigo' },
                  { id: 'landscape2', color: '#ec4899', label: 'Pink' },
                  { id: 'landscape3', color: '#06b6d4', label: 'Cyan' },
                  { id: 'landscape4', color: '#f59e0b', label: 'Gold' },
                  { id: 'landscape5', color: '#10b981', label: 'Emerald' }
                ].map((theme) => (
                  <button
                    key={theme.id}
                    type="button"
                    onClick={() => setNewStatusBgTheme(theme.id)}
                    aria-label={`Fondo ${theme.label}`}
                    style={{
                      height: '45px',
                      borderRadius: '8px',
                      background: theme.color,
                      border: newStatusBgTheme === theme.id ? '2px solid #fff' : '1px solid rgba(255,255,255,0.2)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      transform: newStatusBgTheme === theme.id ? 'scale(1.08)' : 'none',
                      boxShadow: newStatusBgTheme === theme.id ? '0 0 8px rgba(255,255,255,0.5)' : 'none'
                    }}
                    title={theme.label}
                  />
                ))}
              </div>
            </div>

            {/* Dynamic Real-time Preview Card */}
            <div style={{ marginTop: '10px' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Vista Previa en Vivo:</label>
              <div style={{
                height: '110px',
                borderRadius: '12px',
                background: newStatusBgTheme === 'landscape1' ? 'url(https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=400&q=80) center/cover' :
                            newStatusBgTheme === 'landscape2' ? 'url(https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&w=400&q=80) center/cover' :
                            newStatusBgTheme === 'landscape3' ? 'url(https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=400&q=80) center/cover' :
                            newStatusBgTheme === 'landscape4' ? 'url(https://images.unsplash.com/photo-1475924156734-496f6cac6ec1?auto=format&fit=crop&w=400&q=80) center/cover' :
                            'url(https://images.unsplash.com/photo-1433832597026-488b418f2bd3?auto=format&fit=crop&w=400&q=80) center/cover',
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '15px',
                boxShadow: 'inset 0 0 50px rgba(0,0,0,0.6)',
                overflow: 'hidden'
              }}>
                <div style={{
                  position: 'absolute',
                  top: 0, left: 0, right: 0, bottom: 0,
                  background: 'rgba(0, 0, 0, 0.45)',
                  backdropFilter: 'blur(1px)'
                }} />
                <p style={{
                  fontSize: '0.8rem',
                  fontWeight: '600',
                  color: '#fff',
                  margin: 0,
                  zIndex: 1,
                  textAlign: 'center',
                  wordBreak: 'break-word',
                  textShadow: '0 2px 4px rgba(0,0,0,0.8)'
                }}>
                  {newStatusBody.trim() ? newStatusBody : "Tu mensaje de estado aparecerá aquí..."}
                </p>
              </div>
            </div>

            <button
              onClick={publishPersonalStatus}
              disabled={publishingStatus || !newStatusBody.trim()}
              style={{
                background: 'linear-gradient(135deg, #00d2ff 0%, #00bcff 100%)',
                color: '#fff',
                border: 'none',
                padding: '11px',
                borderRadius: '10px',
                fontWeight: '700',
                fontSize: '0.85rem',
                cursor: 'pointer',
                marginTop: '5px',
                boxShadow: '0 4px 12px rgba(0, 210, 255, 0.25)',
                transition: 'all 0.2s ease'
              }}
            >
              {publishingStatus ? 'Publicando...' : '🚀 Publicar Estado'}
            </button>
          </div>
        </section>
      )}

      {/* 📞 Outgoing Call Screen Overlay */}
      {activeCallState === "calling" && outgoingCallInfo && (
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
            boxShadow: '0 0 30px var(--accent-glow)',
            marginBottom: '20px',
            animation: 'pulse 2s infinite',
            overflow: 'hidden'
          }}>
            {selectedChat?.avatarUrl ? (
              <img src={selectedChat.avatarUrl} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              (outgoingCallInfo.recipientName || "U").slice(0, 2).toUpperCase()
            )}
          </div>
          <h2 style={{ fontSize: '1.75rem', fontWeight: '700', margin: '10px 0' }}>{outgoingCallInfo.recipientName}</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '40px' }}>
            Llamando...
          </p>
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
              transition: 'all 0.2s'
            }}
            title="Cancelar llamada"
          >
            🔇
          </button>
        </div>
      )}

      {/* 📞 Incoming Call Screen Overlay */}
      {activeCallState === "incoming" && incomingCallInfo && (
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
            <span style={{ fontSize: '3rem' }}>📞</span>
          </div>
          <h2 style={{ fontSize: '1.75rem', fontWeight: '700', margin: '10px 0' }}>{incomingCallInfo.hostName}</h2>
          <p style={{ color: '#00e676', fontSize: '1.05rem', fontWeight: '600', marginBottom: '40px' }}>
            Llamada de voz entrante
          </p>
          
          <div style={{ display: 'flex', gap: '30px' }}>
            {/* Accept Button */}
            <button
              onClick={() => {
                setSelectedChatId(incomingCallInfo.roomId);
                joinVoiceRoom(incomingCallInfo.roomId, true);
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
              📞
            </button>
            
            {/* Decline Button */}
            <button
              onClick={() => {
                stopRingtone();
                if (socketRef.current) {
                  socketRef.current.emit("reject-voice-call", {
                    roomId: incomingCallInfo.roomId,
                    hostId: incomingCallInfo.hostSocketId
                  });
                }
                setActiveCallState("idle");
                setIncomingCallInfo(null);
              }}
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
              ❌
            </button>
          </div>
        </div>
      )}

      {toasts.length > 0 && (
        <div className="toast-container" aria-live="polite">
          {toasts.map(t => (
            <div key={t.id} className={`toast ${t.type}`}>
              {t.text}
            </div>
          ))}
        </div>
      )}
      </main>
    </>
  );
}

export default App;
