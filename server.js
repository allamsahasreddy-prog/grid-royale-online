'use strict';

const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 25000,
  pingTimeout: 20000,
  maxHttpBufferSize: 1e5,
});

const PORT = Number(process.env.PORT) || 10000;
const rooms = new Map();
const WIN_LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_TTL_MS = 2 * 60 * 1000;

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/healthz', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

function newCode() {
  let code;
  do {
    code = Array.from({ length: 6 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}
function newToken() { return crypto.randomBytes(24).toString('hex'); }
function cleanName(value, fallback) {
  const name = String(value || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 18);
  return name || fallback;
}
function emptyState() {
  return {
    board: Array(9).fill(''),
    megaBoard: Array.from({ length: 9 }, () => Array(9).fill('')),
    megaStatus: Array(9).fill(''),
    activeMiniBoard: null,
    currentPlayer: 'X',
    gameActive: true,
    winner: null,
    winningLine: null,
    metaWinningLine: null,
    moveCount: 0,
    currentMoves: [],
    startTime: Date.now(),
    endTime: null,
    lastMoveTimestamp: Date.now(),
    totalMoveTime: 0,
    scores: { X: 0, O: 0, draw: 0 },
  };
}
function findWinningLine(state) {
  for (const line of WIN_LINES) {
    const [a,b,c] = line;
    if ((state[a] === 'X' || state[a] === 'O') && state[a] === state[b] && state[b] === state[c]) return line;
  }
  return null;
}
function snapshot(room) {
  return JSON.parse(JSON.stringify({
    state: room.state,
    history: room.history,
    lastMovePlayer: room.lastMovePlayer,
  }));
}
function restore(room, saved) {
  room.state = saved.state;
  room.history = saved.history;
  room.lastMovePlayer = saved.lastMovePlayer;
}
function seatForSocket(room, socketId) {
  for (const mark of ['X', 'O']) {
    if (room.players[mark]?.socketId === socketId) return mark;
  }
  return null;
}
function publicRoom(room, viewer) {
  const last = room.history[room.history.length - 1];
  return {
    code: room.code,
    gameType: room.gameType,
    hostPlayer: room.hostPlayer,
    players: {
      X: room.players.X ? { name: room.players.X.name, connected: Boolean(room.players.X.socketId) } : null,
      O: room.players.O ? { name: room.players.O.name, connected: Boolean(room.players.O.socketId) } : null,
    },
    ...room.state,
    canUndo: Boolean(last && last.actor === viewer),
    lastMovePlayer: room.lastMovePlayer,
  };
}
function broadcastRoom(room) {
  for (const mark of ['X', 'O']) {
    const player = room.players[mark];
    if (player?.socketId) io.to(player.socketId).emit('room:state', publicRoom(room, mark));
  }
}
function sendError(socket, message) { socket.emit('room:error', { message }); }
function clearExpiry(room) {
  if (room.expiryTimer) clearTimeout(room.expiryTimer);
  room.expiryTimer = null;
}
function scheduleExpiry(room) {
  clearExpiry(room);
  room.expiryTimer = setTimeout(() => {
    if (!room.players.X?.socketId && !room.players.O?.socketId) {
      io.to(room.code).emit('room:closed', { message: 'This room expired because both players disconnected.' });
      rooms.delete(room.code);
    }
  }, ROOM_TTL_MS);
  room.expiryTimer.unref?.();
}
function joined(socket, room, mark) {
  const player = room.players[mark];
  socket.join(room.code);
  socket.emit('room:joined', {
    code: room.code,
    player: mark,
    token: player.token,
    host: mark === room.hostPlayer,
    gameType: room.gameType,
    invitePath: `/?room=${room.code}`,
  });
  broadcastRoom(room);
}
function finishRoom(room, winner) {
  const state = room.state;
  if (!state.gameActive) return;
  state.gameActive = false;
  state.winner = winner;
  state.endTime = Date.now();
  if (winner === 'draw') state.scores.draw += 1;
  else state.scores[winner] += 1;
}
function resetRound(room) {
  const previousScores = room.state.scores;
  room.state = emptyState();
  room.state.scores = previousScores;
  room.history = [];
  room.lastMovePlayer = null;
}

io.on('connection', socket => {
  socket.on('room:create', payload => {
    const gameType = payload?.gameType === 'ultimate' ? 'ultimate' : 'normal';
    const code = newCode();
    const room = {
      code,
      gameType,
      hostPlayer: 'X',
      players: {
        X: { name: cleanName(payload?.name, 'Player X'), token: newToken(), socketId: socket.id },
        O: null,
      },
      state: emptyState(),
      history: [],
      lastMovePlayer: null,
      expiryTimer: null,
    };
    rooms.set(code, room);
    joined(socket, room, 'X');
  });

  socket.on('room:join', payload => {
    const code = String(payload?.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const room = rooms.get(code);
    if (!room) return sendError(socket, 'Room not found. Check the code and try again.');
    if (room.players.O) return sendError(socket, 'This room already has two players. Ask your friend to create a new room.');
    room.players.O = { name: cleanName(payload?.name, 'Player O'), token: newToken(), socketId: socket.id };
    clearExpiry(room);
    joined(socket, room, 'O');
  });

  socket.on('room:resume', payload => {
    const code = String(payload?.code || '').toUpperCase().slice(0, 6);
    const room = rooms.get(code);
    if (!room) return sendError(socket, 'That room is no longer available. Create a new room.');
    const mark = ['X', 'O'].find(m => room.players[m]?.token === payload?.token);
    if (!mark) return sendError(socket, 'Your room session could not be verified. Rejoin with the room code.');
    const player = room.players[mark];
    if (player.socketId && player.socketId !== socket.id) {
      const oldSocket = io.sockets.sockets.get(player.socketId);
      oldSocket?.disconnect(true);
    }
    player.socketId = socket.id;
    clearExpiry(room);
    joined(socket, room, mark);
  });

  socket.on('room:move', payload => {
    const room = rooms.get(String(payload?.code || '').toUpperCase());
    if (!room) return sendError(socket, 'Room not found.');
    const actor = seatForSocket(room, socket.id);
    const s = room.state;
    if (!actor || !s.gameActive || actor !== s.currentPlayer) return;
    if (!room.players.X?.socketId || !room.players.O?.socketId) return sendError(socket, 'Wait until both players are connected before moving.');

    const boardIndex = room.gameType === 'normal' ? null : Number(payload?.boardIndex);
    const cellIndex = Number(payload?.cellIndex);
    if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex > 8) return;
    if (room.gameType === 'normal') {
      if (s.board[cellIndex] !== '') return;
    } else {
      if (!Number.isInteger(boardIndex) || boardIndex < 0 || boardIndex > 8) return;
      if (s.megaStatus[boardIndex] !== '' || s.megaBoard[boardIndex][cellIndex] !== '') return;
      if (s.activeMiniBoard !== null && s.megaStatus[s.activeMiniBoard] === '' && boardIndex !== s.activeMiniBoard) return;
    }

    room.history.push({ state: JSON.parse(JSON.stringify(s)), actor });
    const moveTime = Date.now();
    s.totalMoveTime += Math.max(0, moveTime - s.lastMoveTimestamp);
    s.lastMoveTimestamp = moveTime;
    room.lastMovePlayer = actor;
    if (room.gameType === 'normal') {
      s.board[cellIndex] = actor;
      s.moveCount += 1;
      s.currentMoves.push(`${actor} → ${cellIndex + 1}`);
      s.winningLine = findWinningLine(s.board);
      if (s.winningLine) finishRoom(room, actor);
      else if (!s.board.includes('')) finishRoom(room, 'draw');
    } else {
      s.megaBoard[boardIndex][cellIndex] = actor;
      s.moveCount += 1;
      s.currentMoves.push(`${actor} → board ${boardIndex + 1}, cell ${cellIndex + 1}`);
      const localWin = findWinningLine(s.megaBoard[boardIndex]);
      if (localWin) s.megaStatus[boardIndex] = actor;
      else if (!s.megaBoard[boardIndex].includes('')) s.megaStatus[boardIndex] = 'draw';
      s.metaWinningLine = findWinningLine(s.megaStatus);
      if (s.metaWinningLine) finishRoom(room, actor);
      else if (s.megaStatus.every(status => status !== '')) finishRoom(room, 'draw');
      else s.activeMiniBoard = s.megaStatus[cellIndex] === '' ? cellIndex : null;
    }
    if (s.gameActive) s.currentPlayer = actor === 'X' ? 'O' : 'X';
    broadcastRoom(room);
  });

  socket.on('room:undo', payload => {
    const room = rooms.get(String(payload?.code || '').toUpperCase());
    if (!room) return sendError(socket, 'Room not found.');
    const actor = seatForSocket(room, socket.id);
    const last = room.history[room.history.length - 1];
    if (!actor || !last || last.actor !== actor) return sendError(socket, 'You can only undo your most recent move before your friend moves.');
    room.history.pop();
    room.state = last.state;
    room.lastMovePlayer = room.history.length ? room.history[room.history.length - 1].actor : null;
    broadcastRoom(room);
  });

  socket.on('room:new-round', payload => {
    const room = rooms.get(String(payload?.code || '').toUpperCase());
    if (!room) return sendError(socket, 'Room not found.');
    const actor = seatForSocket(room, socket.id);
    if (actor !== room.hostPlayer) return sendError(socket, 'Only the room creator can start the next round.');
    resetRound(room);
    broadcastRoom(room);
  });

  socket.on('room:leave', payload => {
    const room = rooms.get(String(payload?.code || '').toUpperCase());
    if (!room) return;
    const actor = seatForSocket(room, socket.id);
    if (!actor) return;
    if (actor === room.hostPlayer) {
      io.to(room.code).emit('room:closed', { message: 'The room creator closed this room.' });
      clearExpiry(room);
      rooms.delete(room.code);
    } else {
      room.players[actor] = null;
      socket.leave(room.code);
      broadcastRoom(room);
      if (!room.players.X?.socketId && !room.players.O?.socketId) scheduleExpiry(room);
    }
  });

  socket.on('disconnect', () => {
    for (const room of rooms.values()) {
      const mark = seatForSocket(room, socket.id);
      if (!mark) continue;
      room.players[mark].socketId = null;
      broadcastRoom(room);
      if (!room.players.X?.socketId && !room.players.O?.socketId) scheduleExpiry(room);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Grid Royale is running on port ${PORT}`);
});
