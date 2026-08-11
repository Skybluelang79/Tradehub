import { useState, useRef, useEffect, useCallback } from 'react';
import { Header } from '../components/layout';
import { Avatar } from '../components/ui';
import { useToast } from '../components/ui/Toast';
import { ArrowLeftIcon, SendIcon, ShieldIcon } from '../components/ui/Icons';
import EncryptionBadge from '../components/features/EncryptionBadge';
import { useApp } from '../context';
import { useAuth } from '../context/AuthContext';
import { useEncryption } from '../context/EncryptionContext';
import { getToken } from '../services/client';
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

export default function Chat() {
  const {
    conversations,
    messages,
    selectedConversation,
    setSelectedConversation,
    setActiveTab,
    sendMessage,
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
          message: {
            id: message.id,
            senderId: message.sender_id,
            text: message.text,
            time: message.created_at || message.time,
            read: !!message.read,
            encrypted: !!message.encrypted,
            ciphertext: message.ciphertext,
            iv: message.iv,
          },
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
      addToast({ type: 'success', message: 'Message copied' });
    } catch {
      addToast({ type: 'error', message: 'Could not copy message' });
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
      if (inputText.trim()) {
        const plaintext = inputText.trim();
        let encMeta = null;
        if (isConversationEncrypted(selectedConversation)) {
          try {
            encMeta = await encrypt(selectedConversation, plaintext);
          } catch (err) {
            console.error('Encryption failed, sending plaintext:', err);
          }
        }
        if (encMeta) {
          sendMessage(selectedConversation, plaintext, encMeta);
          socketSendMessage(selectedConversation, plaintext, true, encMeta.ciphertext, encMeta.iv);
        } else {
          sendMessage(selectedConversation, plaintext);
          socketSendMessage(selectedConversation, plaintext);
        }
        setInputText('');
        requestAnimationFrame(autoResizeInput);

        if (isTypingRef.current) {
          isTypingRef.current = false;
          stopTyping(selectedConversation);
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        }
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
            addToast({ type: 'success', message: 'Contact verified! Fingerprint marked as trusted.' });
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
                    className={`message-bubble ${isSent ? 'sent' : 'received'} ${first ? 'first' : ''}`}
                    onClick={() => copyMessage(msg.text)}
                    title="Click to copy"
                  >
                    {!isSent && first && <span className="message-sender">{otherUser?.name}</span>}
                    <p className="message-text">{msg.text}</p>
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
          <button className="send-btn" onClick={handleSend} disabled={!inputText.trim()}>
            <SendIcon size={20} />
          </button>
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
