import express from 'express';
import cors from 'cors';
import http from 'http';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';
import { WebSocketServer } from 'ws';

dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = Number(process.env.PORT || 4001);
const JWT_SECRET = process.env.JWT_SECRET || 'kz-remote-pc-local-secret';
const DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const demoUserPassword = bcrypt.hashSync('demo123', 10);
const demoGooglePassword = bcrypt.hashSync('google123', 10);

const defaultStore = {
  users: [
    {
      id: 'demo-user',
      name: 'Demo User',
      email: 'demo@kzremote.com',
      passwordHash: demoUserPassword,
      provider: 'email',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'google-user',
      name: 'Google User',
      email: 'google.user@kzremote.com',
      passwordHash: demoGooglePassword,
      provider: 'google',
      createdAt: new Date().toISOString(),
    },
  ],
  devices: [
    {
      id: 'pc-demo-1',
      ownerId: 'demo-user',
      name: 'Meu PC principal',
      os: 'Windows 11 Pro',
      status: 'online',
      isAuthorized: true,
      isConnected: false,
      lastSeen: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    },
    {
      id: 'pc-demo-2',
      ownerId: 'google-user',
      name: 'Notebook de trabalho',
      os: 'Windows 10',
      status: 'offline',
      isAuthorized: true,
      isConnected: false,
      lastSeen: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    },
  ],
};

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultStore, null, 2));
  }
}

function readStore() {
  ensureDb();
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  return JSON.parse(raw);
}

function writeStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

function findUserByEmail(email) {
  const store = readStore();
  return store.users.find((user) => user.email.toLowerCase() === String(email).toLowerCase());
}

function findUserById(id) {
  const store = readStore();
  return store.users.find((user) => user.id === id);
}

function findDeviceById(id) {
  const store = readStore();
  return store.devices.find((device) => device.id === id);
}

function toPublicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    provider: user.provider,
    createdAt: user.createdAt,
  };
}

function issueToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || 'Bearer ';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Token de autenticação ausente.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = findUserById(decoded.sub);
    if (!user) {
      return res.status(401).json({ message: 'Usuário não encontrado.' });
    }
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Token inválido ou expirado.' });
  }
}

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'KZ Remote PC API' });
});

app.get('/api/system/config', (req, res) => {
  res.json({
    stun: ['stun:stun.l.google.com:19302'],
    turn: {
      urls: ['turn:turn.example.com:3478'],
      username: process.env.TURN_USERNAME || 'demo',
      password: process.env.TURN_PASSWORD || 'demo',
    },
  });
});

app.post('/api/auth/register', (req, res) => {
  const { name, email, password, provider = 'email' } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'E-mail e senha são obrigatórios.' });
  }

  const store = readStore();
  const existingUser = findUserByEmail(email);
  if (existingUser) {
    return res.status(409).json({ message: 'Este e-mail já está cadastrado.' });
  }

  const user = {
    id: randomUUID(),
    name: name || 'Usuário KZ',
    email,
    passwordHash: bcrypt.hashSync(password, 10),
    provider,
    createdAt: new Date().toISOString(),
  };

  store.users.push(user);
  writeStore(store);

  const token = issueToken(user);
  return res.status(201).json({ token, user: toPublicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Informe e-mail e senha.' });
  }

  const user = findUserByEmail(email);
  if (!user) {
    return res.status(404).json({ message: 'Usuário não encontrado.' });
  }

  const isValid = bcrypt.compareSync(password, user.passwordHash);
  if (!isValid) {
    return res.status(401).json({ message: 'Senha incorreta.' });
  }

  const token = issueToken(user);
  return res.json({ token, user: toPublicUser(user) });
});

app.post('/api/auth/google', (req, res) => {
  const { name, email, password, provider = 'google' } = req.body;
  const store = readStore();
  let user = store.users.find((item) => item.email.toLowerCase() === String(email).toLowerCase());

  if (!user) {
    user = {
      id: randomUUID(),
      name: name || 'Usuário Google',
      email,
      passwordHash: bcrypt.hashSync(password || 'google123', 10),
      provider,
      createdAt: new Date().toISOString(),
    };

    store.users.push(user);
    writeStore(store);
  }

  const token = issueToken(user);
  return res.json({ token, user: toPublicUser(user) });
});

app.post('/api/auth/forgot-password', (req, res) => {
  const { email } = req.body;
  const user = findUserByEmail(email || '');

  if (!user) {
    return res.status(404).json({ message: 'E-mail não cadastrado.' });
  }

  return res.json({
    ok: true,
    message: `Instruções de recuperação foram enviadas para ${user.email}.`,
    resetToken: 'demo-reset-token',
  });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: toPublicUser(req.user) });
});

app.post('/api/auth/logout', authMiddleware, (req, res) => {
  res.json({ ok: true, message: 'Logout realizado com sucesso.' });
});

app.get('/api/devices', authMiddleware, (req, res) => {
  const store = readStore();
  const devices = store.devices.filter((device) => device.ownerId === req.user.id);
  res.json({ devices });
});

app.post('/api/devices/register', authMiddleware, (req, res) => {
  const { name, os = 'Windows 11' } = req.body;
  const store = readStore();
  const device = {
    id: randomUUID(),
    ownerId: req.user.id,
    name: name || 'Novo computador',
    os,
    status: 'offline',
    isAuthorized: true,
    isConnected: false,
    lastSeen: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };

  store.devices.push(device);
  writeStore(store);

  res.status(201).json({ device });
});

app.post('/api/devices/:id/connect', authMiddleware, (req, res) => {
  const store = readStore();
  const device = store.devices.find((item) => item.id === req.params.id && item.ownerId === req.user.id);

  if (!device) {
    return res.status(404).json({ message: 'Dispositivo não encontrado.' });
  }

  device.isConnected = true;
  device.status = 'online';
  device.lastSeen = new Date().toISOString();
  writeStore(store);

  return res.json({ ok: true, device });
});

app.post('/api/devices/:id/disconnect', authMiddleware, (req, res) => {
  const store = readStore();
  const device = store.devices.find((item) => item.id === req.params.id && item.ownerId === req.user.id);

  if (!device) {
    return res.status(404).json({ message: 'Dispositivo não encontrado.' });
  }

  device.isConnected = false;
  device.status = 'offline';
  device.lastSeen = new Date().toISOString();
  writeStore(store);

  return res.json({ ok: true, device });
});

app.post('/api/devices/:id/revoke', authMiddleware, (req, res) => {
  const store = readStore();
  const device = store.devices.find((item) => item.id === req.params.id && item.ownerId === req.user.id);

  if (!device) {
    return res.status(404).json({ message: 'Dispositivo não encontrado.' });
  }

  device.isAuthorized = false;
  device.status = 'offline';
  device.isConnected = false;
  writeStore(store);

  return res.json({ ok: true, device });
});

app.post('/api/devices/:id/authorize', authMiddleware, (req, res) => {
  const store = readStore();
  const device = store.devices.find((item) => item.id === req.params.id && item.ownerId === req.user.id);

  if (!device) {
    return res.status(404).json({ message: 'Dispositivo não encontrado.' });
  }

  device.isAuthorized = true;
  device.status = 'online';
  writeStore(store);
  return res.json({ ok: true, device });
});

app.post('/api/devices/:id/heartbeat', authMiddleware, (req, res) => {
  const store = readStore();
  const device = store.devices.find((item) => item.id === req.params.id && item.ownerId === req.user.id);

  if (!device) {
    return res.status(404).json({ message: 'Dispositivo não encontrado.' });
  }

  device.lastSeen = new Date().toISOString();
  device.status = 'online';
  writeStore(store);
  return res.json({ ok: true, device });
});

const wsClients = new Map();

wss.on('connection', (socket) => {
  const clientId = randomUUID();
  socket.clientId = clientId;
  socket.role = null;
  socket.userId = null;
  socket.deviceId = null;

  wsClients.set(clientId, socket);

  socket.on('message', (rawMessage) => {
    try {
      const message = JSON.parse(rawMessage.toString());

      if (message.type === 'register') {
        socket.role = message.role;
        socket.userId = message.userId || null;
        socket.deviceId = message.deviceId || null;

        if (socket.role === 'agent' && socket.deviceId) {
          const store = readStore();
          const device = store.devices.find((item) => item.id === socket.deviceId);
          if (device) {
            device.status = 'online';
            device.isConnected = false;
            device.lastSeen = new Date().toISOString();
            writeStore(store);
          }
        }

        socket.send(JSON.stringify({ type: 'registered', success: true, clientId }));
        return;
      }

      if (message.type === 'signal') {
        const targetDeviceId = message.targetDeviceId;
        const targetUserId = message.targetUserId;

        let recipients = [];

        if (targetDeviceId) {
          recipients = [...wsClients.values()].filter(
            (client) =>
              (client.deviceId === targetDeviceId && client.role === 'agent') ||
              (client.deviceId === targetDeviceId && client.role === 'client')
          );
        }

        if (targetUserId) {
          recipients = [...wsClients.values()].filter((client) => client.userId === targetUserId);
        }

        recipients.forEach((client) => {
          if (client === socket) return;
          client.send(JSON.stringify({
            type: 'signal',
            deviceId: socket.deviceId,
            sourceRole: socket.role,
            signal: message.signal,
          }));
        });
      }
    } catch (error) {
      console.error('WebSocket error', error);
    }
  });

  socket.on('close', () => {
    wsClients.delete(clientId);
  });
});

app.use((req, res) => {
  res.status(404).json({ message: 'Rota não encontrada.' });
});

server.listen(PORT, () => {
  console.log(`KZ Remote PC API running on http://localhost:${PORT}`);
});
