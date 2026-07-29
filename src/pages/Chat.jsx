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
  getSocket,
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
    addNotification,
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
  const [encInitializing, setEncInitializing] = useState(false);
  const [encReady, setEncReady] = useState(false);
  const [typingUsers, setTypingUsers] = useState({});
  const [onlineUserIds, setOnlineUserIds] = useState([]);
  const typingTimeoutRef = useRef(null);
  const isTypingRef = useRef(false);
  const prevConvRef = useRef(null);

  const currentUserId = user?.id;

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

  // Connect socket on mount
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    const token = getToken();
    if (!token) return;

    connectSocket(token);
    const socket = getSocket();

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

        <div className="chat-messages">
          {convMessages.map((msg, i) => (
            <div
              key={msg.id}
              className={`message-bubble ${msg.senderId === currentUserId ? 'sent' : 'received'} msg-appear`}
              style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}
            >
              <p className="message-text">{msg.text}</p>
              <span className="message-time">
                {formatTime(msg.time)}
                {msg.senderId === currentUserId && (
                  <span className={`read-receipt ${msg.read ? 'read' : ''}`}>
                    {msg.read ? '✓✓' : '✓'}
                  </span>
                )}
              </span>
            </div>
          ))}
          {otherTyping && (
            <div className="typing-indicator">
              <div className="typing-dots">
                <span /><span /><span />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="message-input-bar">
          <input
            type="text"
            className="message-input"
            placeholder="Type a message..."
            value={inputText}
            onChange={(e) => {
              setInputText(e.target.value);
              handleTypingStart();
            }}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          />
          <button className="send-btn" onClick={handleSend} disabled={!inputText.trim()}>
            <SendIcon size={20} />
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
          conversations.map((conv, i) => {
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
          })
        )}
      </div>
    </div>
  );
}
