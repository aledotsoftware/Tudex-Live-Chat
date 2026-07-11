const express = require('express');

const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const mongoose = require('mongoose');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ProviderRegistry } = require('./providers/provider-registry');
const { WhatsAppAdapter } = require('./providers/whatsapp-adapter');
const { parsePositiveInt } = require('./utils');
require('dotenv').config();

function safeUrl(urlStr, defaultUrl = '', varName = 'URL') {
  if (!urlStr) return defaultUrl;
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      if (varName) console.warn(`⚠️ WARNING: Invalid protocol in ${varName} ("${urlStr}"). Must be http: or https:. Falling back to default.`);
      return defaultUrl;
    }
    return urlStr;
  } catch (e) {
    if (varName) console.warn(`⚠️ WARNING: Malformed URL in ${varName} ("${urlStr}"). Falling back to default.`);
    return defaultUrl;
  }
}

function safeNumber(val, defaultVal, min, max, varName = 'Number') {
  if (val === undefined || val === null || val === '') return defaultVal;
  const num = Number(val);
  if (!Number.isFinite(num)) {
    if (varName) console.warn(`⚠️ WARNING: Non-numeric value in ${varName} ("${val}"). Falling back to ${defaultVal}.`);
    return defaultVal;
  }
  if (min !== undefined && num < min) {
    if (varName) console.warn(`⚠️ WARNING: Value in ${varName} (${num}) is less than minimum (${min}). Clamping to ${min}.`);
    return min;
  }
  if (max !== undefined && num > max) {
    if (varName) console.warn(`⚠️ WARNING: Value in ${varName} (${num}) is greater than maximum (${max}). Clamping to ${max}.`);
    return max;
  }
  return num;
}


const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const providerStates = new Map();
function getProviderState(provider) {
  const key = String(provider || '').trim().toLowerCase();
  if (!providerStates.has(key)) {
    const stateObj = {
      lastQR: null,
      lastReadyAt: null,
      lastDisconnectReason: null
    };

    Object.defineProperty(stateObj, 'status', {
      get() {
        try {
          return resolveProviderAdapter(key).getStatus();
        } catch {
          return 'connecting';
        }
      },
      set() {},
      enumerable: true,
      configurable: true
    });

    Object.defineProperty(stateObj, 'isReady', {
      get() {
        try {
          return resolveProviderAdapter(key).isReady();
        } catch {
          return false;
        }
      },
      set() {},
      enumerable: true,
      configurable: true
    });

    providerStates.set(key, stateObj);
  }
  return providerStates.get(key);
}
let modelsCache = { provider: '', expiresAt: 0, data: [] };
const avatarCache = new Map();
const l1ChatsCache = new Map();
const l1MessagesCache = new Map();
const syncQueue = [];
const syncPendingKeys = new Set();
const syncInFlightKeys = new Set();
const syncStateMemory = new Map();
const aiMetadataCache = new Map(); // Temporary store for linking AI corrections sent via API to their message_create event

let syncWorkerRunning = false;
const AVATAR_TTL_MS = safeNumber(process.env.AVATAR_TTL_MS, 10 * 60 * 1000, 1000, 86400000, 'AVATAR_TTL_MS');
const AVATAR_FETCH_LIMIT = safeNumber(process.env.AVATAR_FETCH_LIMIT, 40, 1, 200, 'AVATAR_FETCH_LIMIT');
const AVATAR_FETCH_TIMEOUT_MS = safeNumber(process.env.AVATAR_FETCH_TIMEOUT_MS, 7000, 1000, 30000, 'AVATAR_FETCH_TIMEOUT_MS');
const CHATS_CACHE_TTL_MS = safeNumber(process.env.CHATS_CACHE_TTL_MS, 5000, 0, 3600000, 'CHATS_CACHE_TTL_MS');
const MESSAGES_CACHE_TTL_MS = safeNumber(process.env.MESSAGES_CACHE_TTL_MS, 5000, 0, 3600000, 'MESSAGES_CACHE_TTL_MS');
const DEFAULT_PROVIDER = 'whatsapp';
const DEFAULT_ACCOUNT_ID = process.env.DEFAULT_ACCOUNT_ID || 'default';
const STATUS_ARCHIVE_DIR = path.join(__dirname, 'status-archive');
const STATUS_ARCHIVE_PUBLIC_BASE = '/status-archive';
const MEDIA_ARCHIVE_DIR = path.join(__dirname, 'media-archive');
const MEDIA_ARCHIVE_PUBLIC_BASE = '/media-archive';
const STATUS_POLL_INTERVAL_MS = safeNumber(process.env.STATUS_POLL_INTERVAL_MS, 60000, 1000, 86400000, 'STATUS_POLL_INTERVAL_MS');
let aiErrorLogState = {
  signature: '',
  count: 0,
  lastAt: 0
};
let providerRegistry = null;
let statusArchivePollInFlight = false;
let lastStatusArchiveRunAt = null;
let lastStatusArchiveStats = {
  checked: 0,
  archived: 0,
  skipped: 0,
  errors: 0,
  source: 'idle'
};

// Startup validation logic
function validateStartupConfig() {
  const provider = (process.env.AI_PROVIDER || 'lmstudio').toLowerCase();

  // Validate AI config values that aren't inherently checked by safeUrl/safeNumber correctly
  if (!process.env.MODEL_NAME || process.env.MODEL_NAME.trim() === '') {
    console.warn('⚠️ WARNING: MODEL_NAME is not set or empty. Falling back to "llama-3.1-8b-instruct".');
  }

  if (provider !== 'lmstudio' && provider !== 'cloudflare') {
    console.warn(`⚠️ WARNING: Unsupported AI_PROVIDER "${process.env.AI_PROVIDER}". Falling back to "lmstudio".`);
  }

  if (provider === 'cloudflare') {
    if (!process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID.trim() === '') {
      console.warn('⚠️ WARNING: AI_PROVIDER is set to "cloudflare" but CLOUDFLARE_ACCOUNT_ID is missing or empty.');
    }
    if (!process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN.trim() === '') {
      console.warn('⚠️ WARNING: AI_PROVIDER is set to "cloudflare" but CLOUDFLARE_API_TOKEN is missing or empty.');
    }
  } else if (provider === 'lmstudio') {
    if (!process.env.LM_STUDIO_URL || process.env.LM_STUDIO_URL.trim() === '') {
      console.warn('⚠️ WARNING: AI_PROVIDER is set to "lmstudio" but LM_STUDIO_URL is missing or empty. Falling back to default.');
    }
  }

}

// Invoke validation on startup
validateStartupConfig();

// API Key authentication middleware
const API_KEY = process.env.API_KEY !== undefined ? process.env.API_KEY : '';

if (API_KEY.length > 0 && API_KEY.length < 8) {
  console.warn('⚠️ WARNING: API_KEY is too short. This is insecure for production environments. Minimum length is 8 characters.');
} else if (API_KEY.length === 0) {
  console.warn('⚠️ WARNING: API_KEY is missing or empty. Authentication is DISABLED. This is highly insecure for production environments.');
}

const authenticateUser = async (req, res, next) => {
  if (req.method === 'OPTIONS') return next();

  let token = '';
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else {
    const rawToken = req.headers['x-api-key'] || req.query.api_key;
    if (typeof rawToken === 'string') {
      token = rawToken;
    } else if (Array.isArray(rawToken) && typeof rawToken[0] === 'string') {
      token = rawToken[0];
    }
  }

  if (!token) {
    // Legacy support for API_KEY (admin credentials)
    if (API_KEY && (req.headers['x-api-key'] === API_KEY || req.query.api_key === API_KEY)) {
      let adminUser = await User.findOne({ username: 'admin' });
      if (!adminUser) {
        try {
          // 🛡️ Sentinel: Secure random password generation instead of hardcoded 'admin123'
          const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || crypto.randomBytes(16).toString('hex');
          adminUser = await User.create({
            username: 'admin',
            email: 'admin@tapchat.local',
            password: hashPassword(defaultPassword),
            avatarColor: 'hsl(200, 70%, 40%)',
            bio: 'Administrador del sistema'
          });
        } catch (e) {
          // If already exists or concurrently created
          adminUser = await User.findOne({ username: 'admin' });
        }
      }
      req.user = adminUser;
      return next();
    }
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication token is required.'
    });
  }

  try {
    // ⚡ Bolt: Using .lean() to reduce memory and CPU overhead for read-only session lookups.
    const session = await Session.findOne({ token }).populate('userId').lean();
    if (!session || session.expiresAt < new Date()) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or expired session.'
      });
    }
    req.user = session.userId;
    req.session = session;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

io.use(async (socket, next) => {
  let token = socket.handshake.auth.token;
  if (typeof token !== 'string') {
    token = '';
  }

  if (!token) {
    return next(new Error("Authentication token is required"));
  }

  if (API_KEY && token === API_KEY) {
    let adminUser = await User.findOne({ username: 'admin' });
    if (!adminUser) {
      try {
        // 🛡️ Sentinel: Secure random password generation instead of hardcoded 'admin123'
        const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || crypto.randomBytes(16).toString('hex');
        adminUser = await User.create({
          username: 'admin',
          email: 'admin@tapchat.local',
          password: hashPassword(defaultPassword),
          avatarColor: 'hsl(200, 70%, 40%)',
          bio: 'Administrador del sistema'
        });
      } catch (e) {
        adminUser = await User.findOne({ username: 'admin' });
      }
    }
    socket.userId = String(adminUser._id);
    return next();
  }

  try {
    // ⚡ Bolt: Using .lean() to reduce memory and CPU overhead for read-only session lookups.
    const session = await Session.findOne({ token }).lean();
    if (!session || session.expiresAt < new Date()) {
      return next(new Error("Invalid or expired session"));
    }
    socket.userId = String(session.userId);
    next();
  } catch (err) {
    next(new Error("Authentication failed"));
  }
});

io.on('connection', (socket) => {
  console.log(`🔌 Client connected to socket: ${socket.userId}`);
  
  if (socket.userId) {
    socket.join(socket.userId);
  }

  for (const providerName of providerRegistry ? providerRegistry.listProviders() : [DEFAULT_PROVIDER]) {
    const state = getProviderState(providerName);
    if (state.status === 'qr' && state.lastQR) {
      socket.emit('qr', { qr: state.lastQR, provider: providerName, accountId: socket.userId || DEFAULT_ACCOUNT_ID });
    } else if (state.status === 'authenticated') {
      socket.emit('ready', { status: 'authenticated', provider: providerName, accountId: socket.userId || DEFAULT_ACCOUNT_ID });
    }
  }
});

app.use(cors({
  origin: '*',
  methods: 'GET,POST,PUT,DELETE,OPTIONS',
  allowedHeaders: 'Content-Type,Authorization,X-API-Key,Accept'
}));

app.use(express.json({ limit: '1mb' }));
app.use(STATUS_ARCHIVE_PUBLIC_BASE, express.static(STATUS_ARCHIVE_DIR));
app.use(MEDIA_ARCHIVE_PUBLIC_BASE, express.static(MEDIA_ARCHIVE_DIR));

// Middleware global para proteger todas las rutas /api/ (incluyendo health y status, excepto auth de login y registro)
app.use('/api', (req, res, next) => {
  if (req.path === '/auth/login' || req.path === '/auth/register') {
    return next();
  }
  return authenticateUser(req, res, next);
});

// Root endpoint for connectivity check
app.get('/', (req, res) => {
  res.send('🚀 Tapchat Backend is running on port 3005!');
});

// Healthcheck/Auth verify endpoint
// Password hashing helper functions using native crypto module
function hashPassword(password) {
  // 🛡️ Sentinel: Enforce string type to prevent Object Type Confusion/DoS crashes in crypto module
  if (typeof password !== 'string') {
    throw new Error('Password must be a string');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedPassword) {
  if (!storedPassword || !storedPassword.includes(':')) return false;
  // 🛡️ Sentinel: Enforce string type to prevent Object Type Confusion/DoS crashes in crypto module
  if (typeof password !== 'string') return false;
  const [salt, hash] = storedPassword.split(':');
  const checkHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return hash === checkHash;
}

// User Schema
const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true, index: true },
  email: { type: String, unique: true, required: true, index: true },
  password: { type: String, required: true },
  avatarColor: { type: String },
  avatarUrl: { type: String, default: '' },
  bio: { type: String, default: '¡Hola! Estoy usando Tapchat.' },
  status: { type: String, default: 'online' },
  latitude: { type: Number },
  longitude: { type: Number },
  followedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

const User = mongoose.model('User', UserSchema);

// Public Status Schema (ephemeral 24h posts)
const PublicStatusSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  username: String,
  avatarColor: String,
  avatarUrl: { type: String, default: '' },
  body: String,
  mediaUrl: String,
  mediaType: { type: String, enum: ['text', 'image', 'video', 'audio'], default: 'text' },
  latitude: Number,
  longitude: Number,
  likesCount: { type: Number, default: 0 },
  viewsCount: { type: Number, default: 0 },
  likedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  viewedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

// Ephemeral index (TTL 24 hours = 86400 seconds)
PublicStatusSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

const PublicStatus = mongoose.model('PublicStatus', PublicStatusSchema);

// Session Schema
const SessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  token: { type: String, unique: true, required: true, index: true },
  expiresAt: { type: Date, required: true }
}, { timestamps: true });

const Session = mongoose.model('Session', SessionSchema);

// Register endpoint
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios.' });
    }

    const cleanUsername = String(username).trim().toLowerCase();
    const cleanEmail = String(email).trim().toLowerCase();

    if (cleanUsername.length < 3) {
      return res.status(400).json({ error: 'El nombre de usuario debe tener al menos 3 caracteres.' });
    }
    if (!/\S+@\S+\.\S+/.test(cleanEmail)) {
      return res.status(400).json({ error: 'Formato de correo electrónico inválido.' });
    }

    // ⚡ Bolt: Using .lean() to prevent Mongoose document instantiation for read-only existence check
    const existingUser = await User.findOne({
      $or: [{ username: cleanUsername }, { email: cleanEmail }]
    }).lean();

    if (existingUser) {
      if (existingUser.username === cleanUsername) {
        return res.status(400).json({ error: 'El nombre de usuario ya está registrado.' });
      }
      return res.status(400).json({ error: 'El correo electrónico ya está registrado.' });
    }

    const hashedPassword = hashPassword(password);
    const hue = Math.floor(Math.random() * 360);
    const avatarColor = `hsl(${hue}, 70%, 40%)`;

    // Generate random coordinates around Madrid, Spain (approx. range)
    const latitude = 40.4167 + (Math.random() - 0.5) * 0.08;
    const longitude = -3.7037 + (Math.random() - 0.5) * 0.08;

    const user = await User.create({
      username: cleanUsername,
      email: cleanEmail,
      password: hashedPassword,
      avatarColor,
      bio: '¡Hola! Estoy usando Tapchat.',
      latitude,
      longitude,
      followedUsers: []
    });

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await Session.create({
      userId: user._id,
      token,
      expiresAt
    });

    await Chat.findOneAndUpdate(
      {
        provider: 'local',
        accountId: String(user._id),
        conversationId: 'ai_assistant'
      },
      {
        provider: 'local',
        accountId: String(user._id),
        conversationId: 'ai_assistant',
        conversationKey: `local:${user._id}:ai_assistant`,
        name: 'AI Companion',
        timestamp: Math.floor(Date.now() / 1000),
        isGroup: false,
        avatarUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=100&q=80',
        unreadCount: 0
      },
      { upsert: true, new: true }
    );

    await Message.create({
      provider: 'local',
      accountId: String(user._id),
      conversationId: 'ai_assistant',
      chatId: 'ai_assistant',
      providerMessageId: `ai-welcome-${user._id}-${Date.now()}`,
      conversationKey: `local:${user._id}:ai_assistant`,
      from: 'ai_assistant',
      to: String(user._id),
      body: `¡Hola ${username}! Bienvenido a Tapchat. Soy tu compañero de inteligencia artificial. Puedes chatear conmigo en cualquier momento o usarme para revisar la ortografía de tus mensajes. ¿En qué te puedo ayudar hoy?`,
      fromMe: false,
      timestamp: Math.floor(Date.now() / 1000)
    });

    res.status(201).json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        avatarColor: user.avatarColor,
        avatarUrl: user.avatarUrl || '',
        bio: user.bio
      }
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Error interno del servidor durante el registro.' });
  }
});

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ error: 'Usuario o correo y contraseña son requeridos.' });
    }

    const cleanIdentifier = String(identifier).trim().toLowerCase();

    // ⚡ Bolt: Using .lean() to prevent Mongoose document instantiation for read-only auth check
    const user = await User.findOne({
      $or: [{ username: cleanIdentifier }, { email: cleanIdentifier }]
    }).lean();

    if (!user || !verifyPassword(password, user.password)) {
      return res.status(401).json({ error: 'Credenciales inválidas. Por favor intenta de nuevo.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await Session.create({
      userId: user._id,
      token,
      expiresAt
    });

    await Chat.findOneAndUpdate(
      {
        provider: 'local',
        accountId: String(user._id),
        conversationId: 'ai_assistant'
      },
      {
        provider: 'local',
        accountId: String(user._id),
        conversationId: 'ai_assistant',
        conversationKey: `local:${user._id}:ai_assistant`,
        name: 'AI Companion',
        timestamp: Math.floor(Date.now() / 1000),
        isGroup: false,
        unreadCount: 0
      },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        avatarColor: user.avatarColor,
        avatarUrl: user.avatarUrl || '',
        bio: user.bio
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Error interno del servidor durante el login.' });
  }
});

// Logout endpoint
app.post('/api/auth/logout', async (req, res) => {
  try {
    if (req.session) {
      await Session.deleteOne({ _id: req.session._id });
    }
    res.json({ success: true, message: 'Sesión cerrada exitosamente.' });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ error: 'Error al cerrar sesión.' });
  }
});

// Profile Update endpoint
app.put('/api/auth/profile', async (req, res) => {
  try {
    const { username, email, password, bio, avatarColor, avatarUrl } = req.body;
    
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    if (username !== undefined) {
      const cleanUsername = String(username).trim().toLowerCase();
      if (cleanUsername.length < 3) {
        return res.status(400).json({ error: 'El nombre de usuario debe tener al menos 3 caracteres.' });
      }
      if (cleanUsername !== user.username) {
        // ⚡ Bolt: Using .lean() to prevent Mongoose document instantiation for read-only existence check
        const duplicate = await User.findOne({ username: cleanUsername }).lean();
        if (duplicate) {
          return res.status(400).json({ error: 'El nombre de usuario ya está registrado por otra cuenta.' });
        }
        user.username = cleanUsername;
      }
    }

    if (email !== undefined) {
      const cleanEmail = String(email).trim().toLowerCase();
      if (!/\S+@\S+\.\S+/.test(cleanEmail)) {
        return res.status(400).json({ error: 'Formato de correo electrónico inválido.' });
      }
      if (cleanEmail !== user.email) {
        // ⚡ Bolt: Using .lean() to prevent Mongoose document instantiation for read-only existence check
        const duplicate = await User.findOne({ email: cleanEmail }).lean();
        if (duplicate) {
          return res.status(400).json({ error: 'El correo electrónico ya está registrado por otra cuenta.' });
        }
        user.email = cleanEmail;
      }
    }

    if (password !== undefined && password !== '') {
      const trimmedPass = String(password).trim();
      if (trimmedPass.length < 4) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres.' });
      }
      user.password = hashPassword(trimmedPass);
    }

    if (bio !== undefined) user.bio = String(bio).trim();
    if (avatarColor !== undefined) user.avatarColor = String(avatarColor).trim();
    if (avatarUrl !== undefined) user.avatarUrl = String(avatarUrl).trim();

    await user.save();

    res.json({
      success: true,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        avatarColor: user.avatarColor,
        avatarUrl: user.avatarUrl || '',
        bio: user.bio
      }
    });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Error al actualizar el perfil.' });
  }
});

// User Search endpoint
app.get('/api/users/search', async (req, res) => {
  try {
    const query = String(req.query.q || '').trim();
    
    let filter = {
      _id: { $ne: req.user._id },
      username: { $ne: 'admin' }
    };

    if (query) {
      // 🛡️ Sentinel: Escape user input to prevent NoSQL Regex Injection/ReDoS
      const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { username: { $regex: safeQuery, $options: 'i' } },
        { email: { $regex: safeQuery, $options: 'i' } }
      ];
    }

    // ⚡ Bolt: Using .lean() to bypass Mongoose document instantiation, returning plain JS objects
    // for significantly lower memory usage and faster read performance.
    const users = await User.find(filter)
      .select('_id username email avatarColor avatarUrl bio status')
      .limit(20)
      .lean();

    res.json(users);
  } catch (err) {
    console.error('User search error:', err);
    res.status(500).json({ error: 'Error al buscar usuarios.' });
  }
});

// Haversine Distance helper
function getHaversineDistance(lat1, lon1, lat2, lon2) {
  if (lat1 === undefined || lon1 === undefined || lat2 === undefined || lon2 === undefined) return null;
  const R = 6371e3; // metres
  const phi1 = lat1 * Math.PI/180;
  const phi2 = lat2 * Math.PI/180;
  const deltaPhi = (lat2-lat1) * Math.PI/180;
  const deltaLambda = (lon2-lon1) * Math.PI/180;

  const a = Math.sin(deltaPhi/2) * Math.sin(deltaPhi/2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda/2) * Math.sin(deltaLambda/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c; // in metres
}

// Proximity-based discovery grid
app.get('/api/users/proximity', async (req, res) => {
  try {
    const userLat = req.user.latitude || 40.4167;
    const userLng = req.user.longitude || -3.7037;

    // ⚡ Bolt: Using .lean() to bypass Mongoose document instantiation, returning plain JS objects
    // for significantly lower memory usage and faster read performance.
    const allUsers = await User.find({
      _id: { $ne: req.user._id },
      username: { $ne: 'admin' }
    }).select('_id username email avatarColor avatarUrl bio status latitude longitude').lean();

    const mapped = allUsers.map(u => {
      const lat = u.latitude || (40.4167 + (Math.random() - 0.5) * 0.08);
      const lng = u.longitude || (-3.7037 + (Math.random() - 0.5) * 0.08);
      const distance = getHaversineDistance(userLat, userLng, lat, lng);
      
      return {
        _id: u._id,
        username: u.username,
        avatarColor: u.avatarColor,
        avatarUrl: u.avatarUrl || '',
        bio: u.bio,
        status: u.status,
        distanceMeters: distance !== null ? Math.round(distance) : null,
        isFollowed: Array.isArray(req.user.followedUsers) && req.user.followedUsers.some(id => String(id) === String(u._id))
      };
    });

    // Sort closest first
    mapped.sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity));

    res.json(mapped);
  } catch (err) {
    console.error('Proximity users error:', err);
    res.status(500).json({ error: 'Error al cargar usuarios por proximidad.' });
  }
});

// Follow user
app.post('/api/users/:userId/follow', async (req, res) => {
  try {
    const targetUserId = req.params.userId;
    if (!targetUserId) return res.status(400).json({ error: 'Falta el ID del usuario.' });

    const user = await User.findById(req.user._id);
    if (!user.followedUsers.some(id => String(id) === String(targetUserId))) {
      user.followedUsers.push(targetUserId);
      await user.save();
    }
    res.json({ success: true, followedUsers: user.followedUsers });
  } catch (err) {
    res.status(500).json({ error: 'Error al seguir usuario.' });
  }
});

// Unfollow user
app.post('/api/users/:userId/unfollow', async (req, res) => {
  try {
    const targetUserId = req.params.userId;
    if (!targetUserId) return res.status(400).json({ error: 'Falta el ID del usuario.' });

    const user = await User.findById(req.user._id);
    user.followedUsers = user.followedUsers.filter(id => String(id) !== String(targetUserId));
    await user.save();
    res.json({ success: true, followedUsers: user.followedUsers });
  } catch (err) {
    res.status(500).json({ error: 'Error al dejar de seguir usuario.' });
  }
});

// Post Public status (ephemeral 24h)
app.post('/api/public-statuses', async (req, res) => {
  try {
    const { body, mediaUrl, mediaType } = req.body;
    if (!body && !mediaUrl) {
      return res.status(400).json({ error: 'El contenido o la imagen son obligatorios.' });
    }

    const publicStatus = await PublicStatus.create({
      userId: req.user._id,
      username: req.user.username,
      avatarColor: req.user.avatarColor,
      avatarUrl: req.user.avatarUrl || '',
      body: body || '',
      mediaUrl: mediaUrl || '',
      mediaType: mediaType || 'text',
      latitude: req.user.latitude || 40.4167,
      longitude: req.user.longitude || -3.7037,
      likesCount: 0,
      viewsCount: 1, // Self view initial
      likedBy: [],
      viewedBy: [req.user._id]
    });

    res.status(201).json(publicStatus);
  } catch (err) {
    console.error('Create public status error:', err);
    res.status(500).json({ error: 'Error al publicar estado.' });
  }
});

// Get Public statuses with Hybrid scoring (closeness + engagement)
app.get('/api/public-statuses', async (req, res) => {
  try {
    const userLat = req.user.latitude || 40.4167;
    const userLng = req.user.longitude || -3.7037;

    const statuses = await PublicStatus.find().lean();

    const scored = statuses.map(s => {
      const lat = s.latitude || 40.4167;
      const lng = s.longitude || -3.7037;
      const distance = getHaversineDistance(userLat, userLng, lat, lng) || 100;
      
      const engagement = (s.likesCount || 0) * 2 + (s.viewsCount || 0) + 1;
      const score = engagement / ((distance / 1000) + 1); // Hybrid proximity + engagement formula

      return {
        ...s,
        distanceMeters: Math.round(distance),
        score,
        isLiked: Array.isArray(s.likedBy) && s.likedBy.some(id => String(id) === String(req.user._id))
      };
    });

    // High scores first
    scored.sort((a, b) => b.score - a.score);

    res.json(scored);
  } catch (err) {
    console.error('Fetch public statuses error:', err);
    res.status(500).json({ error: 'Error al obtener el muro de estados.' });
  }
});

// Like public status
app.post('/api/public-statuses/:id/like', async (req, res) => {
  try {
    const status = await PublicStatus.findById(req.params.id);
    if (!status) return res.status(404).json({ error: 'Publicación no encontrada.' });

    const userIdStr = String(req.user._id);
    const hasLiked = status.likedBy.some(id => String(id) === userIdStr);

    if (hasLiked) {
      // Unlike
      status.likedBy = status.likedBy.filter(id => String(id) !== userIdStr);
      status.likesCount = Math.max(0, status.likesCount - 1);
    } else {
      // Like
      status.likedBy.push(req.user._id);
      status.likesCount += 1;
    }

    await status.save();
    res.json({ success: true, likesCount: status.likesCount, isLiked: !hasLiked });
  } catch (err) {
    res.status(500).json({ error: 'Error al dar me gusta.' });
  }
});

// View public status
app.post('/api/public-statuses/:id/view', async (req, res) => {
  try {
    const status = await PublicStatus.findById(req.params.id);
    if (!status) return res.status(404).json({ error: 'Publicación no encontrada.' });

    const userIdStr = String(req.user._id);
    const hasViewed = status.viewedBy.some(id => String(id) === userIdStr);

    if (!hasViewed) {
      status.viewedBy.push(req.user._id);
      status.viewsCount += 1;
      await status.save();
    }

    res.json({ success: true, viewsCount: status.viewsCount });
  } catch (err) {
    res.status(500).json({ error: 'Error al contar vista.' });
  }
});

// Get followed active stories
app.get('/api/followed-statuses', async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const followedIds = user.followedUsers || [];

    const statuses = await PublicStatus.find({
      userId: { $in: followedIds }
    }).sort({ createdAt: -1 }).lean();

    res.json(statuses);
  } catch (err) {
    console.error('Followed stories error:', err);
    res.status(500).json({ error: 'Error al obtener historias de seguidos.' });
  }
});

// Healthcheck/Auth verify endpoint
app.get('/api/check-auth', (req, res) => {
  res.json({
    success: true,
    message: 'Authenticated',
    user: {
      id: req.user._id,
      username: req.user.username,
      email: req.user.email,
      avatarColor: req.user.avatarColor,
      avatarUrl: req.user.avatarUrl || '',
      bio: req.user.bio
    }
  });
});

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/tapchat')
  .then(async () => {
    console.log('✅ MongoDB connected');
    await ensureCanonicalProviderFields();
  })
  .catch(err => console.error('❌ MongoDB error:', err));

const MessageSchema = new mongoose.Schema({
  id: { type: String, index: true },
  provider: { type: String, default: DEFAULT_PROVIDER, index: true, required: true },
  accountId: { type: String, default: DEFAULT_ACCOUNT_ID, index: true, required: true },
  conversationId: { type: String, index: true, required: true },
  providerMessageId: { type: String, index: true, required: true },
  conversationKey: { type: String, index: true, required: true },
  chatId: { type: String, index: true },
  from: String,
  to: String,
  body: String,
  fromMe: Boolean,
  mediaType: String,
  imageDataUrl: String,
  mediaUrl: String,
  mediaPath: String,
  mimeType: String,
  isRevoked: { type: Boolean, default: false },
  replyToMessageId: String,
  replyToText: String,
  mentionedIds: [String],
  originalText: String,
  correctedText: String,
  sentText: String,
  timestamp: Number
}, { timestamps: true });
MessageSchema.index({ provider: 1, accountId: 1, conversationId: 1, timestamp: -1 });
MessageSchema.index(
  { provider: 1, accountId: 1, providerMessageId: 1 },
  { unique: true }
);

const Message = mongoose.model('Message', MessageSchema);

const ChatSchema = new mongoose.Schema({
  id: { type: String, index: true },
  provider: { type: String, default: DEFAULT_PROVIDER, index: true, required: true },
  accountId: { type: String, default: DEFAULT_ACCOUNT_ID, index: true, required: true },
  conversationId: { type: String, index: true, required: true },
  conversationKey: { type: String, index: true, required: true },
  name: String,
  unreadCount: { type: Number, default: 0 },
  timestamp: Number,
  isGroup: Boolean,
  avatarUrl: String,
  lastSyncedAt: Date
}, { timestamps: true });
ChatSchema.index({ provider: 1, accountId: 1, timestamp: -1 });
ChatSchema.index({ provider: 1, accountId: 1, conversationId: 1 }, { unique: true });

const Chat = mongoose.model('Chat', ChatSchema);

const SyncStateSchema = new mongoose.Schema({
  provider: { type: String, default: DEFAULT_PROVIDER, index: true, required: true },
  accountId: { type: String, default: DEFAULT_ACCOUNT_ID, index: true, required: true },
  conversationId: { type: String, index: true, required: true },
  kind: { type: String, enum: ['chats', 'messages'], index: true, required: true },
  status: { type: String, enum: ['idle', 'queued', 'syncing', 'ok', 'error'], default: 'idle' },
  requestedLimit: Number,
  lastRequestedAt: Date,
  lastStartedAt: Date,
  lastFinishedAt: Date,
  lastError: String
}, { timestamps: true });
SyncStateSchema.index({ provider: 1, accountId: 1, conversationId: 1, kind: 1 }, { unique: true });
const SyncState = mongoose.model('SyncState', SyncStateSchema);

const StatusArchiveSchema = new mongoose.Schema({
  id: { type: String, index: true },
  provider: { type: String, default: DEFAULT_PROVIDER, index: true, required: true },
  accountId: { type: String, default: DEFAULT_ACCOUNT_ID, index: true, required: true },
  providerStatusMessageId: { type: String, required: true, index: true },
  statusOwnerId: { type: String, index: true },
  statusOwnerName: String,
  chatId: String,
  description: String,
  caption: String,
  mediaType: String,
  mimeType: String,
  mediaSha256: String,
  archivedFrom: { type: String, enum: ['event', 'poll'], default: 'poll' },
  fileName: String,
  filePath: String,
  imageUrl: String,
  mediaUrl: String,
  timestamp: Number,
  viewedAt: Date
}, { timestamps: true });
StatusArchiveSchema.index(
  { provider: 1, accountId: 1, providerStatusMessageId: 1 },
  { unique: true }
);
StatusArchiveSchema.index({ provider: 1, accountId: 1, timestamp: -1 });
// ⚡ Bolt: Add missing compound index for fast lookup and sorting of statuses by owner/chat without an in-memory sort
StatusArchiveSchema.index({ provider: 1, accountId: 1, statusOwnerId: 1, timestamp: -1 });

const StatusArchive = mongoose.model('StatusArchive', StatusArchiveSchema);

const AiSettingsSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  value: mongoose.Schema.Types.Mixed
}, { timestamps: true });
const AiSettings = mongoose.model('AiSettings', AiSettingsSchema);


const DEFAULT_AI_CONFIG = {
  provider: (process.env.AI_PROVIDER || 'lmstudio').toLowerCase(),
  lmStudioBaseUrl: safeUrl(process.env.LM_STUDIO_URL, 'http://localhost:1234', 'LM_STUDIO_URL')
    .replace(/\/+$/, '')
    .replace(/\/v1\/chat\/completions$/, ''),
  cloudflareAccountId: (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim(),
  cloudflareApiToken: (process.env.CLOUDFLARE_API_TOKEN || '').trim(),
  cloudflareBaseUrl: safeUrl(process.env.CLOUDFLARE_AI_BASE_URL, '', 'CLOUDFLARE_AI_BASE_URL')
    .replace(/\/+$/, ''),
  modelName: (process.env.MODEL_NAME || 'llama-3.1-8b-instruct').trim(),
  temperature: safeNumber(process.env.AI_TEMPERATURE, 0.7, 0, 2, 'AI_TEMPERATURE'),
  maxTokens: safeNumber(process.env.AI_MAX_TOKENS, 180, 1, 8192, 'AI_MAX_TOKENS'),
  systemPrompt: (process.env.AI_SYSTEM_PROMPT || 'Eres un corrector experto de mensajes de WhatsApp en español. Corrige ortografía, gramática y claridad manteniendo el tono y la intención original. No incluyas razonamiento interno ni etiquetas como <think>.').trim(),
  userPromptTemplate: (process.env.AI_USER_PROMPT_TEMPLATE || 'Corregí este texto y devolvé solo la versión final corregida, sin explicación:\n\n{{text}}').trim(),
  timeoutMs: safeNumber(process.env.AI_TIMEOUT_MS, 15000, 1000, 60000, 'AI_TIMEOUT_MS')
};

let aiConfig = { ...DEFAULT_AI_CONFIG };

async function loadAiConfig() {
  try {
    const record = await AiSettings.findOne({ key: 'ai_config' }).lean();
    if (record && record.value) {
      aiConfig = {
        ...DEFAULT_AI_CONFIG,
        ...record.value
      };
      aiConfig.provider = getAiProvider(aiConfig);
    }
  } catch (error) {
    console.error('⚠️ AI config load error:', error.message);
  }
}

async function saveAiConfig(nextConfig) {
  aiConfig = {
    ...DEFAULT_AI_CONFIG,
    ...nextConfig
  };
  aiConfig.provider = getAiProvider(aiConfig);

  await AiSettings.findOneAndUpdate(
    { key: 'ai_config' },
    { key: 'ai_config', value: aiConfig },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return aiConfig;
}

function normalizeProvider(value) {
  const normalized = String(value || DEFAULT_PROVIDER).trim().toLowerCase();
  return normalized || DEFAULT_PROVIDER;
}

function normalizeAccountId(value) {
  const normalized = String(value || DEFAULT_ACCOUNT_ID).trim().toLowerCase();
  return normalized || DEFAULT_ACCOUNT_ID;
}

function buildConversationKey(provider, accountId, conversationId) {
  return `${provider}:${accountId}:${conversationId}`;
}

function parseProviderContext(req = {}) {
  const provider = normalizeProvider(req.query?.provider || req.body?.provider || DEFAULT_PROVIDER);
  const rawAccountId = req.query?.accountId || req.body?.accountId;

  // 🛡️ Sentinel: Enforce Authorization to prevent IDOR.
  if (req.user) {
    const sessionAccountId = normalizeAccountId(req.user._id);
    if (rawAccountId) {
      const requestedAccountId = normalizeAccountId(rawAccountId);
      const defaultAccountId = normalizeAccountId(DEFAULT_ACCOUNT_ID);

      if (requestedAccountId !== sessionAccountId && requestedAccountId !== defaultAccountId) {
        // Fail securely on unauthorized access attempt
        const err = new Error('Forbidden: Unauthorized account access');
        err.status = 403;
        throw err;
      }
      return { provider, accountId: requestedAccountId };
    }
    return { provider, accountId: sessionAccountId };
  }

  // Fallback for unauthenticated/webhook routes
  return { provider, accountId: normalizeAccountId(rawAccountId || DEFAULT_ACCOUNT_ID) };
}

function nowIso() {
  return new Date().toISOString();
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

ensureDirectory(STATUS_ARCHIVE_DIR);
ensureDirectory(MEDIA_ARCHIVE_DIR);

function toPublicStatusArchiveUrl(fileName) {
  return `${STATUS_ARCHIVE_PUBLIC_BASE}/${encodeURIComponent(fileName)}`;
}

function toPublicMediaArchiveUrl(fileName) {
  return `${MEDIA_ARCHIVE_PUBLIC_BASE}/${encodeURIComponent(fileName)}`;
}

function safeStatusSegment(value, fallback = 'status') {
  return String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || fallback;
}

function extensionFromMime(mimetype = '') {
  const normalized = String(mimetype || '').toLowerCase();
  if (normalized === 'image/jpeg') return '.jpg';
  if (normalized === 'image/png') return '.png';
  if (normalized === 'image/webp') return '.webp';
  if (normalized === 'image/gif') return '.gif';
  if (normalized === 'image/heic') return '.heic';
  if (normalized === 'image/heif') return '.heif';
  const subtype = normalized.split('/')[1];
  if (!subtype) return '.bin';
  return `.${subtype.replace(/[^a-z0-9]/g, '') || 'bin'}`;
}

function hashBase64(base64Data = '') {
  return crypto.createHash('sha256').update(String(base64Data), 'base64').digest('hex');
}

function trimStatusText(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function getL1CachedValue(cacheMap, key) {
  const entry = cacheMap.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cacheMap.delete(key);
    return null;
  }
  return entry.value;
}

function setL1CachedValue(cacheMap, key, value, ttlMs) {
  cacheMap.set(key, {
    value,
    expiresAt: Date.now() + ttlMs
  });
}

function chatsCacheKey(provider, accountId) {
  return `${provider}:${accountId}:chats`;
}

function messagesCacheKey(provider, accountId, conversationId, limit) {
  return `${provider}:${accountId}:${conversationId}:limit:${limit}`;
}

function invalidateChatsCache(provider, accountId) {
  l1ChatsCache.delete(chatsCacheKey(provider, accountId));
}

function invalidateMessagesCache(provider, accountId, conversationId) {
  const prefix = `${provider}:${accountId}:${conversationId}:limit:`;
  for (const key of l1MessagesCache.keys()) {
    if (key.startsWith(prefix)) {
      l1MessagesCache.delete(key);
    }
  }
}

function getSyncTaskKey(task) {
  return `${task.kind}:${task.provider}:${task.accountId}:${task.conversationId || '__all__'}`;
}

function setSyncState(task, patch) {
  const syncKey = getSyncTaskKey(task);
  const current = syncStateMemory.get(syncKey) || {
    provider: task.provider,
    accountId: task.accountId,
    conversationId: task.conversationId || '__all__',
    kind: task.kind,
    status: 'idle',
    lastRequestedAt: null,
    lastStartedAt: null,
    lastFinishedAt: null,
    requestedLimit: task.limit || null,
    lastError: null
  };
  const next = { ...current, ...patch };
  syncStateMemory.set(syncKey, next);
  SyncState.findOneAndUpdate(
    {
      provider: next.provider,
      accountId: next.accountId,
      conversationId: next.conversationId,
      kind: next.kind
    },
    {
      provider: next.provider,
      accountId: next.accountId,
      conversationId: next.conversationId,
      kind: next.kind,
      status: next.status,
      requestedLimit: next.requestedLimit,
      lastRequestedAt: next.lastRequestedAt,
      lastStartedAt: next.lastStartedAt,
      lastFinishedAt: next.lastFinishedAt,
      lastError: next.lastError
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).catch((error) => {
    console.error('⚠️ SyncState persistence error:', error.message);
  });
  return next;
}

function getSyncStateSnapshot(provider, accountId, conversationId, kind) {
  const taskKey = `${kind}:${provider}:${accountId}:${conversationId || '__all__'}`;
  const local = syncStateMemory.get(taskKey);
  if (!local) {
    return {
      provider,
      accountId,
      conversationId: conversationId || '__all__',
      kind,
      status: 'idle',
      lastRequestedAt: null,
      lastStartedAt: null,
      lastFinishedAt: null,
      requestedLimit: null,
      lastError: null
    };
  }
  return { ...local };
}

function resolveProviderAdapter(provider) {
  if (!providerRegistry) {
    throw new Error('Provider registry not initialized');
  }
  return providerRegistry.resolve(provider);
}

async function ensureCanonicalProviderFields() {
  const chatResult = await Chat.updateMany(
    {
      $or: [
        { provider: { $exists: false } },
        { accountId: { $exists: false } },
        { conversationId: { $exists: false } },
        { conversationKey: { $exists: false } }
      ]
    },
    [
      {
        $set: {
          provider: { $ifNull: ['$provider', DEFAULT_PROVIDER] },
          accountId: { $ifNull: ['$accountId', DEFAULT_ACCOUNT_ID] },
          conversationId: { $ifNull: ['$conversationId', { $ifNull: ['$id', { $toString: '$_id' }] }] },
          conversationKey: {
            $concat: [
              { $ifNull: ['$provider', DEFAULT_PROVIDER] },
              ':',
              { $ifNull: ['$accountId', DEFAULT_ACCOUNT_ID] },
              ':',
              { $ifNull: ['$conversationId', { $ifNull: ['$id', { $toString: '$_id' }] }] }
            ]
          }
        }
      }
    ]
  );

  const messageResult = await Message.updateMany(
    {
      $or: [
        { provider: { $exists: false } },
        { accountId: { $exists: false } },
        { conversationId: { $exists: false } },
        { providerMessageId: { $exists: false } },
        { conversationKey: { $exists: false } },
        { chatId: { $exists: false } }
      ]
    },
    [
      {
        $set: {
          provider: { $ifNull: ['$provider', DEFAULT_PROVIDER] },
          accountId: { $ifNull: ['$accountId', DEFAULT_ACCOUNT_ID] },
          conversationId: { $ifNull: ['$conversationId', { $ifNull: ['$chatId', { $toString: '$_id' }] }] },
          providerMessageId: { $ifNull: ['$providerMessageId', { $ifNull: ['$id', { $toString: '$_id' }] }] },
          chatId: { $ifNull: ['$chatId', { $ifNull: ['$conversationId', { $toString: '$_id' }] }] },
          conversationKey: {
            $concat: [
              { $ifNull: ['$provider', DEFAULT_PROVIDER] },
              ':',
              { $ifNull: ['$accountId', DEFAULT_ACCOUNT_ID] },
              ':',
              { $ifNull: ['$conversationId', { $ifNull: ['$chatId', { $toString: '$_id' }] }] }
            ]
          }
        }
      }
    ]
  );

  const syncStateResult = await SyncState.updateMany(
    {
      $or: [
        { provider: { $exists: false } },
        { accountId: { $exists: false } }
      ]
    },
    [
      {
        $set: {
          provider: { $ifNull: ['$provider', DEFAULT_PROVIDER] },
          accountId: { $ifNull: ['$accountId', DEFAULT_ACCOUNT_ID] }
        }
      }
    ]
  );

  const statusArchiveResult = await StatusArchive.updateMany(
    {
      $or: [
        { provider: { $exists: false } },
        { accountId: { $exists: false } },
        { providerStatusMessageId: { $exists: false } }
      ]
    },
    [
      {
        $set: {
          provider: { $ifNull: ['$provider', DEFAULT_PROVIDER] },
          accountId: { $ifNull: ['$accountId', DEFAULT_ACCOUNT_ID] },
          providerStatusMessageId: { $ifNull: ['$providerStatusMessageId', { $ifNull: ['$id', { $toString: '$_id' }] }] }
        }
      }
    ]
  );

  if (chatResult.modifiedCount > 0 || messageResult.modifiedCount > 0 || syncStateResult.modifiedCount > 0 || statusArchiveResult.modifiedCount > 0) {
    console.log(
      `🧩 Canonical field migration complete chats=${chatResult.modifiedCount} messages=${messageResult.modifiedCount} syncStates=${syncStateResult.modifiedCount} statusArchives=${statusArchiveResult.modifiedCount}`
    );
  }
}

function buildUserPrompt(text, template) {
  const safeTemplate = template || DEFAULT_AI_CONFIG.userPromptTemplate;
  if (safeTemplate.includes('{{text}}')) {
    return safeTemplate.replaceAll('{{text}}', text);
  }
  return `${safeTemplate}\n\n${text}`;
}

function getAiProvider(config = aiConfig) {
  return String(config?.provider || 'lmstudio').toLowerCase() === 'cloudflare'
    ? 'cloudflare'
    : 'lmstudio';
}

function getLmStudioChatCompletionsUrl(config = aiConfig) {
  const base = String(config?.lmStudioBaseUrl || DEFAULT_AI_CONFIG.lmStudioBaseUrl)
    .replace(/\/+$/, '')
    .replace(/\/v1\/chat\/completions$/, '');
  return `${base}/v1/chat/completions`;
}

function getCloudflareChatCompletionsUrl(config = aiConfig) {
  const explicitBase = String(config?.cloudflareBaseUrl || '').trim().replace(/\/+$/, '');
  if (explicitBase) {
    if (/\/v1\/chat\/completions\/?$/.test(explicitBase)) return explicitBase;
    return `${explicitBase}/v1/chat/completions`;
  }

  const accountId = String(config?.cloudflareAccountId || '').trim();
  if (!accountId) return '';
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`;
}

function getAiChatCompletionsUrl(config = aiConfig) {
  return getAiProvider(config) === 'cloudflare'
    ? getCloudflareChatCompletionsUrl(config)
    : getLmStudioChatCompletionsUrl(config);
}

function getAiBaseUrl(config = aiConfig) {
  const completionUrl = getAiChatCompletionsUrl(config);
  return completionUrl.replace(/\/v1\/chat\/completions\/?$/, '');
}

function getAiRequestHeaders(config = aiConfig) {
  if (getAiProvider(config) !== 'cloudflare') return {};
  const token = String(config?.cloudflareApiToken || '').trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function isAiConfigured(config = aiConfig) {
  const provider = getAiProvider(config);
  if (provider === 'cloudflare') {
    return Boolean(getCloudflareChatCompletionsUrl(config) && String(config?.cloudflareApiToken || '').trim());
  }
  return Boolean(String(config?.lmStudioBaseUrl || '').trim());
}

function extractUpstreamAiError(error) {
  return (
    error?.response?.data?.error?.message ||
    error?.response?.data?.error ||
    error?.response?.data?.message ||
    error?.message ||
    'unknown'
  );
}

function logAiError(error, context = 'correct') {
  const status = error?.response?.status || 'n/a';
  const provider = getAiProvider(aiConfig);
  const model = String(aiConfig?.modelName || 'unknown');
  const detail = String(extractUpstreamAiError(error));
  const signature = `${context}|${provider}|${model}|${status}|${detail.slice(0, 160)}`;
  const now = Date.now();

  if (aiErrorLogState.signature === signature && now - aiErrorLogState.lastAt < 15000) {
    aiErrorLogState.count += 1;
    aiErrorLogState.lastAt = now;
    if (aiErrorLogState.count % 10 !== 0) {
      return;
    }
  } else {
    aiErrorLogState = {
      signature,
      count: 1,
      lastAt: now
    };
  }

  console.error(
    `❌ AI error [${context}] provider=${provider} model=${model} status=${status} detail=${detail}`
  );
}

function stripThinking(text) {
  return String(text || '')
    .replace(/<think[\s\S]*?<\/think>/gi, '')
    .replace(/```[\s\S]*?```/g, '')
    .trim();
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .match(/[a-záéíóúüñ0-9]+/gi) || [];
}

function lexicalOverlapRatio(source, candidate) {
  const sourceTokens = tokenize(source).filter(t => t.length > 2);
  const candSet = new Set(tokenize(candidate).filter(t => t.length > 2));
  if (sourceTokens.length === 0) return 1;
  let overlap = 0;
  for (const t of sourceTokens) {
    if (candSet.has(t)) overlap += 1;
  }
  return overlap / sourceTokens.length;
}

function normalizeCandidate(text) {
  const cleaned = stripThinking(text).replace(/^"(.*)"$/, '$1').trim();
  if (!cleaned) return '';

  const lines = cleaned
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^[-*•\d\.\)\(]+\s*/, '').trim())
    .filter(Boolean);

  if (lines.length === 0) return '';
  return lines[0];
}

function looksSuspicious(original, candidate, rawOutput) {
  if (!candidate) return true;
  if ((rawOutput || '').split(/\r?\n/).filter(Boolean).length > 3) return true;
  if (/original|corrected|versi[oó]n/i.test(rawOutput || '')) return true;
  const overlap = lexicalOverlapRatio(original, candidate);
  return overlap < 0.15;
}

function applyLightPolish(text) {
  const trimmed = String(text || '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  let result = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  if (!/[.!?…]$/.test(result)) {
    result = `${result}.`;
  }
  return result;
}

function shouldRetryWithoutSystemRole(error) {
  const msg =
    error?.response?.data?.error?.message ||
    error?.response?.data?.error ||
    error?.message ||
    '';
  return String(msg).toLowerCase().includes('only user and assistant roles are supported');
}

function shouldRetryWithoutStructuredOutput(error) {
  const msg =
    error?.response?.data?.error?.message ||
    error?.response?.data?.error ||
    error?.message ||
    '';
  const lower = String(msg).toLowerCase();
  return (
    lower.includes('response_format') ||
    lower.includes('json_schema') ||
    lower.includes('structured output')
  );
}

function extractStructuredCorrected(response) {
  const content = response?.data?.choices?.[0]?.message?.content;
  if (!content) return null;

  if (typeof content === 'object' && content.corrected) {
    return String(content.corrected);
  }

  if (typeof content !== 'string') return null;

  try {
    const parsed = JSON.parse(stripThinking(content));
    if (parsed && typeof parsed.corrected === 'string') {
      return parsed.corrected;
    }
  } catch (_error) {
    // ignore parse failure and fallback to plain text flow
  }

  return null;
}

async function requestCorrectionWithModel(text, options = {}) {
  const activeConfig = {
    ...aiConfig,
    ...options
  };
  const userPrompt = buildUserPrompt(text, options.userPromptTemplate || activeConfig.userPromptTemplate);
  const requestBase = {
    model: options.modelName || activeConfig.modelName,
    temperature: Number(options.temperature ?? activeConfig.temperature ?? 0.7),
    max_tokens: Number(options.maxTokens ?? activeConfig.maxTokens ?? 180),
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'tapchat_correction',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            corrected: { type: 'string' }
          },
          required: ['corrected']
        }
      }
    }
  };
  const requestOptions = {
    timeout: Number(options.timeoutMs ?? activeConfig.timeoutMs ?? 15000),
    headers: getAiRequestHeaders(activeConfig)
  };
  const systemPrompt = options.systemPrompt || activeConfig.systemPrompt;
  const provider = getAiProvider(activeConfig);
  const useStructuredOutput = options.structuredOutput !== false && provider !== 'cloudflare';
  const chatCompletionsUrl = getAiChatCompletionsUrl(activeConfig);

  const postCompletion = async (messages, structuredOutput) => {
    const payload = {
      model: requestBase.model,
      temperature: requestBase.temperature,
      max_tokens: requestBase.max_tokens,
      messages
    };
    if (structuredOutput) {
      payload.response_format = requestBase.response_format;
    }

    try {
      return await axios.post(chatCompletionsUrl, payload, requestOptions);
    } catch (error) {
      if (structuredOutput && shouldRetryWithoutStructuredOutput(error)) {
        return axios.post(chatCompletionsUrl, {
          ...payload,
          response_format: undefined
        }, requestOptions);
      }
      throw error;
    }
  };

  try {
    return await postCompletion([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ], useStructuredOutput);
  } catch (error) {
    if (!shouldRetryWithoutSystemRole(error)) {
      throw error;
    }

    const mergedUserPrompt = `${systemPrompt}\n\n${userPrompt}`;
    return postCompletion([{ role: "user", content: mergedUserPrompt }], useStructuredOutput);
  }
}

async function archiveMedia(media, prefix = 'media') {
  if (!media || !media.data || !media.mimetype) return null;

  const mediaSha256 = hashBase64(media.data);
  const extension = extensionFromMime(media.mimetype);
  const fileName = `${prefix}-${Date.now()}-${mediaSha256.slice(0, 16)}${extension}`;
  const filePath = path.join(MEDIA_ARCHIVE_DIR, fileName);

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, Buffer.from(media.data, 'base64'));
  }

  return {
    fileName,
    filePath,
    publicUrl: toPublicMediaArchiveUrl(fileName),
    mimeType: media.mimetype
  };
}

async function buildMediaPayload(message, provider) {
  const adapter = resolveProviderAdapter(provider);
  if (!adapter.hasMedia(message)) {
    return { mediaType: null, imageDataUrl: null, mediaUrl: null, mimeType: null };
  }

  try {
    const mediaPromise = adapter.downloadMedia(message);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Media download timeout')), 8000)
    );

    const media = await Promise.race([mediaPromise, timeoutPromise]);
    
    if (!media || !media.mimetype) {
      return { mediaType: null, imageDataUrl: null, mediaUrl: null, mimeType: null };
    }

    const archived = await archiveMedia(media, 'chat');
    const mediaType = media.mimetype.split('/')[0] || 'document';

    let payload = {
      mediaType,
      mediaUrl: archived?.publicUrl || null,
      mimeType: media.mimetype
    };

    if (mediaType === 'image') {
      payload.imageDataUrl = `data:${media.mimetype};base64,${media.data}`;
    }

    return payload;
  } catch (error) {
    const adapter = resolveProviderAdapter(normalizeProvider(provider));
    const msgCtx = adapter.extractMessageContext(message);
    console.warn(`⚠️ Media download skipped for message ${msgCtx.providerMessageId || 'unknown'}:`, error.message);
  }

  return { mediaType: null, imageDataUrl: null, mediaUrl: null, mimeType: null };
}

async function buildReplyPayload(message, provider) {
  const adapter = resolveProviderAdapter(provider);
  if (!adapter.hasQuotedMsg(message)) {
    return {
      replyToMessageId: null,
      replyToText: null
    };
  }

  try {
    const quoted = await adapter.getQuotedMessage(message);
    const quotedCtx = adapter.extractMessageContext(quoted);
    return {
      replyToMessageId: quotedCtx.providerMessageId || null,
      replyToText: quotedCtx.body || '[Mensaje citado]'
    };
  } catch (error) {
    return {
      replyToMessageId: null,
      replyToText: '[No se pudo cargar la respuesta citada]'
    };
  }
}

async function serializeMessage(message, chatId, context = {}) {
  const provider = normalizeProvider(context.provider);
  const adapter = resolveProviderAdapter(provider);
  const accountId = normalizeAccountId(context.accountId);
  const msgContext = adapter.extractMessageContext(message);
  const providerMessageId = msgContext.providerMessageId || `${msgContext.timestamp}-${Math.random()}`;
  const canonicalMessageId =
    provider === DEFAULT_PROVIDER
      ? providerMessageId
      : `${provider}:${accountId}:${providerMessageId}`;

  const [mediaPayload, replyPayload] = await Promise.all([
    buildMediaPayload(message, provider),
    buildReplyPayload(message, provider)
  ]);

  const conversationId = chatId;
  return {
    id: canonicalMessageId,
    provider,
    accountId,
    conversationId,
    providerMessageId,
    conversationKey: buildConversationKey(provider, accountId, conversationId),
    chatId,
    body: msgContext.body,
    timestamp: msgContext.timestamp,
    fromMe: msgContext.fromMe,
    from: msgContext.from,
    to: msgContext.to,
    mediaType: mediaPayload.mediaType,
    imageDataUrl: mediaPayload.imageDataUrl,
    mediaUrl: mediaPayload.mediaUrl,
    mimeType: mediaPayload.mimeType,
    replyToMessageId: replyPayload.replyToMessageId,
    replyToText: replyPayload.replyToText,
    mentionedIds: msgContext.mentionedIds
  };
}

async function upsertChat(chatData, index, context = {}) {
  try {
    const provider = normalizeProvider(context.provider);
    const adapter = resolveProviderAdapter(provider);
    const accountId = normalizeAccountId(context.accountId);
    const chatContext = adapter.extractChatContext(chatData);
    const chatId = chatContext.chatId;
    const conversationId = chatId;
    const avatarUrl = await getChatAvatar(chatData, index || 0, context.provider);
    const now = new Date();

    await Chat.findOneAndUpdate(
      { provider, accountId, conversationId },
      {
        id: chatId,
        provider,
        accountId,
        conversationId,
        conversationKey: buildConversationKey(provider, accountId, conversationId),
        name: chatContext.name,
        unreadCount: chatContext.unreadCount,
        timestamp: chatContext.timestamp,
        isGroup: chatContext.isGroup,
        avatarUrl,
        lastSyncedAt: now
      },
      { upsert: true, new: true }
    );
    invalidateChatsCache(provider, accountId);
  } catch (err) {
    const chatCtx = resolveProviderAdapter(normalizeProvider(context.provider)).extractChatContext(chatData);
    console.error(`❌ Error upserting chat ${chatCtx.chatId || 'unknown'}:`, err.message);
  }
}

async function upsertMessage(messageData, chatId, extraData = {}, context = {}) {
  try {
    const payload = await serializeMessage(messageData, chatId, context);
    const updateData = {
      ...payload,
      ...extraData
    };

    // Remove undefined values to avoid overwriting existing data with nothing
    Object.keys(updateData).forEach(key => updateData[key] === undefined && delete updateData[key]);

    await Message.findOneAndUpdate(
      {
        provider: payload.provider,
        accountId: payload.accountId,
        providerMessageId: payload.providerMessageId
      },
      { $set: updateData },
      { upsert: true, new: true }
    );
    invalidateMessagesCache(payload.provider, payload.accountId, payload.conversationId);
    invalidateChatsCache(payload.provider, payload.accountId);
    return payload;
  } catch (err) {
    const provider = normalizeProvider(context.provider);
    const adapter = resolveProviderAdapter(provider);
    const msgCtx = adapter.extractMessageContext(messageData);
    console.error(`❌ Error upserting message ${msgCtx.providerMessageId || 'unknown'}:`, err.message);
    return null;
  }
}

function normalizeStatusDescriptor(entry = {}) {
  const providerStatusMessageId =
    entry.providerStatusMessageId ||
    entry.messageId ||
    entry.id;
  const statusOwnerId =
    entry.statusOwnerId ||
    entry.contactId ||
    entry.author ||
    entry.from ||
    '';
  return {
    providerStatusMessageId: String(providerStatusMessageId || '').trim(),
    statusOwnerId: String(statusOwnerId || '').trim(),
    statusOwnerName: trimStatusText(
      entry.statusOwnerName ||
      entry.contactName ||
      entry.notifyName ||
      entry.pushname ||
      entry.shortName ||
      ''
    ),
    chatId: String(entry.chatId || 'status@broadcast').trim() || 'status@broadcast',
    description: trimStatusText(entry.description || entry.caption || entry.body || ''),
    caption: trimStatusText(entry.caption || entry.body || ''),
    mediaType: String(entry.mediaType || entry.type || '').trim().toLowerCase(),
    timestamp: Number(entry.timestamp || 0) || Math.floor(Date.now() / 1000)
  };
}

async function fetchCurrentStatusDescriptors(provider) {
  try {
    const adapter = resolveProviderAdapter(provider);
    return await adapter.fetchStatusDescriptors();
  } catch (err) {
    console.error(`⚠️ fetchStatusDescriptors error for ${provider}:`, err.message);
    return [];
  }
}

async function archiveStatusFromDescriptor(entry = {}, source = 'poll', context = {}) {
  const provider = normalizeProvider(context.provider);
  const accountId = normalizeAccountId(context.accountId);

  const normalized = normalizeStatusDescriptor(entry);
  if (!normalized.providerStatusMessageId) {
    return { archived: false, reason: 'missing_message_id' };
  }

  const existing = await StatusArchive.findOne({
    provider,
    accountId,
    providerStatusMessageId: normalized.providerStatusMessageId
  }).lean();
  if (existing) {
    return { archived: false, reason: 'duplicate' };
  }

  let statusMessage = null;
  try {
    const adapter = resolveProviderAdapter(provider);
    await adapter.markStatusRead().catch(() => {});
    statusMessage = await adapter.getMessageById(normalized.providerStatusMessageId).catch(() => null);
  } catch (err) {
    console.warn('⚠️ Adapter call failed during archiveStatusFromDescriptor:', err.message);
  }

  if (!statusMessage) {
    return { archived: false, reason: 'status_not_found' };
  }

  let mediaPayload = { fileName: null, filePath: null, publicUrl: null, mimeType: null, mediaSha256: null };

  const adapter = resolveProviderAdapter(provider);
  if (adapter.hasMedia(statusMessage)) {
    const media = await adapter.downloadMedia(statusMessage).catch(() => null);
    if (media && media.data) {
      const archived = await archiveMedia(media, 'status');
      if (archived) {
        mediaPayload = {
          ...archived,
          mediaSha256: hashBase64(media.data)
        };
      }
    }
  }

  const payload = {
    id: `${provider}:${accountId}:${normalized.providerStatusMessageId}`,
    provider,
    accountId,
    providerStatusMessageId: normalized.providerStatusMessageId,
    statusOwnerId: normalized.statusOwnerId,
    statusOwnerName: normalized.statusOwnerName || normalized.statusOwnerId,
    chatId: normalized.chatId,
    description: normalized.description || normalized.caption,
    caption: normalized.caption,
    mediaType: mediaPayload.mimeType ? mediaPayload.mimeType.split('/')[0] : 'text',
    mimeType: mediaPayload.mimeType,
    mediaSha256: mediaPayload.mediaSha256,
    archivedFrom: source === 'event' ? 'event' : 'poll',
    fileName: mediaPayload.fileName,
    filePath: mediaPayload.filePath,
    imageUrl: mediaPayload.publicUrl,
    mediaUrl: mediaPayload.publicUrl,
    timestamp: normalized.timestamp,
    viewedAt: new Date()
  };

  await StatusArchive.findOneAndUpdate(
    {
      provider: payload.provider,
      accountId: payload.accountId,
      providerStatusMessageId: payload.providerStatusMessageId
    },
    { $setOnInsert: payload },
    { upsert: true, new: true }
  );

  return { archived: true, reason: 'stored', payload };
}

async function runStatusArchiveSweep(source = 'poll', context = {}) {
  const provider = normalizeProvider(context.provider);
  const accountId = normalizeAccountId(context.accountId);

  const adapter = resolveProviderAdapter(provider);
  if (!adapter.isReady()) {
    return { checked: 0, archived: 0, skipped: 0, errors: 0, source };
  }
  if (statusArchivePollInFlight) {
    return { checked: 0, archived: 0, skipped: 1, errors: 0, source: 'busy' };
  }

  statusArchivePollInFlight = true;
  const stats = {
    checked: 0,
    archived: 0,
    skipped: 0,
    errors: 0,
    source
  };

  try {
    const descriptors = await fetchCurrentStatusDescriptors(provider);

    const ids = descriptors.map(d => normalizeStatusDescriptor(d).providerStatusMessageId).filter(Boolean);
    const existingStatuses = await StatusArchive.find({
      provider,
      accountId,
      providerStatusMessageId: { $in: ids }
    }, { providerStatusMessageId: 1 }).lean();
    const existingIds = new Set(existingStatuses.map(s => s.providerStatusMessageId));

    const results = await Promise.allSettled(
      descriptors.map(async (descriptor) => {
        stats.checked += 1;
        const normalized = normalizeStatusDescriptor(descriptor);
        if (normalized.providerStatusMessageId && existingIds.has(normalized.providerStatusMessageId)) {
          return { archived: false, reason: 'duplicate' };
        }
        return await archiveStatusFromDescriptor(descriptor, source, { provider, accountId });
      })
    );

    for (const res of results) {
      if (res.status === 'fulfilled') {
        const result = res.value;
        if (result.archived) stats.archived += 1;
        else stats.skipped += 1;
      } else {
        stats.errors += 1;
        console.error('⚠️ Status archive item error:', res.reason?.message || res.reason);
      }
    }
  } catch (error) {
    stats.errors += 1;
    console.error('⚠️ Status archive sweep error:', error.message);
  } finally {
    statusArchivePollInFlight = false;
    lastStatusArchiveRunAt = nowIso();
    lastStatusArchiveStats = stats;
  }

  return stats;
}

async function syncAllChats(context = {}) {
  const provider = normalizeProvider(context.provider);
  const accountId = normalizeAccountId(context.accountId);
  const adapter = resolveProviderAdapter(provider);
  if (!adapter.isReady()) return;
  console.log(`🔄 Starting full chat sync provider=${provider} account=${accountId}`);
  try {
    const chats = await adapter.listChats({ provider, accountId });
    if (!chats || chats.length === 0) return;

    // Concurrently upsert chats to parallelize avatar fetching and DB writes
    await Promise.allSettled(
      chats.map((chat, i) => upsertChat(chat, i, { provider, accountId }))
    );

    invalidateChatsCache(provider, accountId);
    console.log(`✅ Synced ${chats.length} chats.`);
  } catch (err) {
    console.error('❌ Error in syncAllChats:', err.message);
  }
}

async function syncChatMessages(chatId, limit = 50, context = {}) {
  const provider = normalizeProvider(context.provider);
  const accountId = normalizeAccountId(context.accountId);
  const adapter = resolveProviderAdapter(provider);
  if (!adapter.isReady()) return;

  try {
    const messages = await adapter.fetchMessages({
      provider,
      accountId,
      conversationId: chatId,
      limit
    });

    if (!messages || messages.length === 0) return;

    // Parallel serialization
    const payloads = await Promise.all(
      messages.map(m => serializeMessage(m, chatId, { provider, accountId }))
    );

    // Bulk DB operation
    const bulkOps = payloads.map(payload => {
      const updateData = { ...payload };
      Object.keys(updateData).forEach(key => updateData[key] === undefined && delete updateData[key]);

      return {
        updateOne: {
          filter: {
            provider: payload.provider,
            accountId: payload.accountId,
            providerMessageId: payload.providerMessageId
          },
          update: { $set: updateData },
          upsert: true
        }
      };
    });

    await Message.bulkWrite(bulkOps, { ordered: false });

    // Single-pass cache invalidation
    invalidateMessagesCache(provider, accountId, chatId);
    invalidateChatsCache(provider, accountId);
  } catch (err) {
    console.error(`❌ Error syncing messages for chat ${chatId}:`, err.message);
  }
}

async function executeSyncTask(task) {
  if (task.provider === 'local') {
    setSyncState(task, {
      status: 'ok',
      lastFinishedAt: nowIso(),
      lastError: null
    });
    return;
  }
  const adapter = resolveProviderAdapter(task.provider);
  if (!adapter.isReady()) {
    setSyncState(task, {
      status: 'idle',
      lastFinishedAt: nowIso(),
      lastError: null
    });
    return;
  }
  setSyncState(task, {
    status: 'syncing',
    lastStartedAt: nowIso(),
    lastError: null
  });
  try {
    if (task.kind === 'chats') {
      await syncAllChats({ provider: task.provider, accountId: task.accountId });
    } else {
      await syncChatMessages(task.conversationId, task.limit || 80, {
        provider: task.provider,
        accountId: task.accountId
      });
    }
    setSyncState(task, {
      status: 'ok',
      lastFinishedAt: nowIso(),
      lastError: null
    });
  } catch (error) {
    setSyncState(task, {
      status: 'error',
      lastFinishedAt: nowIso(),
      lastError: String(error?.message || error)
    });
  }
}

async function startSyncWorker() {
  if (syncWorkerRunning) return;
  syncWorkerRunning = true;
  try {
    while (syncQueue.length > 0) {
      const task = syncQueue.shift();
      const key = getSyncTaskKey(task);
      syncPendingKeys.delete(key);
      if (syncInFlightKeys.has(key)) {
        continue;
      }
      syncInFlightKeys.add(key);
      try {
        await executeSyncTask(task);
      } finally {
        syncInFlightKeys.delete(key);
      }
    }
  } finally {
    syncWorkerRunning = false;
  }
}

function enqueueSyncTask(taskInput) {
  const task = {
    provider: normalizeProvider(taskInput.provider),
    accountId: normalizeAccountId(taskInput.accountId),
    kind: taskInput.kind === 'messages' ? 'messages' : 'chats',
    conversationId: taskInput.kind === 'messages' ? String(taskInput.conversationId || '') : '__all__',
    limit: Number(taskInput.limit || 80),
    reason: String(taskInput.reason || '')
  };

  if (task.kind === 'messages' && !task.conversationId) {
    return;
  }

  const key = getSyncTaskKey(task);
  setSyncState(task, {
    status: 'queued',
    lastRequestedAt: nowIso(),
    requestedLimit: task.limit
  });

  if (syncPendingKeys.has(key) || syncInFlightKeys.has(key)) {
    return;
  }

  syncPendingKeys.add(key);
  syncQueue.push(task);
  setImmediate(startSyncWorker);
}


function sanitizeTextInput(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .trim();
}

async function getAvailableModels(forceRefresh = false) {
  const provider = getAiProvider(aiConfig);
  if (!forceRefresh && modelsCache.provider === provider && modelsCache.expiresAt > Date.now()) {
    return modelsCache.data;
  }

  let models = [];
  if (provider === 'cloudflare') {
    models = [String(aiConfig.modelName || '').trim()].filter(Boolean);
  } else {
    const response = await axios.get(`${getAiBaseUrl(aiConfig)}/v1/models`, {
      timeout: 7000
    });
    models = Array.isArray(response.data?.data) ? response.data.data.map((model) => model.id) : [];
  }

  modelsCache = {
    provider,
    data: models,
    expiresAt: Date.now() + 30000
  };
  return models;
}

async function toImageDataUrl(url) {
  if (!url) return null;
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: AVATAR_FETCH_TIMEOUT_MS,
      maxContentLength: 2 * 1024 * 1024
    });
    const mime = String(response.headers?.['content-type'] || '').toLowerCase();
    if (!mime.startsWith('image/')) return null;
    const base64 = Buffer.from(response.data).toString('base64');
    return `data:${mime};base64,${base64}`;
  } catch (_error) {
    return null;
  }
}

async function getChatAvatar(chat, index, provider) {
  const adapter = resolveProviderAdapter(provider);
  const chatId = adapter.extractChatContext(chat).chatId;
  if (!chatId) return null;

  const cached = avatarCache.get(chatId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.dataUrl || null;
  }

  if (index >= AVATAR_FETCH_LIMIT) {
    return cached?.dataUrl || null;
  }

  let avatarSourceUrl = null;
  try {
    const adapter = resolveProviderAdapter(provider);
    avatarSourceUrl = await adapter.getChatAvatarUrl(chat);
  } catch (err) {
    console.warn(`⚠️ Error resolving avatar for chat ${chatId}:`, err.message);
  }

  const avatarDataUrl = await toImageDataUrl(avatarSourceUrl);
  avatarCache.set(chatId, {
    dataUrl: avatarDataUrl || null,
    expiresAt: Date.now() + AVATAR_TTL_MS
  });

  return avatarDataUrl || null;
}

const chromeExecutablePath = process.env.CHROME_EXECUTABLE_PATH ||
  (process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : '/usr/bin/chromium');

// WhatsApp Client and Adapter Initialization
providerRegistry = new ProviderRegistry();
const waAdapter = new WhatsAppAdapter({
  dataPath: './.wwebjs_auth',
  chromeExecutablePath: chromeExecutablePath
});
providerRegistry.register(waAdapter);

async function handleMessageRevoke(after, before, context = {}) {
  const provider = normalizeProvider(context.provider);
  const adapter = resolveProviderAdapter(provider);
  const accountId = normalizeAccountId(context.accountId);
  const msgId = adapter.extractMessageContext(before || after).providerMessageId;
  if (!msgId) return;

  console.log(`🗑️ Message revoked: ${msgId}`);

  try {
    const updated = await Message.findOneAndUpdate(
      {
        provider,
        accountId,
        providerMessageId: msgId
      },
      { $set: { isRevoked: true } },
      { new: true }
    );

    if (updated) {
      io.emit('message_updated', { ...updated, provider: context.provider, accountId: context.accountId });
    }
  } catch (err) {
    console.error(`❌ Error handling revoke for ${msgId}:`, err.message);
  }
}

function bindProviderEvents(adapter, accountId) {
  const providerName = adapter.getProviderName();

  adapter.on('qr', (qr) => {
    console.log('📡 QR Received - Emitting to frontend...');
    const state = getProviderState(providerName);
    state.lastQR = qr;
    state.lastDisconnectReason = null;
    io.emit('qr', { qr, provider: providerName, accountId });
  });

  adapter.on('ready', () => {
    console.log(`✅ Client is ready for provider: ${providerName}!`);
    const state = getProviderState(providerName);
    state.lastQR = null;
    state.lastReadyAt = new Date().toISOString();
    state.lastDisconnectReason = null;
    io.emit('ready', { status: 'authenticated', provider: providerName, accountId });

    // Start background sync (async queue, read-path safe)
    enqueueSyncTask({
      kind: 'chats',
      provider: providerName,
      accountId: accountId,
      reason: 'provider_ready'
    });
    runStatusArchiveSweep('poll', { provider: providerName, accountId }).catch((error) => {
      console.error('⚠️ Initial status archive sweep failed:', error.message);
    });
  });

  adapter.on('authenticated', () => {
    console.log(`AUTHENTICATED for provider: ${providerName}`);
  });

  adapter.on('auth_failure', msg => {
    console.error(`AUTHENTICATION FAILURE for provider: ${providerName}`, msg);
    io.emit('auth_failure', { msg, provider: providerName, accountId });
  });

  adapter.on('disconnected', (reason) => {
    console.log(`Client was logged out for provider: ${providerName}`, reason);
    const state = getProviderState(providerName);
    state.lastDisconnectReason = String(reason || 'unknown');
    io.emit('disconnected', { reason, provider: providerName, accountId });
  });

  adapter.on('message_revoke_everyone', async (after, before) => handleMessageRevoke(after, before, { provider: providerName, accountId }));
  adapter.on('message_revoke_me', async (after, before) => handleMessageRevoke(after, before, { provider: providerName, accountId }));

  // Message handling (incoming and outgoing)
  adapter.on('message_create', async (msg) => {
    // Auto-ver estados (Stories) para que no aparezcan como pendientes en el teléfono
    if (adapter.isStatusMessage(msg)) {
      try {
        // Marcamos el chat de estados como visto de forma directa y rápida
        await adapter.markStatusRead();

        const descriptor = adapter.extractStatusDescriptor(msg);
        await archiveStatusFromDescriptor(descriptor, 'event', { provider: providerName, accountId });
        console.log(`👁️ Status auto-visto [${descriptor.mediaType}] de: ${descriptor.statusOwnerId}`);
      } catch (e) {
        console.error('⚠️ Error al auto-ver status:', e.message);
      }
      return; // No procesamos los estados como mensajes normales en la UI
    }

    let chatId = adapter.getChatIdFromMessage(msg);

    // Check if this message has associated AI metadata
    let extraData = {};
    if (adapter.extractMessageContext(msg).fromMe) {
      const bodyMatch = adapter.extractMessageContext(msg).body.trim();
      const matchKey = buildConversationKey(providerName, accountId, chatId) + ':' + bodyMatch;
      const cachedMeta = aiMetadataCache.get(matchKey);
      if (cachedMeta) {
         extraData = {
           originalText: cachedMeta.originalText,
           correctedText: cachedMeta.correctedText,
           sentText: cachedMeta.sentText
         };
         aiMetadataCache.delete(matchKey);
      }
    }

    // Cache and Emit
    const payload = await upsertMessage(
      msg,
      chatId,
      extraData,
      { provider: providerName, accountId }
    );
    if (payload) {
      io.emit('new_message', { ...payload, provider: providerName, accountId });
    }

    // Also update chat timestamp/unread in cache
    try {
      const chat = await adapter.getChatByMessage(msg);
      if (chat) {
        await upsertChat(chat, 0, { provider: providerName, accountId });
      }
    } catch (err) {
      console.error('⚠️ Failed to update chat on message_create:', err.message);
    }
  });
}

// Bind events and initialize all registered providers
for (const providerName of providerRegistry.listProviders()) {
  const adapter = providerRegistry.resolve(providerName);
  bindProviderEvents(adapter, DEFAULT_ACCOUNT_ID);
}

providerRegistry.initializeAll();

setInterval(() => {
  for (const providerName of providerRegistry.listProviders()) {
    runStatusArchiveSweep('poll', { provider: providerName, accountId: DEFAULT_ACCOUNT_ID }).catch((error) => {
      console.error(`⚠️ Scheduled status archive sweep failed for ${providerName}:`, error.message);
    });
  }
}, STATUS_POLL_INTERVAL_MS);

function ensureProviderReady(res, provider) {
  const adapter = resolveProviderAdapter(provider);
  if (!adapter.isReady()) {
    res.status(503).json({
      error: `${provider} client not ready`,
      providerStatus: adapter.getStatus(),
      ready: false
    });
    return false;
  }
  return true;
}

// AI API endpoint
app.post('/api/correct', async (req, res) => {
  try {
    const text = sanitizeTextInput(req.body?.text);
    if (!text) return res.status(400).json({ error: 'No text provided' });
    if (text.length > 2500) {
      return res.status(400).json({ error: 'Text is too long (max 2500 chars)' });
    }
    const response = await requestCorrectionWithModel(text);
    const raw = response?.data?.choices?.[0]?.message?.content || '';
    const structured = extractStructuredCorrected(response);
    let cleanedText = normalizeCandidate(structured || raw);

    if (looksSuspicious(text, cleanedText, structured || raw)) {
      const strictResponse = await requestCorrectionWithModel(text, {
        temperature: 0.1,
        maxTokens: 80,
        systemPrompt: 'Sos un corrector ortográfico. Devolvés únicamente una sola línea final corregida, sin alternativas, sin listas y sin explicaciones.',
        userPromptTemplate: 'Corregí este mensaje manteniendo significado y el mismo idioma. Devolvé solo la versión final:\n\n{{text}}'
      });
      const strictRaw = strictResponse?.data?.choices?.[0]?.message?.content || '';
      const strictStructured = extractStructuredCorrected(strictResponse);
      const strictCleaned = normalizeCandidate(strictStructured || strictRaw);
      cleanedText = looksSuspicious(text, strictCleaned, strictStructured || strictRaw) ? text.trim() : strictCleaned;
    }

    if (cleanedText === String(text || '').trim()) {
      cleanedText = applyLightPolish(cleanedText);
    }

    res.json({ original: text, corrected: cleanedText });
  } catch (error) {
    logAiError(error, 'api/correct');
    const upstreamDetail = extractUpstreamAiError(error);
    res.status(500).json({
      error: 'AI server error',
      detail: upstreamDetail || error.message
    });
  }
});

app.get('/api/ai/config', async (_req, res) => {
  try {
    const configResponse = {
      ...aiConfig,
      provider: getAiProvider(aiConfig),
      aiBaseUrl: getAiBaseUrl(aiConfig)
    };
    if (configResponse.cloudflareApiToken) {
      configResponse.cloudflareApiToken = '********';
    }
    res.json(configResponse);
  } catch (error) {
    console.error('❌ Fetch AI config error:', error.message);
    res.status(500).json({ error: 'Failed to fetch AI configuration' });
  }
});

app.put('/api/ai/config', async (req, res) => {
  try {
    const nextConfig = {
      ...aiConfig
    };

    if (typeof req.body.systemPrompt === 'string') {
      nextConfig.systemPrompt = req.body.systemPrompt.trim() || DEFAULT_AI_CONFIG.systemPrompt;
    }
    if (typeof req.body.userPromptTemplate === 'string') {
      nextConfig.userPromptTemplate = req.body.userPromptTemplate.trim() || DEFAULT_AI_CONFIG.userPromptTemplate;
    }
    if (typeof req.body.modelName === 'string') {
      nextConfig.modelName = req.body.modelName.trim() || DEFAULT_AI_CONFIG.modelName;
    }
    if (typeof req.body.provider === 'string') {
      nextConfig.provider = String(req.body.provider).toLowerCase() === 'cloudflare' ? 'cloudflare' : 'lmstudio';
    }
    if (typeof req.body.lmStudioBaseUrl === 'string') {
      const trimmed = req.body.lmStudioBaseUrl.trim();
      if (trimmed !== '') {
        try {
          const parsed = new URL(trimmed);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
             return res.status(400).json({ error: 'Invalid lmStudioBaseUrl protocol. Must be http or https.' });
          }
        } catch (e) {
          return res.status(400).json({ error: 'Malformed URL provided for lmStudioBaseUrl.' });
        }
      }
      nextConfig.lmStudioBaseUrl = safeUrl(trimmed, DEFAULT_AI_CONFIG.lmStudioBaseUrl, 'PUT_LM_STUDIO_URL')
        .replace(/\/+$/, '')
        .replace(/\/v1\/chat\/completions$/, '');
    }
    if (typeof req.body.cloudflareAccountId === 'string') {
      nextConfig.cloudflareAccountId = req.body.cloudflareAccountId.trim();
    }
    if (typeof req.body.cloudflareApiToken === 'string') {
      const trimmedToken = req.body.cloudflareApiToken.trim();
      if (trimmedToken !== '********') {
        nextConfig.cloudflareApiToken = trimmedToken;
      }
    }
    if (typeof req.body.cloudflareBaseUrl === 'string') {
      const trimmed = req.body.cloudflareBaseUrl.trim();
      if (trimmed !== '') {
        try {
          const parsed = new URL(trimmed);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
             return res.status(400).json({ error: 'Invalid cloudflareBaseUrl protocol. Must be http or https.' });
          }
        } catch (e) {
          return res.status(400).json({ error: 'Malformed URL provided for cloudflareBaseUrl.' });
        }
      }
      nextConfig.cloudflareBaseUrl = safeUrl(trimmed, '', 'PUT_CLOUDFLARE_BASE_URL')
        .replace(/\/+$/, '');
    }
    if (req.body.temperature !== undefined) {
      nextConfig.temperature = safeNumber(req.body.temperature, aiConfig.temperature, 0, 2, 'PUT_TEMPERATURE');
    }
    if (req.body.maxTokens !== undefined) {
      nextConfig.maxTokens = safeNumber(req.body.maxTokens, aiConfig.maxTokens, 1, 8192, 'PUT_MAX_TOKENS');
    }
    if (req.body.timeoutMs !== undefined) {
      nextConfig.timeoutMs = safeNumber(req.body.timeoutMs, aiConfig.timeoutMs, 1000, 60000, 'PUT_TIMEOUT_MS');
    }

    const saved = await saveAiConfig(nextConfig);
    res.json({ success: true, config: saved });
  } catch (error) {
    console.error('❌ Save AI config error:', error.message);
    res.status(500).json({ error: 'Failed to save AI config' });
  }
});

app.get('/api/ai/health', async (_req, res) => {
  try {
    const models = await getAvailableModels(_req.query.refresh === '1');
    const provider = getAiProvider(aiConfig);
    const payload = {
      ok: true,
      provider,
      aiBaseUrl: getAiBaseUrl(aiConfig),
      modelCount: models.length,
      models
    };

    const shouldProbe = _req.query.probe === '1';
    if (shouldProbe) {
      try {
        const probe = await axios.post(getAiChatCompletionsUrl(aiConfig), {
          model: aiConfig.modelName,
          messages: [
            { role: 'system', content: 'Respondé solo "OK".' },
            { role: 'user', content: 'Ping' }
          ],
          temperature: 0
        }, {
          timeout: Math.min(Number(aiConfig.timeoutMs ?? 15000), 25000),
          headers: getAiRequestHeaders(aiConfig)
        });
        payload.probeOk = true;
        payload.probeResponse = probe.data?.choices?.[0]?.message?.content || null;
      } catch (probeError) {
        payload.probeOk = false;
        payload.probeError = probeError.response?.data?.error?.message || probeError.message;
      }
    }

    res.json(payload);
  } catch (error) {
    res.status(503).json({
      ok: false,
      provider: getAiProvider(aiConfig),
      aiBaseUrl: getAiBaseUrl(aiConfig),
      error: error.message
    });
  }
});

app.get('/api/ai/models', async (_req, res) => {
  try {
    const models = await getAvailableModels(_req.query.refresh === '1');
    res.json({
      ok: true,
      models
    });
  } catch (error) {
    res.status(503).json({
      ok: false,
      error: error.message
    });
  }
});

// Get chats - helps the frontend list who we can talk to
app.get(['/api/chats', '/api/chats/:channelCode'], async (req, res) => {
  try {
    if (req.params.channelCode) req.query.provider = req.params.channelCode;
    const { provider, accountId } = parseProviderContext(req);
    const cacheKey = chatsCacheKey(provider, accountId);

    const l1Cached = getL1CachedValue(l1ChatsCache, cacheKey);

    if (l1Cached) {
      enqueueSyncTask({
        kind: 'chats',
        provider,
        accountId,
        reason: 'api_chats_l1_hit'
      });
      return res.json({
        items: l1Cached,
        provider,
        accountId,
        cache: { level: 'l1', staleWhileRevalidate: true },
        syncState: getSyncStateSnapshot(provider, accountId, '__all__', 'chats')
      });
    }

    const cachedChats = await Chat.find({ provider, accountId }).sort({ timestamp: -1 }).lean();
    setL1CachedValue(l1ChatsCache, cacheKey, cachedChats, CHATS_CACHE_TTL_MS);

    enqueueSyncTask({
      kind: 'chats',
      provider,
      accountId,
      reason: 'api_chats'
    });

    res.json({
      items: cachedChats,
      provider,
      accountId,
      cache: { level: 'mongo', staleWhileRevalidate: true },
      syncState: getSyncStateSnapshot(provider, accountId, '__all__', 'chats')
    });
  } catch (error) {
    console.error('❌ Fetch chats error:', error.message);
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

app.get(['/api/chats/:chatId/messages', '/api/chats/:chatId/messages/:channelCode'], async (req, res) => {
  try {
    if (req.params.channelCode) req.query.provider = req.params.channelCode;
    const chatId = req.params.chatId;
    const limit = parsePositiveInt(req.query.limit, 80, 200);
    const { provider, accountId } = parseProviderContext(req);

    if (!chatId) {
      return res.status(400).json({ error: 'Missing chatId' });
    }

    const l1Key = messagesCacheKey(provider, accountId, chatId, limit);
    const l1Cached = getL1CachedValue(l1MessagesCache, l1Key);
    if (l1Cached) {
      enqueueSyncTask({
        kind: 'messages',
        provider,
        accountId,
        conversationId: chatId,
        limit,
        reason: 'api_messages_l1_hit'
      });
      return res.json({
        items: l1Cached,
        provider,
        accountId,
        conversationId: chatId,
        cache: { level: 'l1', staleWhileRevalidate: true },
        syncState: getSyncStateSnapshot(provider, accountId, chatId, 'messages')
      });
    }

    const cachedMessages = await Message.find({
      provider,
      accountId,
      conversationId: chatId
    })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    // Reverse to chronological order for frontend
    const results = cachedMessages.reverse();

    setL1CachedValue(l1MessagesCache, l1Key, results, MESSAGES_CACHE_TTL_MS);
    enqueueSyncTask({
      kind: 'messages',
      provider,
      accountId,
      conversationId: chatId,
      limit,
      reason: 'api_messages'
    });

    res.json({
      items: results,
      provider,
      accountId,
      conversationId: chatId,
      cache: { level: 'mongo', staleWhileRevalidate: true },
      syncState: getSyncStateSnapshot(provider, accountId, chatId, 'messages')
    });
  } catch (error) {
    console.error('❌ Fetch messages error details:', error);
    res.status(500).json({ 
      error: 'Failed to fetch messages', 
      detail: error.message 
    });
  }
});

app.get(['/api/chats/:chatId/resources', '/api/chats/:chatId/resources/:channelCode'], async (req, res) => {
  try {
    if (req.params.channelCode) req.query.provider = req.params.channelCode;
    const { chatId } = req.params;
    const { provider, accountId } = parseProviderContext(req);

    if (!chatId) return res.status(400).json({ error: 'Missing chatId' });

    const mediaMessages = await Message.find({
      provider,
      accountId,
      conversationId: chatId,
      mediaUrl: { $exists: true, $ne: null }
    }).sort({ timestamp: -1 }).limit(100).lean();

    const allMessages = await Message.find({
      provider,
      accountId,
      conversationId: chatId,
      body: { $regex: /https?:\/\/[^\s]+/ }
    }).sort({ timestamp: -1 }).limit(100).lean();

    const links = [];
    allMessages.forEach(m => {
      const found = m.body.match(/https?:\/\/[^\s]+/g);
      if (found) {
        found.forEach(url => {
          links.push({
            url,
            timestamp: m.timestamp,
            fromMe: m.fromMe
          });
        });
      }
    });

    const statuses = await StatusArchive.find({
      provider,
      accountId,
      statusOwnerId: chatId
    }).sort({ timestamp: -1 }).limit(50).lean();

    res.json({
      chatId,
      media: mediaMessages,
      links,
      statuses
    });
  } catch (error) {
    console.error('❌ Fetch resources error:', error.message);
    res.status(500).json({ error: 'Failed to fetch resources', detail: error.message });
  }
});

app.post(['/api/chats/:chatId/read', '/api/chats/:chatId/read/:channelCode'], async (req, res) => {
  try {
    if (req.params.channelCode) req.query.provider = req.params.channelCode;
    const { chatId } = req.params;
    const { provider, accountId } = parseProviderContext(req);
    if (!chatId) {
      return res.status(400).json({ error: 'Missing chatId' });
    }

    // Update local cache first
    await Chat.findOneAndUpdate(
      { provider, accountId, conversationId: chatId },
      { unreadCount: 0 },
      { new: true }
    );
    invalidateChatsCache(provider, accountId);

    if (provider !== 'local') {
      const adapter = resolveProviderAdapter(provider);
      if (adapter.isReady()) {
        adapter.markRead({ provider, accountId, conversationId: chatId }).catch(err => {
          console.warn(`⚠️ Failed to sendSeen via provider ${provider} for ${chatId}:`, err.message);
        });
      }
    }

    res.json({ success: true, provider, accountId, conversationId: chatId });
  } catch (error) {
    console.error('❌ Mark read error:', error.message);
    res.status(500).json({ error: 'Failed to mark chat as read' });
  }
});

// Send message / API Publish
// Accepts chatId via: route param, query string, or JSON body
app.post(['/api/send', '/api/send/:channelCode'], async (req, res) => {
  try {
    if (req.params.channelCode) req.query.provider = req.params.channelCode;
    const { provider, accountId } = parseProviderContext(req);

    if (provider === 'local') {
      const senderId = accountId;
      const receiverId = String(req.query.chatId || req.body?.chatId || '').trim();
      const text = sanitizeTextInput(req.body?.text);

      if (!receiverId || !text) {
        return res.status(400).json({ error: 'Chat ID y texto son obligatorios.' });
      }

      const timestamp = Math.floor(Date.now() / 1000);
      const messageIdBase = crypto.randomUUID();

      // Case A: AI Companion Chat
      if (receiverId === 'ai_assistant') {
        const userMsg = await Message.create({
          provider: 'local',
          accountId: senderId,
          conversationId: 'ai_assistant',
          chatId: 'ai_assistant',
          providerMessageId: `user-msg-${messageIdBase}`,
          conversationKey: `local:${senderId}:ai_assistant`,
          from: senderId,
          to: 'ai_assistant',
          body: text,
          fromMe: true,
          timestamp
        });

        await Chat.findOneAndUpdate(
          { provider: 'local', accountId: senderId, conversationId: 'ai_assistant' },
          { timestamp, lastSyncedAt: new Date() },
          { upsert: true }
        );

        invalidateChatsCache('local', senderId);
        invalidateMessagesCache('local', senderId, 'ai_assistant');

        io.to(senderId).emit('new_message', userMsg);

        res.json({ success: true, chatId: 'ai_assistant', message: 'Message queued to AI' });

        try {
          let systemPrompt = aiConfig.systemPrompt || "Eres un asistente de IA amigable e inteligente.";
          let userPrompt = text;
          let responseText = "Lo siento, no pude conectar con el servidor de IA.";

          if (isAiConfigured()) {
            const url = getAiChatCompletionsUrl();
            const headers = {
              'Content-Type': 'application/json',
              ...getAiRequestHeaders()
            };
            const postData = {
              model: aiConfig.modelName || 'llama-3.1-8b-instruct',
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
              ],
              temperature: aiConfig.temperature,
              max_tokens: aiConfig.maxTokens
            };

            const aiRes = await axios.post(url, postData, {
              headers,
              timeout: aiConfig.timeoutMs || 15000
            });

            const choice = aiRes.data?.choices?.[0];
            responseText = stripThinking(choice?.message?.content || choice?.text || responseText);
          } else {
            responseText = "¡Hola! He recibido tu mensaje, pero el servidor de IA (LM Studio o Cloudflare) no está configurado en el backend actualmente. Puedes configurarlo en la sección de Ajustes de IA.";
          }

          const aiMsgIdBase = crypto.randomUUID();
          const aiMsg = await Message.create({
            provider: 'local',
            accountId: senderId,
            conversationId: 'ai_assistant',
            chatId: 'ai_assistant',
            providerMessageId: `ai-msg-${aiMsgIdBase}`,
            conversationKey: `local:${senderId}:ai_assistant`,
            from: 'ai_assistant',
            to: senderId,
            body: responseText,
            fromMe: false,
            timestamp: Math.floor(Date.now() / 1000)
          });

          await Chat.findOneAndUpdate(
            { provider: 'local', accountId: senderId, conversationId: 'ai_assistant' },
            { timestamp: Math.floor(Date.now() / 1000) }
          );

          invalidateChatsCache('local', senderId);
          invalidateMessagesCache('local', senderId, 'ai_assistant');

          io.to(senderId).emit('new_message', aiMsg);
        } catch (aiErr) {
          console.error('AI Companion error:', aiErr);
          const errBase = crypto.randomUUID();
          const errMsg = await Message.create({
            provider: 'local',
            accountId: senderId,
            conversationId: 'ai_assistant',
            chatId: 'ai_assistant',
            providerMessageId: `ai-err-${errBase}`,
            conversationKey: `local:${senderId}:ai_assistant`,
            from: 'ai_assistant',
            to: senderId,
            body: "⚠️ Error al conectar con el servidor de IA (LM Studio o Cloudflare). Por favor, comprueba que el servidor esté activo y la configuración en Ajustes sea correcta.",
            fromMe: false,
            timestamp: Math.floor(Date.now() / 1000)
          });
          
          await Chat.findOneAndUpdate(
            { provider: 'local', accountId: senderId, conversationId: 'ai_assistant' },
            { timestamp: Math.floor(Date.now() / 1000) }
          );

          invalidateChatsCache('local', senderId);
          invalidateMessagesCache('local', senderId, 'ai_assistant');

          io.to(senderId).emit('new_message', errMsg);
        }
        return;
      }

      // Case B: User-to-User Chat
      const receiver = await User.findById(receiverId);
      if (!receiver) {
        return res.status(404).json({ error: 'El usuario destinatario no existe.' });
      }

      const senderMsg = await Message.create({
        provider: 'local',
        accountId: senderId,
        conversationId: receiverId,
        chatId: receiverId,
        providerMessageId: `local-msg-${messageIdBase}`,
        conversationKey: `local:${senderId}:${receiverId}`,
        from: senderId,
        to: receiverId,
        body: text,
        fromMe: true,
        timestamp
      });

      await Chat.findOneAndUpdate(
        { provider: 'local', accountId: senderId, conversationId: receiverId },
        {
          provider: 'local',
          accountId: senderId,
          conversationId: receiverId,
          conversationKey: `local:${senderId}:${receiverId}`,
          name: receiver.username,
          timestamp,
          isGroup: false,
          avatarUrl: receiver.avatarUrl || '',
          lastSyncedAt: new Date()
        },
        { upsert: true, new: true }
      );

      const receiverMsg = await Message.create({
        provider: 'local',
        accountId: receiverId,
        conversationId: senderId,
        chatId: senderId,
        providerMessageId: `local-msg-${messageIdBase}`,
        conversationKey: `local:${receiverId}:${senderId}`,
        from: senderId,
        to: receiverId,
        body: text,
        fromMe: false,
        timestamp
      });

      await Chat.findOneAndUpdate(
        { provider: 'local', accountId: receiverId, conversationId: senderId },
        {
          provider: 'local',
          accountId: receiverId,
          conversationId: senderId,
          conversationKey: `local:${receiverId}:${senderId}`,
          name: req.user.username,
          timestamp,
          isGroup: false,
          avatarUrl: req.user.avatarUrl || '',
          $inc: { unreadCount: 1 },
          lastSyncedAt: new Date()
        },
        { upsert: true, new: true }
      );

      // Invalidate caches on both sides for real-time reactivity
      invalidateChatsCache('local', senderId);
      invalidateChatsCache('local', receiverId);
      invalidateMessagesCache('local', senderId, receiverId);
      invalidateMessagesCache('local', receiverId, senderId);

      io.to(senderId).emit('new_message', senderMsg);
      io.to(receiverId).emit('new_message', receiverMsg);

      return res.json({
        success: true,
        chatId: receiverId,
        provider: 'local',
        accountId: senderId,
        message: 'Message sent'
      });
    }

    const adapter = resolveProviderAdapter(provider);

    if (!adapter.isReady()) {
      return res.status(503).json({
        error: `${provider} client not ready`,
        providerStatus: adapter.getStatus(),
        ready: false
      });
    }

    let chatId = String(
      req.query.chatId || req.body?.chatId || ''
    ).trim();

    const text = sanitizeTextInput(req.body?.text);
    const originalText = sanitizeTextInput(req.body?.originalText || text);
    const replyToMessageId = String(req.body?.replyToMessageId || '').trim();

    const mediaUrl = String(req.body?.mediaUrl || '').trim();
    const mediaBase64 = String(req.body?.mediaBase64 || '').trim();
    const mediaName = String(req.body?.mediaName || 'image.jpg').trim();
    const mediaMimeType = String(req.body?.mediaMimeType || 'image/jpeg').trim();

    // Delegate the entire send logic to the provider adapter
    const sendResult = await adapter.sendMessage({
      provider,
      accountId,
      conversationId: chatId,
      chatId,
      text,
      replyToMessageId,
      mediaUrl,
      mediaBase64,
      mediaName,
      mediaMimeType
    });

    // 5. Cache correction metadata
    // Store metadata locally to link it in the adapter message_create event
    if (originalText && originalText !== text) {
      const matchKey = buildConversationKey(provider, accountId, chatId) + ':' + text.trim();
      aiMetadataCache.set(matchKey, {
        originalText,
        correctedText: text,
        sentText: text,
        timestamp: Date.now()
      });

      // Cleanup after 2 minutes to avoid leak if message_create fails/drops
      setTimeout(() => {
        aiMetadataCache.delete(matchKey);
      }, 120000);
    }

    res.json({
      success: true,
      chatId: sendResult.chatId,
      provider,
      accountId,
      isNewsletter: sendResult.isNewsletter,
      message: sendResult.isNewsletter ? 'Published to channel' : 'Message sent'
    });

    enqueueSyncTask({
      kind: 'messages',
      provider,
      accountId,
      conversationId: sendResult.chatId,
      limit: 120,
      reason: 'send_message'
    });
  } catch (error) {
    const detail = typeof error === 'object'
      ? (error.message || JSON.stringify(error))
      : String(error);
    console.error('❌ Send error:', detail);

    // Attempt to map specific errors to status codes
    let status = 500;
    if (detail.includes('Missing parameters') || detail.includes('Failed to process media')) {
      status = 400;
    } else if (detail.includes('Channel resolution failed') || detail.includes('Channel not found')) {
      status = 404;
    }

    res.status(status).json({
      error: 'Failed to send message',
      details: detail
    });
  }
});

app.get(['/api/status', '/api/status/:channelCode'], async (req, res) => {
  try {
    if (req.params.channelCode) req.query.provider = req.params.channelCode;
    const { provider } = parseProviderContext(req);
    const defaultState = getProviderState(provider);
    res.json({
      providerStatus: defaultState.status,
      providers: providerRegistry ? providerRegistry.listProviders() : [provider],
      hasQr: Boolean(defaultState.lastQR),
      lastProviderReadyAt: defaultState.lastReadyAt,
      lastProviderDisconnectReason: defaultState.lastDisconnectReason,
      statusArchive: {
        lastRunAt: lastStatusArchiveRunAt,
        inFlight: statusArchivePollInFlight,
        stats: lastStatusArchiveStats
      },
      syncQueue: {
        queued: syncQueue.length,
        pendingKeys: syncPendingKeys.size,
        inFlightKeys: syncInFlightKeys.size
      },
      uptimeSec: Math.floor(process.uptime())
    });
  } catch (error) {
    console.error('❌ Status endpoint error:', error.message);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

app.get(['/api/status-archive', '/api/status-archive/:channelCode'], async (req, res) => {
  try {
    if (req.params.channelCode) req.query.provider = req.params.channelCode;
    const { provider, accountId } = parseProviderContext(req);
    const limit = parsePositiveInt(req.query.limit, 100, 500);
    const ownerId = String(req.query.ownerId || '').trim();
    const query = {
      provider,
      accountId
    };
    if (ownerId) {
      query.statusOwnerId = ownerId;
    }

    // ⚡ Bolt: Removed createdAt: -1 from sort to utilize the {provider: 1, accountId: 1, timestamp: -1} compound index perfectly and avoid a slow in-memory sort
    const items = await StatusArchive.find(query)
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    res.json({
      items,
      meta: {
        limit,
        ownerId: ownerId || null,
        lastRunAt: lastStatusArchiveRunAt,
        inFlight: statusArchivePollInFlight,
        stats: lastStatusArchiveStats
      }
    });
  } catch (error) {
    console.error('❌ Fetch status archive error:', error.message);
    res.status(500).json({ error: 'Failed to fetch status archive', detail: error.message });
  }
});

app.post(['/api/status-archive/sweep', '/api/status-archive/sweep/:channelCode'], async (req, res) => {
  try {
    if (req.params.channelCode) req.query.provider = req.params.channelCode;
    const { provider, accountId } = parseProviderContext(req);
    const stats = await runStatusArchiveSweep('poll', { provider, accountId });
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ error: 'Failed to sweep status archive', detail: error.message });
  }
});

app.get(['/api/health', '/api/health/:channelCode'], async (req, res) => {
  try {
    if (req.params.channelCode) req.query.provider = req.params.channelCode;
    const { provider } = parseProviderContext(req);
    const mongoOk = mongoose.connection.readyState === 1;
    const aiConfigured = isAiConfigured(aiConfig);
    const defaultState = getProviderState(provider);
    const providerOk = defaultState.status === 'authenticated' || defaultState.status === 'qr';
    res.status(mongoOk ? 200 : 503).json({
      ok: mongoOk,
      services: {
        mongo: mongoOk ? 'up' : 'down',
        provider: providerOk ? defaultState.status : 'down',
        ai: aiConfigured ? 'configured' : 'missing'
      },
      uptimeSec: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Health endpoint error:', error.message);
    res.status(500).json({ error: 'Failed to fetch health' });
  }
});

app.get(['/api/sync/state', '/api/sync/state/:channelCode'], async (req, res) => {
  try {
    if (req.params.channelCode) req.query.provider = req.params.channelCode;
    const { provider, accountId } = parseProviderContext(req);
    const kind = req.query.kind === 'messages' ? 'messages' : 'chats';
    const conversationId = String(req.query.conversationId || (kind === 'messages' ? '' : '__all__')).trim();
    const safeConversationId = conversationId || '__all__';
    const local = getSyncStateSnapshot(provider, accountId, safeConversationId, kind);
    const persisted = await SyncState.findOne({
      provider,
      accountId,
      conversationId: safeConversationId,
      kind
    }).lean();
    res.json({
      provider,
      accountId,
      conversationId: safeConversationId,
      kind,
      local,
      persisted: persisted || null
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch sync state', detail: error.message });
  }
});

const PORT = process.env.PORT || 3005;
server.listen(PORT, () => {
  console.log(`🚀 Backend running on http://localhost:${PORT}`);
});

loadAiConfig();
