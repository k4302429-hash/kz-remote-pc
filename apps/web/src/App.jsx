import { useEffect, useRef, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4001/api';
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:4001';

async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('kz-token');
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    throw new Error(data?.message || 'Erro ao processar a requisição');
  }

  return data;
}

function App() {
  const [authMode, setAuthMode] = useState('login');
  const [form, setForm] = useState({
    name: 'Demo User',
    email: 'demo@kzremote.com',
    password: 'demo123',
  });
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('kz-user');
    return stored ? JSON.parse(stored) : null;
  });
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [status, setStatus] = useState('Aguardando conexão');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [socketReady, setSocketReady] = useState(false);

  const wsRef = useRef(null);
  const pcRef = useRef(null);

  const loadDevices = async () => {
    if (!user) return;
    try {
      const data = await apiFetch('/devices');
      setDevices(data.devices || []);
      if (!selectedDeviceId && data.devices.length) {
        setSelectedDeviceId(data.devices[0].id);
      }
    } catch (e) {
      setStatus(e.message);
    }
  };

  useEffect(() => {
    if (!user) {
      setDevices([]);
      setSelectedDeviceId('');
      return;
    }

    loadDevices();
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const socket = new WebSocket(WS_URL);
    wsRef.current = socket;

    socket.onopen = () => {
      setSocketReady(true);
      socket.send(JSON.stringify({ type: 'register', role: 'client', userId: user.id }));
      setStatus('Conectado à rede de sinalização');
    };

    socket.onclose = () => {
      setSocketReady(false);
      setStatus('Sinalização desconectada');
    };

    socket.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === 'signal') {
          const { signal, sourceRole, deviceId } = message;
          if (!pcRef.current) return;

          if (signal.type === 'answer') {
            await pcRef.current.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
          }

          if (signal.type === 'candidate') {
            if (signal.candidate) {
              await pcRef.current.addIceCandidate(new RTCIceCandidate(signal.candidate));
            }
          }

          if (signal.type === 'offer' && sourceRole === 'agent') {
            await pcRef.current.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
            const answer = await pcRef.current.createAnswer();
            await pcRef.current.setLocalDescription(answer);
            socket.send(JSON.stringify({
              type: 'signal',
              targetDeviceId: deviceId,
              deviceId: deviceId,
              signal: {
                type: 'answer',
                sdp: answer.sdp,
              },
            }));
          }
        }

        if (message.type === 'device-status') {
          setStatus(`Dispositivo ${message.device.name}: ${message.device.status}`);
          await loadDevices();
        }
      } catch (e) {
        console.error('WS message error', e);
      }
    };

    return () => {
      socket.close();
    };
  }, [user]);

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const submitAuth = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const endpoint = authMode === 'login' ? '/auth/login' : '/auth/register';
      const payload = authMode === 'login'
        ? { email: form.email, password: form.password }
        : { name: form.name, email: form.email, password: form.password, provider: 'email' };

      const response = await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      localStorage.setItem('kz-token', response.token);
      localStorage.setItem('kz-user', JSON.stringify(response.user));
      setUser(response.user);
      setStatus('Sessão iniciada');
      setForm({ name: 'Demo User', email: 'demo@kzremote.com', password: 'demo123' });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await apiFetch('/auth/google', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Google User',
          email: 'google.user@kzremote.com',
          password: 'google123',
          provider: 'google',
        }),
      });

      localStorage.setItem('kz-token', response.token);
      localStorage.setItem('kz-user', JSON.stringify(response.user));
      setUser(response.user);
      setStatus('Login com Google realizado');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    try {
      await apiFetch('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: form.email }),
      });
      setStatus('Link de recuperação enviado para o e-mail');
    } catch (e) {
      setError(e.message);
    }
  };

  const logout = () => {
    localStorage.removeItem('kz-token');
    localStorage.removeItem('kz-user');
    setUser(null);
    setStatus('Sessão encerrada');
  };

  const createPeerConnection = async (deviceId) => {
    const peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    pcRef.current = peerConnection;

    peerConnection.onconnectionstatechange = () => {
      const state = peerConnection.connectionState;
      if (state === 'connected') {
        setStatus('Conexão ativa com o computador remoto');
      }
      if (state === 'disconnected' || state === 'failed') {
        setStatus('Conexão encerrada');
      }
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'signal',
          targetDeviceId: deviceId,
          deviceId,
          signal: {
            type: 'candidate',
            candidate: event.candidate,
          },
        }));
      }
    };

    peerConnection.ontrack = (event) => {
      const preview = document.getElementById('remote-preview');
      if (preview && event.streams && event.streams[0]) {
        preview.srcObject = event.streams[0];
      }
    };

    const localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    }).catch(() => null);

    if (localStream) {
      localStream.getTracks().forEach((track) => peerConnection.addTrack(track, localStream));
    }

    const offer = await peerConnection.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true });
    await peerConnection.setLocalDescription(offer);

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'signal',
        targetDeviceId: deviceId,
        deviceId,
        signal: {
          type: 'offer',
          sdp: offer.sdp,
        },
      }));
    }
  };

  const connectToDevice = async (deviceId) => {
    setSelectedDeviceId(deviceId);
    setStatus('Solicitando acesso ao computador...');

    try {
      await apiFetch(`/devices/${deviceId}/connect`, { method: 'POST' });
      await createPeerConnection(deviceId);
      await loadDevices();
    } catch (e) {
      setError(e.message);
    }
  };

  const disconnectDevice = async (deviceId) => {
    try {
      await apiFetch(`/devices/${deviceId}/disconnect`, { method: 'POST' });
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      await loadDevices();
      setStatus('Computador desconectado');
    } catch (e) {
      setError(e.message);
    }
  };

  const revokeAccess = async (deviceId) => {
    try {
      await apiFetch(`/devices/${deviceId}/revoke`, { method: 'POST' });
      await loadDevices();
      setStatus('Acesso do dispositivo revogado');
    } catch (e) {
      setError(e.message);
    }
  };

  const selectedDevice = devices.find((device) => device.id === selectedDeviceId) || devices[0] || null;

  if (!user) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="brand-row">
            <div className="brand-mark">KZ</div>
            <div>
              <div className="eyebrow">Acesso remoto</div>
              <h1>KZ Remote PC</h1>
            </div>
          </div>

          <div className="tab-row">
            <button className={authMode === 'login' ? 'tab active' : 'tab'} onClick={() => setAuthMode('login')}>
              Entrar
            </button>
            <button className={authMode === 'register' ? 'tab active' : 'tab'} onClick={() => setAuthMode('register')}>
              Cadastrar
            </button>
          </div>

          <button className="google-button" onClick={handleGoogleLogin} disabled={loading}>
            Continuar com Google
          </button>

          <div className="divider"><span>ou use e-mail</span></div>

          <form onSubmit={submitAuth} className="auth-form">
            {authMode === 'register' && (
              <label>
                Nome
                <input name="name" value={form.name} onChange={handleInputChange} placeholder="Seu nome completo" />
              </label>
            )}

            <label>
              E-mail
              <input type="email" name="email" value={form.email} onChange={handleInputChange} placeholder="voce@exemplo.com" />
            </label>

            <label>
              Senha
              <input type="password" name="password" value={form.password} onChange={handleInputChange} placeholder="••••••••" />
            </label>

            <div className="actions-row">
              <button className="primary" type="submit" disabled={loading}>
                {loading ? 'Enviando...' : authMode === 'login' ? 'Entrar' : 'Criar conta'}
              </button>
              {authMode === 'login' && (
                <button type="button" className="secondary" onClick={handleForgotPassword}>
                  Recuperar senha
                </button>
              )}
            </div>
          </form>

          {error && <p className="alert error">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-box">
          <div className="brand-mark">KZ</div>
          <div>
            <div className="eyebrow">Painel</div>
            <h2>KZ Remote PC</h2>
          </div>
        </div>

        <nav className="nav-list">
          <button className="nav-item active">Computadores</button>
          <button className="nav-item">Configurações</button>
          <button className="nav-item">Perfil</button>
        </nav>

        <div className="profile-box">
          <strong>{user.name}</strong>
          <span>{user.email}</span>
          <button className="secondary full" onClick={logout}>Sair</button>
        </div>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <div className="eyebrow">Disponível</div>
            <h1>Computadores cadastrados</h1>
          </div>
          <div className={`status-pill ${socketReady ? 'green' : 'gray'}`}>
            {socketReady ? 'Sinalização ativa' : 'Sinalização offline'}
          </div>
        </header>

        <section className="metrics-row">
          <div className="metric-card">
            <span>Total</span>
            <strong>{devices.length}</strong>
          </div>
          <div className="metric-card">
            <span>Online</span>
            <strong>{devices.filter((device) => device.status === 'online').length}</strong>
          </div>
          <div className="metric-card">
            <span>Offline</span>
            <strong>{devices.filter((device) => device.status !== 'online').length}</strong>
          </div>
          <div className="metric-card">
            <span>Conexão</span>
            <strong>{pcRef.current ? 'ativa' : 'inativa'}</strong>
          </div>
        </section>

        <section className="device-grid">
          {devices.map((device) => (
            <article key={device.id} className={`device-card ${selectedDeviceId === device.id ? 'selected' : ''}`}>
              <div className="device-head">
                <div>
                  <h3>{device.name}</h3>
                  <span>{device.os}</span>
                </div>
                <div className={`dot ${device.status === 'online' ? 'online' : 'offline'}`} />
              </div>

              <ul>
                <li><strong>Status:</strong> {device.status}</li>
                <li><strong>Autorizado:</strong> {device.isAuthorized ? 'Sim' : 'Não'}</li>
                <li><strong>Última atividade:</strong> {new Date(device.lastSeen).toLocaleString('pt-BR')}</li>
              </ul>

              <div className="device-actions">
                <button className="primary" onClick={() => connectToDevice(device.id)}>
                  {device.isConnected ? 'Conectar novamente' : 'Conectar'}
                </button>
                <button className="secondary" onClick={() => disconnectDevice(device.id)}>
                  Desconectar
                </button>
                <button className="ghost" onClick={() => revokeAccess(device.id)}>
                  Revogar
                </button>
              </div>
            </article>
          ))}
        </section>

        <section className="panel-row">
          <div className="remote-panel">
            <div className="panel-header">
              <h3>Visualização remota</h3>
              <div className="connection-indicator">
                <span className={pcRef.current ? 'live' : ''} />
                {pcRef.current ? 'Live' : 'Idle'}
              </div>
            </div>

            <div className="screen-frame">
              {selectedDevice ? (
                <video id="remote-preview" autoPlay playsInline muted />
              ) : (
                <p>Selecione um computador para iniciar a sessão remota.</p>
              )}
            </div>

            <div className="control-bar">
              <button className="primary">Modo tela cheia</button>
              <button className="secondary">Qualidade</button>
              <button className="secondary">Teclado</button>
            </div>
          </div>

          <div className="settings-panel">
            <h3>Configurações</h3>
            <div className="setting">
              <label>Qualidade da transmissão</label>
              <input type="range" min="1" max="100" defaultValue="72" />
            </div>
            <div className="setting">
              <label>Permitir autorizações</label>
              <input type="checkbox" defaultChecked />
            </div>
            <div className="setting">
              <label>Conexão automática</label>
              <input type="checkbox" defaultChecked />
            </div>
            <div className="setting">
              <label>Iniciar com o Windows</label>
              <input type="checkbox" defaultChecked />
            </div>
          </div>
        </section>

        {status && <p className="status-banner">{status}</p>}
      </main>
    </div>
  );
}

export default App;
