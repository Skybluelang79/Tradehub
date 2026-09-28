import { io } from 'socket.io-client';

const SOCKET_URL = window.location.origin;
const SOCKET_DISABLED = import.meta.env.VITE_DISABLE_SOCKET === 'true';

let socket = null;

export function connectSocket(token) {
  if (SOCKET_DISABLED) return null;
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

export function sendMessage(
  conversationId,
  text,
  options = {}
) {
  socket?.emit('send_message', {
    conversationId,
    text,
    encrypted: !!options.encrypted,
    ciphertext: options.ciphertext || null,
    iv: options.iv || null,
    type: options.type || 'text',
    attachments: options.attachments || [],
    replyTo: options.replyTo || null,
  });
}

export function pinMessage(conversationId, messageId) {
  socket?.emit('pin_message', { conversationId, messageId });
}

export function unpinMessage(conversationId, messageId) {
  socket?.emit('pin_message', { conversationId, messageId, pinned: false });
}

export function muteConversation(conversationId) {
  socket?.emit('mute_conversation', { conversationId });
}

export function unmuteConversation(conversationId) {
  socket?.emit('mute_conversation', { conversationId, muted: false });
}

export function blockUser(conversationId, userId) {
  socket?.emit('block_user', { conversationId, userId });
}

export function reportUser(conversationId, reason, description = '') {
  socket?.emit('report_user', { conversationId, reason, description });
}

export function exportConversation(conversationId) {
  socket?.emit('export_conversation', { conversationId });
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

export function callUser(conversationId, kind, callId) {
  socket?.emit('call_user', { conversationId, kind, callId });
}

export function acceptCall(callId) {
  socket?.emit('call_accept', { callId });
}

export function rejectCall(callId) {
  socket?.emit('call_reject', { callId });
}

export function cancelCall(callId) {
  socket?.emit('call_cancel', { callId });
}

export function endCall(callId) {
  socket?.emit('call_end', { callId });
}

export function sendRtcOffer(callId, offer) {
  socket?.emit('rtc_offer', { callId, offer });
}

export function sendRtcAnswer(callId, answer) {
  socket?.emit('rtc_answer', { callId, answer });
}

export function sendRtcIce(callId, candidate) {
  socket?.emit('rtc_ice', { callId, candidate });
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

export function onMessagesRead(callback) {
  socket?.on('messages_read', callback);
  return () => socket?.off('messages_read', callback);
}

export function onMessagesDelivered(callback) {
  socket?.on('messages_delivered', callback);
  return () => socket?.off('messages_delivered', callback);
}

export function onConversationError(callback) {
  socket?.on('conversation_error', callback);
  return () => socket?.off('conversation_error', callback);
}

export function onIncomingCall(callback) {
  socket?.on('incoming_call', callback);
  return () => socket?.off('incoming_call', callback);
}

export function onCallUnavailable(callback) {
  socket?.on('call_unavailable', callback);
  return () => socket?.off('call_unavailable', callback);
}

export function onCallAccepted(callback) {
  socket?.on('call_accepted', callback);
  return () => socket?.off('call_accepted', callback);
}

export function onCallRejected(callback) {
  socket?.on('call_rejected', callback);
  return () => socket?.off('call_rejected', callback);
}

export function onCallCancelled(callback) {
  socket?.on('call_cancelled', callback);
  return () => socket?.off('call_cancelled', callback);
}

export function onCallEnded(callback) {
  socket?.on('call_ended', callback);
  return () => socket?.off('call_ended', callback);
}

export function onRtcOffer(callback) {
  socket?.on('rtc_offer', callback);
  return () => socket?.off('rtc_offer', callback);
}

export function onRtcAnswer(callback) {
  socket?.on('rtc_answer', callback);
  return () => socket?.off('rtc_answer', callback);
}

export function onRtcIce(callback) {
  socket?.on('rtc_ice', callback);
  return () => socket?.off('rtc_ice', callback);
}