# KZ Remote PC

Sistema profissional de acesso remoto para Windows com painel web em React, backend Node.js e cliente Windows para registro e autorização.

## Visão geral

- Login e cadastro com e-mail/senha e Google
- Lista de computadores vinculados ao usuário
- Detecção de conexão online/offline
- WebRTC e sinalização em tempo real
- Cliente Windows para registrar o PC e autorizar acesso
- Dashboard responsivo para celular e desktop
- Preparado para publicação na Vercel

## Estrutura

- `apps/web`: painel React (frontend)
- `apps/server`: API e sinalização WebSocket
- `apps/windows-agent`: cliente para Windows com Electron

## Instalação

```bash
npm install
```

## Execução local

```bash
npm run dev:server
npm run dev:web
```

Alternativamente:

```bash
npm run dev
```

## Produção

```bash
npm run build:web
npm run build:server
```

## Publicação na Vercel

1. Conecte o repositório à Vercel
2. Defina a pasta de saída como `apps/web`
3. Use o comando de build do Vite: `npm run build`
4. Configure as variáveis de ambiente para a API de backend

## Windows agent

```bash
npm --workspace apps/windows-agent run build:win
```

## Segurança

- Tokens JWT para autenticação do painel web
- Autorização de computador pelo proprietário
- Controle de conexão e revogação de acesso
- Sinalização WebSocket para troca de ofertas/answers ICE

## Observação

Este repositório oferece uma base funcional real de desenvolvimento, com autenticação local, gerenciamento de dispositivos e sinalização de conexão. Para uso em produção, configure Supabase/Firebase e STUN/TURN com credenciais reais.
