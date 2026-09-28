import {
  callUser,
  acceptCall as socketAcceptCall,
  rejectCall as socketRejectCall,
  cancelCall as socketCancelCall,
  endCall as socketEndCall,
  sendRtcOffer,
  sendRtcAnswer,
  sendRtcIce,
} from './socket';

const listeners = new Map();

function emit(event, payload) {
  (listeners.get(event) || []).forEach((callback) => {
    try {
      callback(payload);
    } catch (error) {
      console.error(`webrtc listener '${event}' failed:`, error);
    }
  });
}

export function onCallState(callback) {
  if (!listeners.has('*')) listeners.set('*', []);
  listeners.get('*').push(callback);
  return () => {
    const callbacks = listeners.get('*') || [];
    const index = callbacks.indexOf(callback);
    if (index !== -1) callbacks.splice(index, 1);
  };
}

let rtcConfig = null;
let localStream = null;
const peers = new Map();

function getRtcConfig() {
  if (rtcConfig) return rtcConfig;
  rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
    ],
  };
  return rtcConfig;
}

export async function getLocalStream(audio = true, video = false) {
  if (localStream) {
    if (!video || localStream.getVideoTracks().length > 0) return localStream;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Audio and video calls are not supported in this browser');
  }
  localStream = await navigator.mediaDevices.getUserMedia({ audio, video });
  return localStream;
}

export async function initiateCall(conversationId, { audio = true, video = false, kind = 'audio' } = {}) {
  try {
    await getLocalStream(audio, video);
    const callId = `${conversationId}-${Date.now()}`;
    callUser(conversationId, kind, callId);
    emit('*', { type: 'dialing', callId, conversationId, kind });
    return { callId, localStream };
  } catch (error) {
    emit('*', { type: 'call_error', error: error.message });
    return null;
  }
}

export function acceptCall(callId) {
  socketAcceptCall(callId);
}

export function rejectCall(callId) {
  socketRejectCall(callId);
  emit('*', { type: 'cleared', callId });
}

export function cancelCall(callId) {
  socketCancelCall(callId);
  emit('*', { type: 'cleared', callId });
}

function closePeer(callId) {
  const peer = peers.get(callId);
  if (!peer) return;
  peer.getSenders().forEach((sender) => sender.track?.stop());
  peer.close();
  peers.delete(callId);
}

export function endCall(callId) {
  socketEndCall(callId);
  emit('*', { type: 'cleared', callId });
  closePeer(callId);
}

export function stopLocalStream() {
  localStream?.getTracks().forEach((track) => track.stop());
  localStream = null;
}

async function createPeer(callId, { audio = true, video = false } = {}) {
  if (peers.has(callId)) return peers.get(callId);
  const stream = await getLocalStream(audio, video);
  const peer = new RTCPeerConnection(getRtcConfig());
  stream.getTracks().forEach((track) => peer.addTrack(track, stream));
  peer.onicecandidate = (event) => {
    if (event.candidate) sendRtcIce(callId, event.candidate.toJSON());
  };
  peer.ontrack = (event) => {
    emit('*', { type: 'remote_track', callId, stream: event.streams[0] });
  };
  peer.onconnectionstatechange = () => {
    emit('*', { type: 'connection_state', callId, state: peer.connectionState });
    if (['disconnected', 'failed', 'closed'].includes(peer.connectionState)) {
      closePeer(callId);
    }
  };
  peers.set(callId, peer);
  return peer;
}

export async function createOffer(callId, options = {}) {
  try {
    const peer = await createPeer(callId, options);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    sendRtcOffer(callId, peer.localDescription);
    emit('*', { type: 'offer_created', callId });
  } catch (error) {
    emit('*', { type: 'call_error', callId, error: error.message });
  }
}

export async function handleRtcOffer({ callId, offer, kind } = {}) {
  if (!callId || !offer) return;
  try {
    const peer = await createPeer(callId, { audio: kind !== 'video', video: kind === 'video' });
    await peer.setRemoteDescription(offer);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    sendRtcAnswer(callId, peer.localDescription);
    emit('*', { type: 'answer_created', callId });
  } catch (error) {
    emit('*', { type: 'call_error', callId, error: error.message });
  }
}

export async function handleRtcAnswer({ callId, answer } = {}) {
  if (!callId || !answer) return;
  const peer = peers.get(callId);
  if (!peer) return;
  try {
    await peer.setRemoteDescription(answer);
    emit('*', { type: 'connected', callId });
  } catch (error) {
    emit('*', { type: 'call_error', callId, error: error.message });
  }
}

export async function handleRtcIce({ callId, candidate } = {}) {
  if (!callId || !candidate) return;
  const peer = peers.get(callId);
  if (!peer) return;
  try {
    await peer.addIceCandidate(candidate);
  } catch (error) {
    emit('*', { type: 'ice_error', callId, error: error.message });
  }
}

export function getPeer(callId) {
  return peers.get(callId) || null;
}
