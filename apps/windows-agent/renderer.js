const API_URL = 'http://localhost:4001/api';
const WS_URL = 'ws://localhost:4001';

const statusPill = document.getElementById('status-pill');
const signalDot = document.getElementById('signal-dot');
const deviceIdLabel = document.getElementById('device-id-label');
const ownerLabel = document.getElementById('owner-label');
const lastAction = document.getElementById('last-action');
const localScreen = document.getElementById('local-screen');

let deviceId = localStorage.getItem('kz-device-id');
let socket = null;
let peerConnection = null;
let currentOwnerId = null;

const token = localStorage.getItem('kz-agent-token');

function updateStatus(label, connected = false) {
  statusPill.textContent = label;
  statusPill.classList.toggle('active', connected);
  signalDot.classList.toggle('online', connected);
}

async function apiFetch(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(localStorage.getItem('kz-agent-token') ? { Authorization: `Bearer ${localStorage.getItem('kz-agent-token')}` } : {}),
    },
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Erro na API');
  return data;
}

async function registerDevice() {
  const name = document.getElementById('device-name').value.trim() || 'Meu PC principal';
  const os = document.getElementById('device-os').value.trim() || 'Windows 11 Pro';

  try {
    const auth = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'demo@kzremote.com', password: 'demo123' }),
    });

    localStorage.setItem('kz-agent-token', auth.token);
    localStorage.setItem('kz-agent-user', JSON.stringify(auth.user));

    const response = await apiFetch('/devices/register', {
      method: 'POST',
      body: JSON.stringify({ name, os }),
    });

    deviceId = response.device.id;
    localStorage.setItem('kz-device-id', deviceId);
    deviceIdLabel.textContent = deviceId;
    lastAction.textContent = 'Computador registrado';
    updateStatus('Online', true);
    connectSocket();
  } catch (error) {
    lastAction.textContent = error.message;
    console.error(error);
  }
}

function connectSocket() {
  if (!deviceId) return;

  socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    updateStatus('Conectado', true);
    socket.send(JSON.stringify({ type: 'register', role: 'agent', deviceId, userId: JSON.parse(localStorage.getItem('kz-agent-user') || '{}').id || 'demo-user' }));
    lastAction.textContent = 'Sinalização ativa';
  };

  socket.onmessage = async (event) => {
    try {
      const message = JSON.parse(event.data);

      if (message.type === 'signal') {
        const { signal, sourceRole, deviceId: remoteDeviceId } = message;

        if (!peerConnection) {
          peerConnection = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
          });

          peerConnection.onicecandidate = (event) => {
            if (event.candidate && socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({
                type: 'signal',
                targetDeviceId: remoteDeviceId,
                signal: { type: 'candidate', candidate: event.candidate },
              }));
            }
          };

          peerConnection.ontrack = (event) => {
            const stream = event.streams[0];
            if (stream) {
              localScreen.innerHTML = '';
              const video = document.createElement('video');
              video.srcObject = stream;
              video.autoplay = true;
              video.playsInline = true;
              video.muted = true;
              video.style.width = '100%';
              video.style.height = '100%';
              video.style.objectFit = 'cover';
              video.style.borderRadius = '12px';
              localScreen.appendChild(video);
            }
          };
        }

        if (signal.type === 'offer') {
          ownerLabel.textContent = 'Cliente conectado';
          lastAction.textContent = 'Oferta recebida';
          await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          socket.send(JSON.stringify({
            type: 'signal',
            targetDeviceId: remoteDeviceId,
            signal: { type: 'answer', sdp: answer.sdp },
          }));
          currentOwnerId = 'demo-user';
          lastAction.textContent = 'Resposta enviada';
        }

        if (signal.type === 'candidate') {
          if (signal.candidate) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
          }
        }
      }
    } catch (error) {
      console.error('WS message error', error);
    }
  };

  socket.onclose = () => {
    updateStatus('Offline', false);
    lastAction.textContent = 'Conexão encerrada';
  };
}

document.getElementById('register-btn').addEventListener('click', registerDevice);
document.getElementById('start-btn').addEventListener('click', async () => {
  const device = document.getElementById('device-name').value.trim() || 'Meu PC principal';
  const os = document.getElementById('device-os').value.trim() || 'Windows 11 Pro';

  if (!deviceId) {
    await registerDevice();
  }

  try {
    await apiFetch(`/devices/${deviceId}/authorize`, { method: 'POST' });
    lastAction.textContent = 'Acesso autorizado';
    updateStatus('Conectado', true);
    connectSocket();
  } catch (error) {
    lastAction.textContent = error.message;
  }
});

document.getElementById('disconnect-btn').addEventListener('click', async () => {
  if (deviceId) {
    try {
      await apiFetch(`/devices/${deviceId}/disconnect`, { method: 'POST' });
      lastAction.textContent = 'Desconectado';
      if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
      }
      if (socket) {
        socket.close();
      }
      updateStatus('Offline', false);
    } catch (error) {
      lastAction.textContent = error.message;
    }
  }
});

if (deviceId) {
  deviceIdLabel.textContent = deviceId;
  updateStatus('Conectado', true);
  connectSocket();
}
