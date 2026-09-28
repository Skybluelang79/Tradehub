import { useState, useRef, useEffect, useCallback } from 'react';
import { Header } from '../components/layout';
import { Avatar } from '../components/ui';
import { useToast } from '../components/ui/Toast';
import { ArrowLeftIcon, SendIcon, ShieldIcon } from '../components/ui/Icons';
import EncryptionBadge from '../components/features/EncryptionBadge';
import EmojiPicker from '../components/ui/EmojiPicker';
import { useApp } from '../context';
import { useAuth } from '../context/AuthContext';
import { useEncryption } from '../context/EncryptionContext';
import api, { getToken } from '../services/client';
import { onCallState as watchCallState, initiateCall } from '../services/webrtc';
import CallOverlay from '../components/window/CallOverlay';

// Local inline icons (self-contained; avoids dependence on the ui/Icons surface)
const SmileIcon = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M8 14s1.5 2 4 2 4-2 4-2" />
    <line x1="9" y1="9" x2="9.01" y2="9" />
    <line x1="15" y1="9" x2="15.01" y2="9" />
  </svg>
);

const FileIcon = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

const PaperclipIcon = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

const XIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
import {
  connectSocket,
  disconnectSocket,
  joinConversation,
  leaveConversation,
  sendMessage as socketSendMessage,
  startTyping,
  stopTyping,
  markRead,
  onNewMessage,
  onUserTyping,
  onStopTyping,
  onOnlineUsers,
} from '../services/socket';
import { formatDate, formatTime, formatPrice } from '../utils/helpers';
import '../styles/globals.css';
import './Chat.css';

function formatDayLabel(date) {
  const now = new Date();
  const d = new Date(date);
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (start === startToday) return 'Today';
  if (start === startToday - 86400000) return 'Yesterday';
  return formatDate(date);
}

const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf', 'txt', 'doc', 'docx', 'xls', 'xlsx', 'zip', 'rar', '7z', 'mp3', 'm4a', 'wav', 'ogg', 'mp4', 'mov', 'webm'];

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function DownloadIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function AudioIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

function AttachmentView({ att }) {
  const [open, setOpen] = useState(false);
  const kind = att.kind || 'document';
  const isImg = kind === 'image' || /\.(jpe?g|png|gif|webp)$/i.test(att.filename || '');
  const isVideo = kind === 'video' || /\.(mp4|mov|webm)$/i.test(att.filename || '');
  const isAudio = kind === 'audio' || /\.(mp3|m4a|wav|ogg|opus)$/i.test(att.filename || '');

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (isImg) {
    return (
      <>
        <button type="button" className="att-image" onClick={() => setOpen(true)} aria-label={`View ${att.filename}`}>
          <img src={att.url} alt={att.filename || 'Attachment'} loading="lazy" />
        </button>
        {open && (
          <div className="att-lightbox" onClick={() => setOpen(false)} role="dialog" aria-modal="true">
            <button type="button" className="att-lightbox-close" onClick={() => setOpen(false)} aria-label="Close">
              <XIcon size={20} />
            </button>
            <img src={att.url} alt={att.filename || 'Attachment'} onClick={(e) => e.stopPropagation()} />
            <div className="att-lightbox-meta" onClick={(e) => e.stopPropagation()}>
              {att.filename} · {formatBytes(att.size)}
            </div>
          </div>
        )}
      </>
    );
  }

  if (isVideo) {
    return (
      <div className="att-video-wrap">
        <video src={att.url} controls preload="metadata" />
      </div>
    );
  }

  if (isAudio) {
    return (
      <div className="att-audio">
        <span className="att-audio-icon"><AudioIcon size={18} /></span>
        <div className="att-audio-body">
          <div className="att-audio-name">{att.filename || 'Voice note'}</div>
          <audio src={att.url} controls preload="metadata" />
        </div>
      </div>
    );
  }

  return (
    <a className="att-file" href={att.url} download={att.filename || true} target="_blank" rel="noreferrer">
      <span className="att-file-icon"><FileIcon size={20} /></span>
      <span className="att-file-body">
        <span className="att-file-name">{att.filename || 'Attachment'}</span>
        <span className="att-file-size">{formatBytes(att.size)}</span>
      </span>
      <span className="att-file-dl"><DownloadIcon size={16} /></span>
    </a>
  );
}

function mapServerMessage(m) {
  return {
    id: m.id,
    senderId: m.sender_id,
    text: m.text,
    type: m.type || 'text',
    time: m.created_at || m.time,
    read: !!m.read,
    delivered: !!m.delivered,
    encrypted: !!m.encrypted,
    ciphertext: m.ciphertext,
    iv: m.iv,
    attachments: m.attachments || [],
    replyTo: m.reply_to || null,
  };
}

export default function Chat() {
  const {
    conversations,
    messages,
    selectedConversation,
    setSelectedConversation,
    setActiveTab,
    sendMessage,
    hydrateMessages,
    markConversationRead,
    getUser,
    items,
  } = useApp();
  const { user, isAuthenticated } = useAuth();
  const { addToast } = useToast();
  const {
    getOrCreateKeyPair,
    initConversationEncryption,
    encrypt,
    isConversationEncrypted,
    getFingerprint,
    trustKey,
    isKeyTrusted,
  } = useEncryption();

  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const chatScrollRef = useRef(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [convSearch, setConvSearch] = useState('');
  const [encInitializing, setEncInitializing] = useState(false);
  const [encReady, setEncReady] = useState(false);
  const [typingUsers, setTypingUsers] = useState({});
  const [onlineUserIds, setOnlineUserIds] = useState([]);
  const typingTimeoutRef = useRef(null);
  const isTypingRef = useRef(false);
  const prevConvRef = useRef(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [activeCallId, setActiveCallId] = useState(null);
  const [activeCallInitiator, setActiveCallInitiator] = useState(false);
  const [activeCallConversation, setActiveCallConversation] = useState(null);

  const handleCallStart = async () => {
    if (!selectedConversation) return;
    try {
      const { callId } = await initiateCall(selectedConversation, { audio: true, video: false, kind: 'audio' });
      setActiveCallId(callId);
      setActiveCallInitiator(true);
      setActiveCallConversation(selectedConversation);
      setCallOpen(true);
    } catch (err) {
      console.error('Failed to start call', err);
    }
  };

  useEffect(() => {
    const off = watchCallState((evt) => {
      if (!evt || typeof evt.type !== 'string') return;
      const isIncoming = /incoming|offer|request/i.test(evt.type) && !/dial|outgoing|local/i.test(evt.type);
      if (isIncoming) {
        if (evt.callId) setActiveCallId(evt.callId);
        setCallOpen(true);
      } else if (/end|close|reject|canceled|cancel|error/i.test(evt.type)) {
        setCallOpen(false);
      }
    });
    return off;
  }, []);

  const handleEmojiPick = useCallback((emoji) => {
    setInputText((prev) => prev + emoji);
    setEmojiPickerOpen(false);
    inputRef.current?.focus();
  }, []);

  const fileInputRef = useRef(null);
  const [pendingAttachments, setPendingAttachments] = useState([]);

  const handleFilesPick = useCallback((e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const accepted = [];
    let rejected = 0;
    for (const file of files) {
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      if (file.size > MAX_ATTACHMENT_BYTES) { rejected++; continue; }
      if (!file.type.startsWith('image/') && !file.type.startsWith('audio/') && !ALLOWED_EXT.includes(ext)) {
        rejected++;
        continue;
      }
      accepted.push({
        id: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        isImage: (file.type || '').startsWith('image/'),
        isAudio: (file.type || '').startsWith('audio/'),
        preview: URL.createObjectURL(file),
        file,
      });
    }
    if (rejected > 0) addToast(`${rejected} file(s) skipped — max 20MB, unsupported type`, 'error');
    if (accepted.length > 0) {
      setPendingAttachments((prev) => {
        const room = MAX_ATTACHMENTS - prev.length;
        if (room <= 0) return prev;
        if (accepted.length > room) addToast(`Only ${MAX_ATTACHMENTS} files per message`, 'error');
        return [...prev, ...accepted.slice(0, room)];
      });
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [addToast]);

  const removePendingAttachment = useCallback((idx) => {
    setPendingAttachments((prev) => {
      const next = [...prev];
      const removed = next.splice(idx, 1);
      removed.forEach((a) => {
        if (a.preview) URL.revokeObjectURL(a.preview);
      });
      return next;
    });
  }, []);


  const currentUserId = user?.id;

  // Connect socket on mount
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    const token = getToken();
    if (!token) return;

    connectSocket(token);

    const cleanupNewMsg = onNewMessage((message) => {
      // Dispatch a custom event so AppContext can handle it
      window.dispatchEvent(new CustomEvent('socket_new_message', { detail: message }));
    });

    const cleanupTyping = onUserTyping(({ userId, name }) => {
      setTypingUsers((prev) => ({ ...prev, [userId]: { name, time: Date.now() } }));
    });

    const cleanupStopTyping = onStopTyping(({ userId }) => {
      setTypingUsers((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    });

    const cleanupOnline = onOnlineUsers((ids) => {
      setOnlineUserIds(ids);
    });

    return () => {
      cleanupNewMsg();
      cleanupTyping();
      cleanupStopTyping();
      cleanupOnline();
      disconnectSocket();
    };
  }, [isAuthenticated, user]);

  // Listen for socket messages and add to AppContext
  useEffect(() => {
    const handler = (e) => {
      const message = e.detail;
      // Add message to AppContext messages state
      window.dispatchEvent(new CustomEvent('app_add_message', {
        detail: {
          conversationId: message.conversation_id,
          message: mapServerMessage(message),
        },
      }));
    };
    window.addEventListener('socket_new_message', handler);
    return () => window.removeEventListener('socket_new_message', handler);
  }, []);

  // Join/leave conversation rooms
  useEffect(() => {
    if (prevConvRef.current && prevConvRef.current !== selectedConversation) {
      leaveConversation(prevConvRef.current);
    }
    if (selectedConversation) {
      joinConversation(selectedConversation);
      prevConvRef.current = selectedConversation;
    } else {
      prevConvRef.current = null;
    }
  }, [selectedConversation]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setShowScrollBtn(false);
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, selectedConversation]);

  useEffect(() => {
    if (selectedConversation) {
      markConversationRead(selectedConversation);
      markRead(selectedConversation);
    }
  }, [selectedConversation, markConversationRead]);

  // Load chat history from the server when a conversation is opened
  useEffect(() => {
    if (!selectedConversation || !isAuthenticated) return;
    let cancelled = false;
    setHistoryLoading(true);
    api.chat.messages(selectedConversation)
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data?.messages) ? data.messages : [];
        hydrateMessages(selectedConversation, list.map(mapServerMessage));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedConversation, isAuthenticated, hydrateMessages]);

  // Encryption init
  useEffect(() => {
    if (!selectedConversation || !currentUserId) {
      setEncReady(false);
      return;
    }
    if (isConversationEncrypted(selectedConversation)) {
      setEncReady(true);
      return;
    }

    let cancelled = false;
    (async () => {
      setEncInitializing(true);
      try {
        const conv = conversations.find((c) => c.id === selectedConversation);
        if (!conv) return;
        const otherUserId = conv.participants.find((p) => p !== currentUserId);

        const myKp = await getOrCreateKeyPair(currentUserId);
        const otherKp = await getOrCreateKeyPair(`sim_${otherUserId}`);

        if (!cancelled) {
          await initConversationEncryption(selectedConversation, currentUserId, otherUserId, myKp.privateKey, otherKp.publicKey);
          setEncReady(true);
        }
      } catch (err) {
        console.error('Encryption init failed:', err);
      } finally {
        if (!cancelled) setEncInitializing(false);
      }
    })();

    return () => { cancelled = true; };
  }, [selectedConversation, conversations, currentUserId, getOrCreateKeyPair, initConversationEncryption, isConversationEncrypted]);

  // Typing indicator logic
  const handleTypingStart = useCallback(() => {
    if (!selectedConversation) return;
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      startTyping(selectedConversation);
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
      stopTyping(selectedConversation);
    }, 2000);
  }, [selectedConversation]);

  const autoResizeInput = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);

  const copyMessage = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      addToast('Message copied', 'success');
    } catch {
      addToast('Could not copy message', 'error');
    }
  };

  const handleChatScroll = () => {
    const el = chatScrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setShowScrollBtn(!nearBottom);
  };

  if (selectedConversation) {
    const conv = conversations.find((c) => c.id === selectedConversation);
    if (!conv) {
      setSelectedConversation(null);
      return null;
    }
    const convMessages = messages[selectedConversation] || [];
    const otherUserId = conv.participants.find((p) => p !== currentUserId);
    const otherUser = getUser(otherUserId);
    const item = items.find((i) => i.id === conv.itemId);
    const isOtherOnline = onlineUserIds.includes(otherUserId);
    const otherTyping = typingUsers[otherUserId];

    const handleSend = async () => {
      const plaintext = inputText.trim();
      const hasText = plaintext.length > 0;
      const hasFiles = pendingAttachments.length > 0;
      if ((!hasText && !hasFiles) || uploading) return;

      let uploaded = [];
      if (hasFiles) {
        setUploading(true);
        const batch = [...pendingAttachments];
        const results = await Promise.allSettled(
          batch.map((a) => api.upload.chatAttachment(a.file))
        );
        const failed = [];
        results.forEach((r, i) => {
          const f = r.status === 'fulfilled' ? r.value?.file : null;
          if (f && f.url) {
            uploaded.push({
              kind: f.kind || 'document',
              url: f.url,
              filename: f.filename || batch[i].name,
              mime: f.mime || batch[i].type,
              size: Number(f.size) || batch[i].size,
            });
          } else {
            failed.push(batch[i].name);
          }
        });
        setUploading(false);

        if (failed.length > 0) addToast(`Could not upload: ${failed.join(', ')}`, 'error');
        if (uploaded.length === 0) return;
      }

      const type = hasText ? 'text' : 'file';
      const sendOptions = { type, attachments: uploaded };

      let encMeta = null;
      if (isConversationEncrypted(selectedConversation) && hasText) {
        try {
          encMeta = await encrypt(selectedConversation, plaintext);
        } catch (err) {
          console.error('Encryption failed, sending plaintext:', err);
        }
      }

      if (encMeta) {
        sendMessage(selectedConversation, plaintext, encMeta, sendOptions);
        socketSendMessage(selectedConversation, plaintext, {
          type,
          encrypted: true,
          ciphertext: encMeta.ciphertext,
          iv: encMeta.iv,
          attachments: uploaded,
        });
      } else {
        sendMessage(selectedConversation, hasText ? plaintext : '', null, sendOptions);
        socketSendMessage(selectedConversation, hasText ? plaintext : '', sendOptions);
      }

      pendingAttachments.forEach((a) => {
        if (a.preview && a.preview.startsWith('blob:')) URL.revokeObjectURL(a.preview);
      });
      setPendingAttachments([]);
      setInputText('');
      requestAnimationFrame(autoResizeInput);

      if (isTypingRef.current) {
        isTypingRef.current = false;
        stopTyping(selectedConversation);
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      }
    };

    const handleQuickReply = (text) => {
      setInputText(text);
    };

    return (
      <div className="chat-view">
        <div className="chat-header">
          <button className="back-btn" onClick={() => setSelectedConversation(null)}>
            <ArrowLeftIcon size={20} />
          </button>
          <div className="chat-header-avatar">
            <Avatar src={otherUser?.avatar} alt={otherUser?.name} size="md" verified={otherUser?.verified} />
            <span className={`online-dot ${isOtherOnline ? 'online' : ''}`} />
          </div>
          <div className="chat-user-info">
            <div className="chat-user-name">{otherUser?.name}</div>
            {item && <div className="chat-user-item">{item.title}</div>}
            {isOtherOnline && <span className="online-text">Online</span>}
          </div>
          <button className="chat-call-btn" onClick={handleCallStart} aria-label="Start audio call">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
          </button>
        </div>

        {encInitializing && (
          <div className="enc-initializing">
            <div className="enc-initializing-spinner" />
            <span>Establishing encrypted connection...</span>
          </div>
        )}

        <EncryptionBadge
          encrypted={encReady}
          fingerprint={getFingerprint(selectedConversation)}
          trusted={isKeyTrusted(selectedConversation)}
          onTrust={() => {
            trustKey(selectedConversation);
            addToast('Contact verified! Fingerprint marked as trusted.', 'success');
          }}
        />

        {item && (
          <div className="payment-offer-card" onClick={() => setActiveTab('payments')}>
            <div className="payment-offer-title">Secure Payment Available</div>
            <div className="payment-offer-amount">{formatPrice(item.price)}</div>
            <div className="payment-offer-meta"><ShieldIcon size={14} />Buyer protection included</div>
          </div>
        )}

        {item && (
          <div className="quick-actions">
            <button className="quick-btn" onClick={() => handleQuickReply('Is this still available?')}>Is this available?</button>
            <button className="quick-btn quick-btn--price" onClick={() => handleQuickReply(`Would you take $${Math.round(item.price * 0.8)}?`)}>
              Offer ${Math.round(item.price * 0.8)}
            </button>
            <button className="quick-btn quick-btn--price" onClick={() => handleQuickReply(`I can do $${Math.round(item.price * 0.9)}. Deal?`)}>
              Offer ${Math.round(item.price * 0.9)}
            </button>
            <button className="quick-btn" onClick={() => handleQuickReply('When can we meet?')}>When to meet?</button>
          </div>
        )}
        {!item && (
          <div className="quick-actions">
            <button className="quick-btn" onClick={() => handleQuickReply('Is this still available?')}>Is this available?</button>
            <button className="quick-btn" onClick={() => handleQuickReply('What is your best price?')}>Best price?</button>
            <button className="quick-btn" onClick={() => handleQuickReply('When can we meet?')}>When to meet?</button>
          </div>
        )}

        <div className="chat-messages" ref={chatScrollRef} onScroll={handleChatScroll}>
          {historyLoading && convMessages.length === 0 && (
            <div className="history-loading">
              <span className="uploading-spinner" /> Loading messages…
            </div>
          )}
          {(() => {
            const items = [];
            let lastDate = null;
            let lastSender = null;
            let lastTime = 0;
            convMessages.forEach((msg) => {
              const t = new Date(msg.time);
              const day = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
              if (day !== lastDate) {
                items.push({ type: 'date', label: formatDayLabel(t) });
                lastDate = day;
              }
              const isFirstInGroup = msg.senderId !== lastSender || (t.getTime() - lastTime > 5 * 60 * 1000);
              if (msg.senderId !== lastSender) lastSender = msg.senderId;
              lastTime = t.getTime();
              items.push({ type: 'msg', msg, first: isFirstInGroup });
            });
            return items.map((it, i) => {
              if (it.type === 'date') {
                return <div key={`date-${i}`} className="chat-date-sep">{it.label}</div>;
              }
              const { msg, first } = it;
              const isSent = msg.senderId === currentUserId;
              return (
                <div key={msg.id} className={`message-row ${isSent ? 'sent' : 'received'} ${first ? 'first' : ''}`}>
                  <div
                    className={`message-bubble ${isSent ? 'sent' : 'received'} ${first ? 'first' : ''} ${msg.attachments?.length ? 'has-attachments' : ''}`}
                    onClick={() => msg.text && copyMessage(msg.text)}
                    title={msg.text ? 'Click to copy' : undefined}
                  >
                    {!isSent && first && <span className="message-sender">{otherUser?.name}</span>}
                    {msg.attachments?.length > 0 && (
                      <div className="msg-attachments">
                        {msg.attachments.map((att, ai) => (
                          <AttachmentView key={att.id || `${att.url}-${ai}`} att={att} />
                        ))}
                      </div>
                    )}
                    {msg.text && <p className="message-text">{msg.text}</p>}
                    <span className="message-time">
                      {formatTime(msg.time)}
                      {isSent && (
                        <span className={`read-receipt ${msg.read ? 'read' : ''}`}>
                          {msg.read ? '✓✓' : '✓'}
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              );
            });
          })()}
          {otherTyping && (
            <div className="typing-indicator">
              <div className="typing-dots"><span /><span /><span /></div>
              <span className="typing-name">{otherTyping.name} is typing…</span>
            </div>
          )}
          <div ref={messagesEndRef} />
          {showScrollBtn && (
            <button className="chat-scroll-btn" onClick={() => scrollToBottom()} aria-label="Scroll to latest">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
            </button>
          )}
        </div>

        <div className="message-input-bar">
          <div className="input-bar-inner">
            <button type="button" className="emoji-btn" onClick={() => setEmojiPickerOpen((o) => !o)} aria-label="Emoji" aria-expanded={emojiPickerOpen}>
              <SmileIcon size={22} />
            </button>
            <button type="button" className="attach-btn" onClick={() => fileInputRef.current?.click()} aria-label="Attach file">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="file-input-hidden"
              onChange={handleFilesPick}
            />
            {pendingAttachments.length > 0 && (
              <div className="pending-attachments">
                {pendingAttachments.map((f, i) => (
                  <div className="pending-attachment" key={`${f.name}-${i}`}>
                    {f.isImage ? <img src={f.preview} alt={f.name} /> : f.isAudio ? <AudioIcon size={20} /> : <FileIcon size={20} />}
                    <span className="pending-attachment-name">{f.name}</span>
                    <span className="pending-attachment-size">{formatBytes(f.size)}</span>
                    <button type="button" className="pending-attachment-remove" onClick={() => removePendingAttachment(i)} aria-label="Remove">
                      XIcon size={16}
                    </button>
                  </div>
                ))}
              </div>
            )}
            {uploading && (
              <div className="uploading-bar">
                <span className="uploading-spinner" /> Uploading files…
              </div>
            )}
            <textarea
              ref={inputRef}
              rows={1}
              className="message-input"
              placeholder="Type a message…"
              value={inputText}
              onChange={(e) => {
                setInputText(e.target.value);
                autoResizeInput();
                handleTypingStart();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <button
              className="send-btn"
              onClick={handleSend}
              disabled={uploading || (!inputText.trim() && pendingAttachments.length === 0)}
            >
              {uploading ? <span className="uploading-spinner light" /> : <SendIcon size={20} />}
            </button>
          </div>
          {emojiPickerOpen && (
            <div className="emoji-picker-wrap">
              <EmojiPicker onSelect={handleEmojiPick} onClose={() => setEmojiPickerOpen(false)} />
            </div>
          )}
          {callOpen && (
            <CallOverlay
              conversationId={activeCallConversation || selectedConversation}
              callId={activeCallId}
              otherUser={otherUser}
              isInitiator={activeCallInitiator}
              onClose={() => {
                setCallOpen(false);
                setActiveCallId(null);
                setActiveCallConversation(null);
                setActiveCallInitiator(false);
              }}
            />
          )}
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="page">
        <Header title="Messages" />
        <div className="auth-gate">
          <div className="auth-gate-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <h3 className="auth-gate-title">Sign in to chat</h3>
          <p className="auth-gate-text">Message sellers, negotiate prices, and close deals securely.</p>
          <button
            className="auth-gate-btn"
            onClick={() => window.dispatchEvent(new CustomEvent('openAuthModal', { detail: 'login' }))}
          >
            Sign In
          </button>
          <button
            className="auth-gate-link"
            onClick={() => window.dispatchEvent(new CustomEvent('openAuthModal', { detail: 'signup' }))}
          >
            Create an account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <Header title="Messages" />
      <div className="chat-list">
        {conversations.length === 0 ? (
          <div className="empty-state">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <h3 className="empty-title">No conversations yet</h3>
            <p className="empty-text">Start chatting by contacting sellers on items you're interested in</p>
          </div>
        ) : (
          <>
            <div className="conv-search">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                placeholder="Search conversations…"
                value={convSearch}
                onChange={(e) => setConvSearch(e.target.value)}
              />
            </div>
            {(() => {
              const q = convSearch.trim().toLowerCase();
              const filtered = conversations.filter((conv) => {
                if (!q) return true;
                const otherUserId = conv.participants.find((p) => p !== currentUserId);
                const otherUser = getUser(otherUserId);
                return (otherUser?.name || '').toLowerCase().includes(q)
                  || (conv.lastMessage || '').toLowerCase().includes(q);
              });
              if (filtered.length === 0) {
                return <div className="empty-state small"><p className="empty-text">No conversations match "{convSearch.trim()}"</p></div>;
              }
              return filtered.map((conv, i) => {
                const otherUserId = conv.participants.find((p) => p !== currentUserId);
                const otherUser = getUser(otherUserId);
                const item = items.find((item) => item.id === conv.itemId);
                const isOtherOnline = onlineUserIds.includes(otherUserId);

                return (
                  <div
                    key={conv.id}
                    className="conv-item conv-item-appear"
                    style={{ animationDelay: `${i * 50}ms` }}
                    onClick={() => setSelectedConversation(conv.id)}
                  >
                    <div className="conv-avatar">
                      <Avatar src={otherUser?.avatar} alt={otherUser?.name} size="md" verified={otherUser?.verified} />
                      <span className={`online-dot ${isOtherOnline ? 'online' : ''}`} />
                    </div>
                    <div className="conv-content">
                      <div className="conv-header">
                        <span className="conv-name">{otherUser?.name}</span>
                        <span className="conv-time">{formatDate(conv.lastMessageTime)}</span>
                      </div>
                      <div className="conv-preview">
                        <span className="conv-message">{item ? `${item.title}: ` : ''}{conv.lastMessage || 'No messages yet'}</span>
                        {conv.unreadCount > 0 && <span className="unread-badge">{conv.unreadCount}</span>}
                      </div>
                    </div>
                  </div>
                );
              });
            })()}
          </>
        )}
      </div>
    </div>
  );
}
