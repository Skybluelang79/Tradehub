import { io } from 'socket.io-client';

const SOCKET_URL = window.location.origin;

let socket = null;

export function connectSocket(token) {
  if (socket?.connected) return socket;

  socket = io(SOCKET_URL, {
    auth: { token },
    transports: ['websocket', 'polling'],
  });

  socket.on('connect', () => {
    console.log('Socket connected');
  });

  socket.on('connect_error', (err) => {
    console.error('Socket connection error:', err.message);
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function getSocket() {
  return socket;
}

export function joinConversation(conversationId) {
  socket?.emit('join_conversation', conversationId);
}

export function leaveConversation(conversationId) {
  socket?.emit('leave_conversation', conversationId);
}

export function sendMessage(conversationId, text, encrypted = false, ciphertext = null, iv = null) {
  socket?.emit('send_message', { conversationId, text, encrypted, ciphertext, iv });
}

export function startTyping(conversationId) {
  socket?.emit('typing_start', conversationId);
}

export function stopTyping(conversationId) {
  socket?.emit('typing_stop', conversationId);
}

export function markRead(conversationId) {
  socket?.emit('mark_read', conversationId);
}

export function onNewMessage(callback) {
  socket?.on('new_message', callback);
  return () => socket?.off('new_message', callback);
}

export function onMessageNotification(callback) {
  socket?.on('message_notification', callback);
  return () => socket?.off('message_notification', callback);
}

export function onUserTyping(callback) {
  socket?.on('user_typing', callback);
  return () => socket?.off('user_typing', callback);
}

export function onStopTyping(callback) {
  socket?.on('user_stop_typing', callback);
  return () => socket?.off('user_stop_typing', callback);
}

export function onOnlineUsers(callback) {
  socket?.on('online_users', callback);
  return () => socket?.off('online_users', callback);
}
