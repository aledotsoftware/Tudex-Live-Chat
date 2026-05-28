import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import QRCode from "react-qr-code";
import {
  getCachedChats,
  getCachedMessages,
  setCachedChats,
  setCachedMessages,
  clearCache
} from "./cacheStore";

const runtimeHost =
  typeof window !== "undefined" ? window.location.hostname : "localhost";
const runtimeProtocol =
  typeof window !== "undefined" ? window.location.protocol : "http:";

// Smart API Resolution: localhost and private IPs use :3005, any other domain prepends api-
const isLocal = runtimeHost === "localhost" ||
                runtimeHost === "127.0.0.1" ||
                runtimeHost.startsWith("192.168.") ||
                runtimeHost.startsWith("10.") ||
                runtimeHost.startsWith("172.") ||
                runtimeHost.endsWith(".local");

const defaultApiUrl = isLocal
  ? `${runtimeProtocol}//${runtimeHost}:3005`
  : `https://api-${runtimeHost.replace(/^api-/, "")}`;

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

function formatTime(unixTs) {
  const value = Number(unixTs) || Math.floor(Date.now() / 1000);
  return new Date(value * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
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
  return date.toLocaleDateString([], { day: "2-digit", month: "2-digit" });
}

function formatStatusDate(unixTs) {
  const value = Number(unixTs);
  if (!value) return "";
  return new Date(value * 1000).toLocaleString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
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

function AckIcon({ status }) {
  if (status === 3) return <span className="ackDoubleBlue">✓✓</span>;
  if (status === 2) return <span className="ackDouble">✓✓</span>;
  if (status === 1) return <span className="ackSingle">✓</span>;
  if (status === 'sending') return <span className="ackClock">⏲</span>;
  return null;
}

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
  const [pwaUpdateAvailable, setPwaUpdateAvailable] = useState(null);
  const [isMobileLayout, setIsMobileLayout] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`).matches
      : false
  );

  const [chatSearch, setChatSearch] = useState("");
  const [chats, setChats] = useState([]);
  const [viewMode, setViewMode] = useState("chats");
  const [messagesByChat, setMessagesByChat] = useState({});
  const [selectedChatId, setSelectedChatId] = useState("");
  const [messages, setMessages] = useState([]);
  const [statusArchiveItems, setStatusArchiveItems] = useState([]);
  const [loadingStatusArchive, setLoadingStatusArchive] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [pendingIncomingCount, setPendingIncomingCount] = useState(0);
  const [draftsByChat, setDraftsByChat] = useState(() => { try { return JSON.parse(localStorage.getItem("tapchat_drafts") || "{}"); } catch (e) { return {}; } }); const draft = draftsByChat[selectedChatId] || ""; const setDraft = (val) => setDraftsByChat(prev => ({ ...prev, [selectedChatId]: val }));
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

  const [currentUser, setCurrentUser] = useState(null);
  const currentUserRef = useRef(currentUser);
  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);
  const [authMode, setAuthMode] = useState("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [searchUserQuery, setSearchUserQuery] = useState("");
  const [searchUserResults, setSearchUserResults] = useState([]);
  const [searchingUsers, setSearchingUsers] = useState(false);

  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [userBioInput, setUserBioInput] = useState("");
  const [userAvatarColorInput, setUserAvatarColorInput] = useState("");
  const [notifications, setNotifications] = useState([
    { id: 1, type: 'info', text: '¡Bienvenido a Tapchat! Comienza a chatear con otros usuarios buscando en la red.', time: 'Ahora' },
    { id: 2, type: 'success', text: 'Tu Asistente de IA personal está activo en el chat "AI Companion".', time: 'Hace 2 min' },
    { id: 3, type: 'warning', text: 'El servidor de IA está listo para recibir tus mensajes.', time: 'Hace 5 min' }
  ]);

  useEffect(() => {
    if (currentUser) {
      setUserBioInput(currentUser.bio || "¡Hola! Estoy usando Tapchat.");
      setUserAvatarColorInput(currentUser.avatarColor || "hsl(200, 70%, 40%)");
    }
  }, [currentUser]);

  async function saveUserProfile() {
    try {
      const res = await fetch(`${API_URL}/api/auth/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bio: userBioInput,
          avatarColor: userAvatarColorInput
        })
      });
      if (res.ok) {
        const data = await res.json();
        setCurrentUser(prev => ({
          ...prev,
          bio: data.user.bio,
          avatarColor: data.user.avatarColor
        }));
        showNotice("Perfil actualizado correctamente.", "success");
        setShowProfileMenu(false);
      } else {
        showNotice("No se pudo actualizar el perfil.", "error");
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

  const connectionLabel = useMemo(() => {
    if (!socketConnected) return "Desconectado del servidor (WebSocket)";
    if (sessionStatus === "authenticated") return "Conectado al proveedor";
    if (sessionStatus === "qr") return "Requiere vinculación (QR)";
    if (sessionStatus === "auth_failure") return "Sesión rechazada/inválida";
    if (sessionStatus === "disconnected") return "Proveedor desconectado";
    return "Sincronizando con proveedor...";
  }, [sessionStatus, socketConnected]);

  const dotClass = useMemo(() => {
    if (!socketConnected) return "bad";
    if (sessionStatus === "authenticated") return "ok";
    if (sessionStatus === "qr" || sessionStatus === "connecting") return "warning";
    return "bad";
  }, [sessionStatus, socketConnected]);

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
    if (!msg.fromMe && selectedChatIdRef.current === msg.chatId) {
      markChatAsRead(msg.chatId);
    } else if (!msg.fromMe && selectedChatIdRef.current !== msg.chatId) {
      setNotifications(prev => [
        {
          id: Date.now(),
          type: 'message',
          text: `Mensaje de ${msg.from === 'ai_assistant' ? 'AI Companion' : (msg.from || 'Usuario')}: "${msg.body.slice(0, 40)}${msg.body.length > 40 ? '...' : ''}"`,
          time: 'Ahora'
        },
        ...prev
      ]);
    }
    setChats((prev) => {
      const exists = prev.find((chat) => chat.id === msg.chatId);
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
        setCurrentUser(data.user);
        setApiAuthenticated(true);
      } else {
        setApiAuthenticated(false);
        setAuthError("Sesión inválida. Por favor, iniciá sesión.");
        localStorage.removeItem("tapchat_token");
        localStorage.removeItem("tapchat_api_key");
        clearCache().catch(() => {});
      }
    } catch (e) {
      setApiAuthenticated(false);
      setAuthError("Error de conexión al verificar credenciales.");
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
    socket.on("new_message", (payload) => {
      const eventProvider = payload?.provider || DEFAULT_PROVIDER;
      const eventAccountId = payload?.accountId || DEFAULT_ACCOUNT_ID;
      const validAccountId = currentUserRef.current?.id || DEFAULT_ACCOUNT_ID;
      if (!(eventProvider === DEFAULT_PROVIDER && eventAccountId === DEFAULT_ACCOUNT_ID) && 
          !(eventProvider === 'local' && String(eventAccountId) === String(validAccountId))) {
        return;
      }
      mergeLiveMessage(payload);
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

    return () => {
      socket.off("new_message", mergeLiveMessage);
      socket.close();
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
    setMessages(messagesByChat[selectedChatId] || []);
    fetchMessages(selectedChatId, {
      withLoader: !messagesByChat[selectedChatId],
      background: !!messagesByChat[selectedChatId]
    });
  }, [selectedChatId]);

  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      // Escape to close modals and clear context states
      if (e.key === 'Escape') {
        if (showResources) setShowResources(false);
        if (showProfileMenu) setShowProfileMenu(false);
        if (replyTarget) setReplyTarget(null);
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
  }, [filteredChats, selectedChatId]);

  useEffect(() => {
    localStorage.setItem("tapchat_drafts", JSON.stringify(draftsByChat));
  }, [draftsByChat]);

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
    if (sessionStatus !== "authenticated") return;
    fetchChats(true);
  }, [sessionStatus]);

  useEffect(() => {
    if (!selectedChatId || sessionStatus !== "authenticated") return;
    const intervalMs = syncingChat ? 3000 : 15000;
    const timer = setInterval(() => {
      fetchMessages(selectedChatId, { withLoader: false, background: true });
    }, intervalMs);
    return () => clearInterval(timer);
  }, [selectedChatId, sessionStatus, syncingChat]);

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
    if (background && navigator.onLine) setSyncingChat(true);

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
            m.status === 'sending' &&
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
      if (background) setSyncingChat(false);
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
    if (!navigator.onLine) {
       showNotice("No puedes enviar mensajes sin conexión a internet.", "error");
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
                  >
                    {showApiKey ? "🙈" : "👁️"}
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
          <span aria-hidden="true">🎁</span> Hay una nueva versión de Tapchat disponible.
          <button className="primary" onClick={() => pwaUpdateAvailable(true)}>Actualizar ahora</button>
          <button className="secondary" onClick={() => setPwaUpdateAvailable(null)}>Ignorar</button>
        </div>
      )}
      {isOffline && (
        <div className="offlineBanner" role="alert" aria-live="assertive">
          <span aria-hidden="true">⚠️</span> Estás navegando sin conexión. Mostrando versión guardada.
        </div>
      )}
      {!isOffline && !socketConnected && (
        <div className="warningBanner" role="alert" aria-live="assertive">
          <span aria-hidden="true">⚡</span> Reconectando con el servidor...
        </div>
      )}
      {!isOffline && socketConnected && sessionStatus === "disconnected" && (
        <div className="warningBanner" role="alert" aria-live="assertive">
          <span aria-hidden="true">⚠️</span> Proveedor desconectado. Revisa la conexión en tu teléfono.
        </div>
      )}
      {!isOffline && socketConnected && sessionStatus === "connecting" && (
        <div className="infoBanner" role="status" aria-live="polite">
          <span aria-hidden="true">🔄</span> Estableciendo conexión con el proveedor...
        </div>
      )}
      <main className={`waApp ${selectedChatId || viewMode === "statuses" ? "chatOpen" : ""}`}>
        <aside className="sidebar">
        <header className="sidebarHeader">
          <h2>
            {viewMode === "chats" ? "Chats" : viewMode === "statuses" ? "Estados" : "Notificaciones"}
            {viewMode === "chats" && syncingChats && (
              <span className="syncIndicator" title="Sincronizando chats..." aria-live="polite"> 🔄</span>
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
              {loadingChats ? <span className="buttonSpinner" style={{ marginRight: 0 }} aria-hidden="true" /> : "🔄"}
            </button>
            <button
              type="button"
              onClick={toggleProfileMenu}
              aria-label="Perfil y configuraciones"
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                background: getAvatarGradient(currentUser?.avatarColor || currentUser?.id || 'me'),
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
                flexShrink: 0
              }}
            >
              {(currentUser?.username || "Yo").slice(0, 2).toUpperCase()}
            </button>
          </div>
        </header>

        <div className="statusBar" role="status" aria-live="polite" aria-atomic="true">
          <span className={`dot ${dotClass}`} aria-hidden="true" />
          <span className="sr-only">{socketConnected ? "Conectado al servidor." : "Desconectado del servidor."}</span>
          <span>
            {connectionLabel} · Provider: {backendStatus.providerStatus}
          </span>
          {totalUnread > 0 ? <strong className="pendingCounter" aria-label={`${totalUnread} mensajes pendientes`}>{totalUnread} pendientes</strong> : null}
        </div>

        <div className="searchWrap" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <label htmlFor="chatSearchInput" className="sr-only">
            {viewMode === "statuses" ? "Buscar estado" : "Buscar chat"}
          </label>
          <input
            id="chatSearchInput"
            ref={searchInputRef}
            type="text"
            value={chatSearch}
            onChange={(e) => setChatSearch(e.target.value)}
            placeholder={viewMode === "statuses" ? "🔍 Buscar estado..." : "🔍 Buscar chat... (Ctrl+K)"}
            style={{ flex: 1 }}
          />
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
            >
              ➕
            </button>
          )}
        </div>

        <div className="chatList">
          {viewMode === "statuses" ? filteredStatusArchive.map((item) => (
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
          )) : filteredChats.map((chat) => (
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
                    {chat.unreadCount > 0 ? (
                      <span className="unreadBadge">{chat.unreadCount}</span>
                    ) : null}
                  </div>
                </div>
                <div className="chatMeta">
                  {chat.unreadCount
                    ? `${chat.isGroup ? "Grupo" : "Directo"} · Sin contestar`
                    : `${chat.isGroup ? "Grupo" : "Directo"} · Sin notificaciones`}
                </div>
              </div>
            </button>
          ))}
          {viewMode === "statuses" && filteredStatusArchive.length === 0 ? (
            <p className="helper">{loadingStatusArchive ? "Cargando estados..." : "No hay estados archivados."}</p>
          ) : null}
          {viewMode === "chats" && filteredChats.length === 0 ? <p className="helper">No hay chats.</p> : null}
          
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
          padding: '10px 4px',
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
              fontSize: '0.75rem',
              fontWeight: viewMode === "statuses" ? '700' : '500',
              transition: 'all 0.2s ease',
              textShadow: viewMode === "statuses" ? '0 0 10px rgba(255, 111, 36, 0.3)' : 'none'
            }}
          >
            <span style={{ fontSize: '1.2rem' }}>⭕</span>
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
              fontSize: '0.75rem',
              fontWeight: viewMode === "chats" ? '700' : '500',
              transition: 'all 0.2s ease',
              textShadow: viewMode === "chats" ? '0 0 10px rgba(255, 111, 36, 0.3)' : 'none'
            }}
          >
            <span style={{ fontSize: '1.2rem' }}>💬</span>
            Chats
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
              fontSize: '0.75rem',
              fontWeight: viewMode === "notifications" ? '700' : '500',
              transition: 'all 0.2s ease',
              textShadow: viewMode === "notifications" ? '0 0 10px rgba(255, 111, 36, 0.3)' : 'none',
              position: 'relative'
            }}
          >
            <span style={{ fontSize: '1.2rem' }}>🔔</span>
            Notificaciones
            {notifications.length > 0 && (
              <span style={{
                position: 'absolute',
                top: '2px',
                right: '25%',
                background: '#ff6f24',
                color: '#fff',
                borderRadius: '50%',
                width: '16px',
                height: '16px',
                fontSize: '10px',
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
                <button
                  type="button"
                  onClick={toggleProfileMenu}
                  aria-label="Perfil y configuraciones"
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    background: getAvatarGradient(currentUser?.avatarColor || currentUser?.id || 'me'),
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
                    flexShrink: 0
                  }}
                >
                  {(currentUser?.username || "Yo").slice(0, 2).toUpperCase()}
                </button>
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
        ) : (
          <>
            <header className="chatHeader">
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
                    {selectedChat?.id || "Sin chat seleccionado"}
                    {selectedChat?.isGroup ? " · Grupo" : ""}
                  </p>
                </div>
              </div>
              <div className="chatHeaderActions" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  className="secondary"
                  aria-label="Ver recursos del contacto"
                  onClick={fetchResources}
                  disabled={!selectedChatId}
                >
                  📂 <span className="hideOnMobile">Recursos</span>
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
                  {loadingMessages[selectedChatId] ? <span className="buttonSpinner" style={{ marginRight: 0 }} aria-hidden="true" /> : "🔄"}
                </button>
                <button
                  type="button"
                  onClick={toggleProfileMenu}
                  aria-label="Perfil y configuraciones"
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    background: getAvatarGradient(currentUser?.avatarColor || currentUser?.id || 'me'),
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
                    flexShrink: 0
                  }}
                >
                  {(currentUser?.username || "Yo").slice(0, 2).toUpperCase()}
                </button>
              </div>
            </header>

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
                    } ${msg.isRevoked ? "isRevoked" : ""}`}
                    tabIndex={!msg.fromMe && grammarInsights[msg._uiId]?.hasErrors ? 0 : undefined}
                    role={!msg.fromMe && grammarInsights[msg._uiId]?.hasErrors ? "button" : undefined}
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

              {/* Removed redundant syncingChat badge here to prevent layout shift; it's already in the header */}
              <div className={`composerInputWrapper ${correctedDraft ? "hasCorrection" : ""} ${correcting || correctingAndSending ? "isCorrecting" : ""}`}>
                {correctedDraft && <span className="composerOriginalLabel">Tu borrador original (modificarlo descartará la sugerencia IA)</span>}
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
                        // Live correction trigger could go here (if requested to auto-correct)
                      }, 1000);
                    }
                  }}
                  onKeyDown={handleDraftKeyDown}
                  placeholder={correctedDraft ? "Escribí un mensaje... (Enter: enviar versión IA | Ctrl+Enter: enviar original)" : "Escribí un mensaje... (Enter: mejorar y enviar | Ctrl+Enter: enviar original sin revisar)"}
                  rows={3}
                  aria-label="Mensaje"
                  disabled={sending || correcting || correctingAndSending}
                />
              </div>

              {correctedDraft ? (
                <div className="correctedPreview">
                  <div className="correctedHeader">
                    <p className="correctedLabel">✨ Versión sugerida por IA</p>
                    <div className="correctedHeaderActions">
                      <button
                        className="iconButton"
                        onClick={() => setCorrectedDraft("")}
                        aria-label="Descartar sugerencia"
                        title="Descartar"
                      >
                        ❌
                      </button>
                    </div>
                  </div>
                  <p className="correctedText">{correctedDraft}</p>

                  <div className="correctedActions">
                    <button
                      className="primary sendCorrectedBtn"
                      aria-label="Enviar la sugerencia de IA"
                      onClick={() => sendMessage(correctedDraft, "corrected")}
                    >
                      ✨ Enviar versión IA
                    </button>
                    <button
                      className="secondary useCorrectedBtn"
                      onClick={() => {
                        setDraft(correctedDraft);
                        setCorrectedDraft("");
                      }}
                      aria-label="Usar sugerencia en el cuadro principal para editar"
                    >
                      ✏️ <span className="hideOnMobile">Usar y editar</span>
                    </button>
                  </div>
                </div>
              ) : null}

              {(sending || correcting || correctingAndSending || syncingChat) ? (
                <div className={`activityStateBadge ${correctingAndSending ? "processingAndSending" : correcting ? "processing" : sending ? "sending" : "syncing"}`}>
                  {(syncingChat && !sending && !correcting && !correctingAndSending) ? (
                    <>
                      <span className="syncSpinner" aria-hidden="true" />
                      <span>Sincronizando chat en segundo plano...</span>
                    </>
                  ) : (
                    <>
                      <span className="spinner" aria-hidden="true" />
                      <span>{correctingAndSending ? "✨ Mejorando y enviando..." : correcting ? "✨ Mejorando redacción..." : sendingType === 'corrected' || sendingType === 'correctedAndSending' ? "✨ Enviando versión IA..." : "📤 Enviando mensaje original..."}</span>
                    </>
                  )}
                </div>
              ) : null}

              {!(sending || correcting || correctingAndSending) ? (
                <div className="composerActions">
                  {!correctedDraft ? (
                    <>
                      <button
                        className="primary"
                        aria-label="Mejorar redacción con IA y enviar"
                        onClick={correctAndSend}
                        disabled={!draft.trim()}
                      >
                        🚀 <span className="hideOnMobile">Mejorar y enviar</span>
                      </button>
                      <button
                        className="secondary"
                        aria-label="Previsualizar corrección de IA sin enviar"
                        onClick={correctDraft}
                        disabled={!draft.trim()}
                      >
                        ✨ <span className="hideOnMobile">Ver sugerencia</span>
                      </button>
                      <button
                        className="secondary plainSendBtn"
                        aria-label="Enviar mensaje original sin revisar"
                        onClick={() => sendMessage(draft, "original")}
                        disabled={!draft.trim()}
                      >
                        📤 <span className="hideOnMobile">Enviar original</span>
                      </button>
                    </>
                  ) : (
                    <button
                      className="secondary plainSendBtn"
                      aria-label="Enviar el texto original, descartando la sugerencia"
                      onClick={() => sendMessage(draft, "original")}
                      disabled={!draft.trim()}
                    >
                      📤 <span className="hideOnMobile">Descartar IA y enviar original</span>
                    </button>
                  )}
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
              <button className="secondary" onClick={() => setShowResources(false)}>Cerrar</button>
            </div>

            {loadingResources ? <p className="helper">Cargando recursos...</p> : (
              <div className="resourcesContent">
                <section className="resourceSection">
                  <h4>📁 Media ({resources.media.length})</h4>
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
                  <h4>🔗 Enlaces ({resources.links.length})</h4>
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
        <section className="modalOverlay" onClick={() => setShowProfileMenu(false)}>
          <div
            className="modalCard profileSettingsModal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="profileSettingsModalHeading"
            style={{ maxWidth: '520px', width: '90%', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
          >
            <div className="modalHeader" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '12px', marginBottom: '15px' }}>
              <h3 id="profileSettingsModalHeading" style={{ margin: 0, fontSize: '1.25rem', fontWeight: '700', color: '#fff' }}>👤 Mi Perfil y Ajustes</h3>
              <button className="secondary" onClick={() => setShowProfileMenu(false)} style={{ borderRadius: '8px', padding: '6px 12px' }}>Cerrar</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Profile Details Block */}
              <section className="profileDetailSection" style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px', background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <div
                    style={{
                      width: '60px',
                      height: '60px',
                      borderRadius: '50%',
                      background: getAvatarGradient(currentUser?.avatarColor || currentUser?.id || 'me'),
                      color: '#fff',
                      fontWeight: '700',
                      border: '2.5px solid #fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1.3rem',
                      boxShadow: '0 0 12px rgba(255,255,255,0.25)',
                      flexShrink: 0
                    }}
                  >
                    {(currentUser?.username || "Yo").slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{ fontWeight: '700', color: '#fff', fontSize: '1.1rem' }}>{currentUser?.username || 'Usuario'}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textOverflow: 'ellipsis', whiteSpace: 'nowrap', overflow: 'hidden' }}>{currentUser?.email || 'sin-correo@tapchat.com'}</div>
                  </div>
                </div>

                <div>
                  <label htmlFor="userBioInput" style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', fontWeight: '600', color: '#ccc' }}>Estado / Biografía</label>
                  <input
                    id="userBioInput"
                    type="text"
                    value={userBioInput}
                    onChange={(e) => setUserBioInput(e.target.value)}
                    placeholder="¡Hola! Estoy usando Tapchat."
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: '1px solid rgba(255,255,255,0.1)',
                      background: 'rgba(0,0,0,0.15)',
                      color: '#fff',
                      fontSize: '0.9rem',
                      outline: 'none'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', fontWeight: '600', color: '#ccc' }}>Color de Avatar Personalizado</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
                    {[
                      '#ff6f24', // Theme Sunset Orange
                      '#0284c7', // Sky Blue
                      '#16a34a', // Emerald Green
                      '#7c3aed', // Royal Violet
                      '#db2777', // Rose Pink
                      '#ef4444', // Red Glow
                      '#0f172a', // Deep Slate
                      '#f59e0b'  // Amber Glow
                    ].map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setUserAvatarColorInput(color)}
                        style={{
                          width: '26px',
                          height: '26px',
                          borderRadius: '50%',
                          background: color,
                          border: userAvatarColorInput === color ? '2px solid #fff' : '2px solid transparent',
                          cursor: 'pointer',
                          transition: 'transform 0.1s ease',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
                          padding: 0
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.15)'}
                        onMouseLeave={(e) => e.currentTarget.style.transform = 'none'}
                        title={color}
                      />
                    ))}
                  </div>
                  <input
                    id="userAvatarColorInput"
                    type="text"
                    value={userAvatarColorInput}
                    onChange={(e) => setUserAvatarColorInput(e.target.value)}
                    placeholder="Ej. #ff6f24, hsl(200, 70%, 40%) o linear-gradient(...)"
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: '1px solid rgba(255,255,255,0.1)',
                      background: 'rgba(0,0,0,0.15)',
                      color: '#fff',
                      fontSize: '0.9rem',
                      outline: 'none'
                    }}
                  />
                </div>

                <button
                  type="button"
                  className="primary"
                  onClick={saveUserProfile}
                  style={{
                    padding: '10px 15px',
                    borderRadius: '8px',
                    fontSize: '0.9rem',
                    fontWeight: '600',
                    cursor: 'pointer',
                    width: '100%'
                  }}
                >
                  Guardar Perfil
                </button>

                <div style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.05)',
                  borderRadius: '10px',
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <div style={{ fontWeight: '700', fontSize: '0.85rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>⌨️</span> Atajos de Teclado y Accesos
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowProfileMenu(false);
                      setTimeout(() => {
                        searchInputRef.current?.focus();
                      }, 100);
                    }}
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '8px',
                      padding: '8px 10px',
                      color: '#fff',
                      fontSize: '0.8rem',
                      textAlign: 'left',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      width: '100%',
                      transition: 'all 0.15s ease'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                  >
                    <span>🔍 Buscar chats o usuarios</span>
                    <kbd style={{ background: '#1f2c33', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', color: '#ff6f24', border: '1px solid rgba(255, 111, 36, 0.3)', fontWeight: 'bold' }}>Ctrl + K</kbd>
                  </button>
                  <div style={{
                    background: 'rgba(255,255,255,0.02)',
                    borderRadius: '8px',
                    padding: '8px 10px',
                    fontSize: '0.8rem',
                    color: 'var(--text-muted)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <span>🔄 Navegar entre chats</span>
                    <span style={{ display: 'flex', gap: '4px' }}>
                      <kbd style={{ background: '#1f2c33', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', color: '#ccc', border: '1px solid rgba(255,255,255,0.1)' }}>Alt</kbd>
                      <span>+</span>
                      <kbd style={{ background: '#1f2c33', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', color: '#ccc', border: '1px solid rgba(255,255,255,0.1)' }}>↑ / ↓</kbd>
                    </span>
                  </div>
                </div>
              </section>

              {/* Collapsible AI Config panel */}
              <details style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '10px', overflow: 'hidden' }}>
                <summary style={{ cursor: 'pointer', fontWeight: '700', color: '#fff', fontSize: '0.95rem', padding: '6px', userSelect: 'none', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>⚙️</span> Ajustes del Asistente de IA (LM Studio / Cloudflare)
                </summary>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '12px' }}>
                  {loadingAiConfig ? <p className="helper">Cargando configuración...</p> : null}

                  <div>
                    <label htmlFor="aiProvider" style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: '#ccc' }}>Proveedor</label>
                    <select
                      id="aiProvider"
                      value={aiConfig.provider}
                      onChange={(e) => setAiConfig((prev) => ({ ...prev, provider: e.target.value }))}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)', color: '#fff', fontSize: '0.85rem' }}
                    >
                      <option value="lmstudio">LM Studio (local)</option>
                      <option value="cloudflare">Cloudflare AI</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="aiEndpoint" style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: '#ccc' }}>Endpoint activo</label>
                    <input id="aiEndpoint" value={aiConfig.aiBaseUrl} readOnly style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.1)', color: 'var(--text-muted)', fontSize: '0.85rem' }} />
                  </div>

                  {aiConfig.provider === "lmstudio" ? (
                    <div>
                      <label htmlFor="lmStudioBaseUrl" style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: '#ccc' }}>URL LM Studio</label>
                      <input
                        id="lmStudioBaseUrl"
                        value={aiConfig.lmStudioBaseUrl}
                        spellCheck="false"
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="none"
                        onChange={(e) => setAiConfig((prev) => ({ ...prev, lmStudioBaseUrl: e.target.value }))}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)', color: '#fff', fontSize: '0.85rem' }}
                      />
                    </div>
                  ) : (
                    <>
                      <div>
                        <label htmlFor="cfAccountId" style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: '#ccc' }}>Cloudflare Account ID</label>
                        <input
                          id="cfAccountId"
                          value={aiConfig.cloudflareAccountId}
                          spellCheck="false"
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="none"
                          onChange={(e) => setAiConfig((prev) => ({ ...prev, cloudflareAccountId: e.target.value }))}
                          style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)', color: '#fff', fontSize: '0.85rem' }}
                        />
                      </div>

                      <div>
                        <label htmlFor="cfApiToken" style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: '#ccc' }}>Cloudflare API Token</label>
                        <div className="passwordInputWrapper" style={{ position: 'relative' }}>
                          <input
                            id="cfApiToken"
                            type={showCloudflareToken ? "text" : "password"}
                            value={aiConfig.cloudflareApiToken}
                            spellCheck="false"
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="none"
                            onChange={(e) => setAiConfig((prev) => ({ ...prev, cloudflareApiToken: e.target.value }))}
                            style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)', color: '#fff', fontSize: '0.85rem', paddingRight: '40px' }}
                          />
                          <button
                            type="button"
                            className="passwordToggleBtn"
                            aria-pressed={showCloudflareToken}
                            onClick={() => setShowCloudflareToken(!showCloudflareToken)}
                            aria-label={showCloudflareToken ? "Ocultar Cloudflare Token" : "Mostrar Cloudflare Token"}
                            style={{ position: 'absolute', right: '5px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1rem' }}
                          >
                            {showCloudflareToken ? "🙈" : "👁️"}
                          </button>
                        </div>
                      </div>

                      <div>
                        <label htmlFor="cfBaseUrl" style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: '#ccc' }}>Cloudflare Base URL (opcional)</label>
                        <input
                          id="cfBaseUrl"
                          value={aiConfig.cloudflareBaseUrl}
                          spellCheck="false"
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="none"
                          onChange={(e) => setAiConfig((prev) => ({ ...prev, cloudflareBaseUrl: e.target.value }))}
                          placeholder="https://api.cloudflare.com/client/v4/accounts/{account_id}/ai"
                          style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)', color: '#fff', fontSize: '0.85rem' }}
                        />
                      </div>
                    </>
                  )}

                  <div>
                    <label htmlFor="aiModel" style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: '#ccc' }}>Modelo</label>
                    <select
                      id="aiModel"
                      value={aiConfig.modelName}
                      onChange={(e) => setAiConfig((prev) => ({ ...prev, modelName: e.target.value }))}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)', color: '#fff', fontSize: '0.85rem', marginBottom: '8px' }}
                    >
                      <option value="">Seleccionar modelo...</option>
                      {aiModels.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                    <input
                      id="aiModelInput"
                      value={aiConfig.modelName}
                      spellCheck="false"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="none"
                      onChange={(e) => setAiConfig((prev) => ({ ...prev, modelName: e.target.value }))}
                      placeholder="O escribe el nombre exacto del modelo..."
                      style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)', color: '#fff', fontSize: '0.85rem' }}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div>
                      <label htmlFor="aiTemperature" style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: '#ccc' }}>Temperatura</label>
                      <input
                        id="aiTemperature"
                        type="number"
                        step="0.1"
                        min="0"
                        max="2"
                        value={aiConfig.temperature}
                        onChange={(e) => setAiConfig((prev) => ({ ...prev, temperature: Number(e.target.value) }))}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)', color: '#fff', fontSize: '0.85rem' }}
                      />
                    </div>

                    <div>
                      <label htmlFor="aiTimeoutMs" style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: '#ccc' }}>Timeout IA (ms)</label>
                      <input
                        id="aiTimeoutMs"
                        type="number"
                        min="5000"
                        step="1000"
                        value={aiConfig.timeoutMs}
                        onChange={(e) => setAiConfig((prev) => ({ ...prev, timeoutMs: Number(e.target.value) }))}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)', color: '#fff', fontSize: '0.85rem' }}
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="aiMaxTokens" style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: '#ccc' }}>Max tokens</label>
                    <input
                      id="aiMaxTokens"
                      type="number"
                      min="32"
                      max="2048"
                      step="1"
                      value={aiConfig.maxTokens}
                      onChange={(e) => setAiConfig((prev) => ({ ...prev, maxTokens: Number(e.target.value) }))}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)', color: '#fff', fontSize: '0.85rem' }}
                    />
                  </div>

                  <div>
                    <label htmlFor="aiSystemPrompt" style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: '#ccc' }}>Prompt de sistema</label>
                    <textarea
                      id="aiSystemPrompt"
                      rows={3}
                      value={aiConfig.systemPrompt}
                      onChange={(e) => setAiConfig((prev) => ({ ...prev, systemPrompt: e.target.value }))}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)', color: '#fff', fontSize: '0.85rem', resize: 'vertical' }}
                    />
                  </div>

                  <div>
                    <label htmlFor="aiUserPrompt" style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: '#ccc' }}>Prompt de usuario (usar {`{{text}}`})</label>
                    <textarea
                      id="aiUserPrompt"
                      rows={3}
                      value={aiConfig.userPromptTemplate}
                      onChange={(e) => setAiConfig((prev) => ({ ...prev, userPromptTemplate: e.target.value }))}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)', color: '#fff', fontSize: '0.85rem', resize: 'vertical' }}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: '10px', marginTop: '5px' }}>
                    <button
                      type="button"
                      className="secondary"
                      onClick={checkAiHealth}
                      disabled={checkingAiHealth}
                      aria-busy={checkingAiHealth}
                      style={{ flex: 1, padding: '8px 12px', fontSize: '0.8rem', borderRadius: '6px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      {checkingAiHealth ? <><span className="buttonSpinner" aria-hidden="true" /><span>Probando...</span></> : "🧪 Probar Conexión"}
                    </button>
                    <button
                      type="button"
                      className="primary"
                      onClick={saveAiConfig}
                      disabled={savingAiConfig}
                      aria-busy={savingAiConfig}
                      style={{ flex: 1, padding: '8px 12px', fontSize: '0.8rem', borderRadius: '6px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      {savingAiConfig ? <><span className="buttonSpinner" aria-hidden="true" /><span>Guardando...</span></> : "💾 Guardar IA"}
                    </button>
                  </div>

                  {aiHealth ? (
                    <p className={`notice ${aiHealth.ok ? "success" : "error"}`} style={{ margin: '8px 0 0 0', padding: '8px', fontSize: '0.8rem', borderRadius: '6px' }}>{aiHealth.message}</p>
                  ) : null}
                </div>
              </details>
            </div>

            {/* Logout Footer Section */}
            <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <button
                type="button"
                className="logoutBtn"
                onClick={() => {
                  handleLogout();
                  setShowProfileMenu(false);
                }}
                style={{
                  width: '100%',
                  padding: '11px',
                  borderRadius: '8px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#ef4444',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  textAlign: 'center',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
                }}
              >
                🚪 Cerrar Sesión Activa
              </button>
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
                onChange={(e) => {
                  const val = e.target.value;
                  setSearchUserQuery(val);
                  loadDirectoryUsers(val);
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
                  onClick={() => {
                    const localChat = {
                      id: user._id,
                      name: user.username,
                      provider: 'local',
                      accountId: currentUser?.id || 'default',
                      timestamp: Math.floor(Date.now() / 1000),
                      unreadCount: 0,
                      isGroup: false,
                      avatarColor: user.avatarColor || 'hsl(180, 50%, 40%)'
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
                      borderRadius: '12px',
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
