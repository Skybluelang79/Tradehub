import { useState, useEffect, useRef } from 'react';
import { Avatar } from '../../components/ui';
import {
  onIncomingCall,
  onCallUnavailable,
  onCallAccepted,
  onCallRejected,
  onCallCancelled,
  onCallEnded,
  onRtcOffer,
  onRtcAnswer,
  onRtcIce,
} from '../../services/socket';
import {
  onCallState,
  getLocalStream,
  getPeer,
  createOffer,
  handleRtcOffer,
  handleRtcAnswer,
  handleRtcIce,
  acceptCall,
  rejectCall,
  cancelCall,
  endCall,
  stopLocalStream,
} from '../../services/webrtc';

const PhoneIcon = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

const VideoIcon = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="23 7 16 12 23 17 23 7" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </svg>
);

const VideoOffIcon = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

const MicIcon = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
  </svg>
);

const MicOffIcon = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="1" y1="1" x2="23" y2="23" />
    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
    <line x1="12" y1="19" x2="12" y2="23" />
  </svg>
);

const CallEndIcon = ({ size = 26 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

const XIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="18" x2="18" y2="6" />
  </svg>
);

const STATUS_TEXT = {
  dialing: 'Calling…',
  accepted: 'Connected',
  incoming: 'Incoming call…',
  peers: 'Connecting media…',
  ended: 'Call ended',
  unavailable: 'User unavailable',
};

export default function CallOverlay({ conversationId, callId, otherUser, isInitiator = false, onClose }) {
  const [status, setStatus] = useState(isInitiator ? 'dialing' : 'incoming');
  const [callKind, setCallKind] = useState('audio');
  const [peerStream, setPeerStream] = useState(null);
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(true);
  const [timer, setTimer] = useState(0);
  const timerRef = useRef(null);
  const videoRef = useRef(null);
  const callKindRef = useRef(callKind);
  const closedRef = useRef(false);

  useEffect(() => {
    callKindRef.current = callKind;
  }, [callKind]);

  useEffect(() => {
    const offState = onCallState((event) => {
      if (!event || (event.callId && callId && event.callId !== callId)) return;
      if (event.type === 'remote_track' && event.stream) setPeerStream(event.stream);
      if (event.type === 'call_error') setStatus('ended');
      if (event.type === 'connected') setStatus('accepted');
      if (event.type === 'connection_state' && event.state === 'connected') setStatus('accepted');
      if (event.type === 'cleared') setStatus('ended');
    });
    return offState;
  }, [callId]);

  useEffect(() => {
    if (status === 'accepted' || status === 'peers') {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => setTimer((value) => value + 1), 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status]);

  useEffect(() => {
    if (peerStream && videoRef.current) {
      videoRef.current.srcObject = peerStream;
      videoRef.current.play().catch(() => {});
    }
  }, [peerStream]);

  useEffect(() => {
    const matches = (event) => !event?.conversationId || event.conversationId === conversationId;
    const offs = [
      onIncomingCall((event) => {
        if (!matches(event)) return;
        setCallKind(event.kind === 'video' ? 'video' : 'audio');
        setVideoOff(event.kind !== 'video');
        setStatus('incoming');
      }),
      onCallUnavailable((event) => {
        if (!matches(event)) return;
        setStatus('unavailable');
      }),
      onCallAccepted((event) => {
        if (!matches(event)) return;
        setStatus('peers');
        if (isInitiator) {
          createOffer(callId, { audio: callKindRef.current !== 'video', video: callKindRef.current === 'video' });
        }
      }),
      onCallRejected((event) => {
        if (matches(event)) setStatus('ended');
      }),
      onCallCancelled((event) => {
        if (matches(event)) setStatus('ended');
      }),
      onCallEnded((event) => {
        if (matches(event)) setStatus('ended');
      }),
      onRtcOffer((event) => {
        if (!matches(event) || event.callId !== callId) return;
        setStatus('peers');
        handleRtcOffer({ ...event, kind: callKindRef.current });
      }),
      onRtcAnswer((event) => {
        if (!matches(event) || event.callId !== callId) return;
        handleRtcAnswer(event);
      }),
      onRtcIce((event) => {
        if (!matches(event) || event.callId !== callId) return;
        handleRtcIce(event);
      }),
    ];
    return () => offs.forEach((off) => off?.());
  }, [callId, conversationId, isInitiator]);

  useEffect(() => {
    if (status !== 'ended' && status !== 'unavailable') return undefined;
    const timeout = setTimeout(() => {
      if (!closedRef.current) {
        closedRef.current = true;
        onClose?.();
      }
    }, 1600);
    return () => clearTimeout(timeout);
  }, [status, onClose]);

  const toggleMute = async () => {
    const next = !muted;
    setMuted(next);
    try {
      const stream = await getLocalStream(true, callKindRef.current === 'video');
      stream.getAudioTracks().forEach((track) => { track.enabled = !next; });
    } catch {}
  };

  const toggleVideo = async () => {
    const next = !videoOff;
    setVideoOff(next);
    try {
      const stream = await getLocalStream(true, !next);
      const peer = getPeer(callId);
      stream.getVideoTracks().forEach((track) => {
        track.enabled = !next;
        if (peer && !next && !peer.getSenders().some((sender) => sender.track === track)) {
          peer.addTrack(track, stream);
        }
      });
    } catch {}
  };

  const accept = () => {
    acceptCall(callId);
    setStatus('peers');
  };

  const decline = () => {
    if (isInitiator) cancelCall(callId);
    else rejectCall(callId);
    setStatus('ended');
  };

  const hangUp = () => {
    endCall(callId);
    stopLocalStream();
    setStatus('ended');
    closedRef.current = true;
    onClose?.();
  };

  const formatDuration = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const isActive = status === 'accepted' || status === 'peers' || status === 'dialing';
  const displayName = otherUser?.name || 'Tradehub Call';

  return (
    <div className="call-overlay" data-status={status}>
      <div className="call-overlay-backdrop" />
      {peerStream ? (
        <video ref={videoRef} className="call-remote-video" muted playsInline autoPlay />
      ) : (
        <div className="call-avatar">
          <Avatar initial={displayName?.[0] || '?'} size="xl" />
        </div>
      )}
      <div className="call-info">
        <div className="call-name">{displayName}</div>
        <div className="call-status">
          {status === 'unavailable' ? STATUS_TEXT.unavailable :
            status === 'ended' ? STATUS_TEXT.ended :
            isActive && timer > 0 ? formatDuration(timer) : STATUS_TEXT[status] || status}
        </div>
      </div>
      {status === 'incoming' && (
        <div className="call-actions">
          <button className="call-action call-action--accept" onClick={accept} aria-label="Accept call">
            <PhoneIcon size={24} />
          </button>
          <button className="call-action call-action--decline" onClick={decline} aria-label="Decline">
            <CallEndIcon size={24} />
          </button>
        </div>
      )}
      {isActive && (
        <div className="call-controls">
          <button className={`call-control ${muted ? 'active' : ''}`} onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
            {muted ? <MicOffIcon size={22} /> : <MicIcon size={22} />}
          </button>
          <button className={`call-control ${videoOff ? 'active' : ''}`} onClick={toggleVideo} aria-label={videoOff ? 'Enable video' : 'Disable video'}>
            {videoOff ? <VideoOffIcon size={22} /> : <VideoIcon size={22} />}
          </button>
          <button className="call-control call-control--end" onClick={hangUp} aria-label="End call">
            <CallEndIcon size={26} />
          </button>
        </div>
      )}
      <button className="call-close" onClick={hangUp} aria-label="Close">
        <XIcon size={18} />
      </button>
    </div>
  );
}
