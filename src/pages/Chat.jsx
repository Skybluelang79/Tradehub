import { useState, useRef, useEffect } from 'react';
import { Header } from '../components/layout';
import { Avatar } from '../components/ui';
import { useToast } from '../components/ui/Toast';
import { ArrowLeftIcon, SendIcon, ShieldIcon } from '../components/ui/Icons';
import { useApp } from '../context';
import { currentUser } from '../services/api';
import { formatDate, formatTime, formatPrice } from '../utils/helpers';
import '../styles/globals.css';
import './Chat.css';

export default function Chat() {
  const { conversations, messages, selectedConversation, setSelectedConversation, setActiveTab, sendMessage, markConversationRead, getUser, items, addNotification } = useApp();
  const { addToast } = useToast();
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, selectedConversation]);

  useEffect(() => {
    if (selectedConversation) {
      markConversationRead(selectedConversation);
    }
  }, [selectedConversation, markConversationRead]);

  const autoReplies = [
    "Great, thanks for your interest!",
    "Yes, it's still available!",
    "I can do that price. When would you like to meet?",
    "Sure, let me know when works for you.",
    "I'm available this weekend if you want to check it out.",
  ];

  useEffect(() => {
    if (!selectedConversation) return;
    const convMessages = messages[selectedConversation] || [];
    if (convMessages.length === 0) return;
    const lastMsg = convMessages[convMessages.length - 1];
    if (lastMsg && lastMsg.senderId === currentUser.id) {
      const timer = setTimeout(() => {
        const reply = autoReplies[Math.floor(Math.random() * autoReplies.length)];
        sendMessage(selectedConversation, reply);
        const conv = conversations.find((c) => c.id === selectedConversation);
        const otherUserId = conv?.participants.find((p) => p !== currentUser.id);
        const otherUser = getUser(otherUserId);
        if (otherUser && conv) {
          const item = items.find((i) => i.id === conv.itemId);
          addNotification({
            type: 'message',
            title: otherUser.name,
            body: reply,
            relatedId: selectedConversation,
          });
        }
      }, 1500 + Math.random() * 2000);
      return () => clearTimeout(timer);
    }
  }, [messages, selectedConversation, sendMessage, addNotification, conversations, getUser, currentUser.id, items]);

  if (selectedConversation) {
    const conv = conversations.find((c) => c.id === selectedConversation);
    const convMessages = messages[selectedConversation] || [];
    const otherUserId = conv.participants.find((p) => p !== currentUser.id);
    const otherUser = getUser(otherUserId);
    const item = items.find((i) => i.id === conv.itemId);

    const handleSend = () => {
      if (inputText.trim()) {
        sendMessage(selectedConversation, inputText.trim());
        setInputText('');
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
          <Avatar src={otherUser.avatar} alt={otherUser.name} size="md" verified={otherUser.verified} />
          <div className="chat-user-info">
            <div className="chat-user-name">{otherUser.name}</div>
            {item && <div className="chat-user-item">{item.title}</div>}
          </div>
        </div>

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
          {convMessages.map((msg) => (
            <div key={msg.id} className={`message-bubble ${msg.senderId === currentUser.id ? 'sent' : 'received'}`}>
              <p className="message-text">{msg.text}</p>
              <span className="message-time">{formatTime(msg.time)}</span>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="message-input-bar">
          <input type="text" className="message-input" placeholder="Type a message..." value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSend()} />
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
          conversations.map((conv) => {
            const otherUserId = conv.participants.find((p) => p !== currentUser.id);
            const otherUser = getUser(otherUserId);
            const item = items.find((i) => i.id === conv.itemId);

            return (
              <div key={conv.id} className="conv-item" onClick={() => { setSelectedConversation(conv.id); }}>
                <div className="conv-avatar">
                  <Avatar src={otherUser.avatar} alt={otherUser.name} size="md" verified={otherUser.verified} />
                </div>
                <div className="conv-content">
                  <div className="conv-header">
                    <span className="conv-name">{otherUser.name}</span>
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
