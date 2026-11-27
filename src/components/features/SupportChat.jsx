import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeftIcon, ChatIcon, CheckIcon, HelpIcon, MessageIcon, SendIcon, XIcon } from '../ui/Icons';
import { useAuth } from '../../context/AuthContext';
import { api, getToken } from '../../services/client';
import {
  connectSocket,
  getSocket,
  joinSupportThread,
  leaveSupportThread,
  onSupportMessage,
  onSupportTyping,
  supportTyping,
} from '../../services/socket';
import './SupportChat.css';

const CATEGORIES = [
  { id: 'payment', label: 'Payments & wallet' },
  { id: 'order', label: 'Orders & delivery' },
  { id: 'listing', label: 'Listings' },
  { id: 'account', label: 'Account' },
  { id: 'safety', label: 'Safety & disputes' },
  { id: 'technical', label: 'Technical issue' },
  { id: 'other', label: 'Something else' },
];

const roleName = (message) => {
  if (message.sender_role === 'bot') return 'TradeHub Bot';
  if (message.sender_role === 'admin') return message.sender_name || 'TradeHub Support';
  return 'You';
};

export default function SupportChat({ variant = 'floating', context = 'general' }) {
  const { isAuthenticated } = useAuth();
  const isInline = variant === 'inline';
  const [open, setOpen] = useState(isInline);
  const [view, setView] = useState('home');
  const [threads, setThreads] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState(context === 'payments' ? 'payment' : context === 'orders' ? 'order' : 'other');
  const [faqs, setFaqs] = useState([]);
  const [selectedFaq, setSelectedFaq] = useState(null);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef(null);
  const typingTimer = useRef(null);

  const loadOverview = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const [list, count] = await Promise.all([
        api.support.conversations(),
        api.support.unreadCount().catch(() => ({ count: 0 })),
      ]);
      setThreads(list.conversations || []);
      setUnread(count.count || 0);
    } catch {
      // The widget stays usable offline; the last loaded conversations remain visible.
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    api.support.faq().then((res) => setFaqs(res.faqs || [])).catch(() => {});
    loadOverview();
    const timer = setInterval(loadOverview, 15000);
    return () => clearInterval(timer);
  }, [isAuthenticated, loadOverview]);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('openSupportChat', onOpen);
    return () => window.removeEventListener('openSupportChat', onOpen);
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !open) return undefined;
    connectSocket(getToken());
    const offMessage = onSupportMessage(({ threadId, message }) => {
      if (!message) return;
      if (threadId !== activeId) {
        setThreads((prev) => prev.map((thread) => (
          thread.id === threadId
            ? { ...thread, last_message: message.text, last_message_at: message.created_at, unread_count: (thread.unread_count || 0) + (message.sender_role === 'user' ? 0 : 1) }
            : thread
        )));
        if (message.sender_role !== 'user') setUnread((count) => count + 1);
        return;
      }
      setMessages((prev) => (prev.some((item) => item.id === message.id) ? prev : [...prev, message]));
      if (message.sender_role !== 'user') api.support.read(threadId).then(loadOverview).catch(() => {});
    });
    const offTyping = onSupportTyping(({ threadId, senderRole }) => {
      if (threadId !== activeId || senderRole === 'user') return;
      setTyping(true);
      clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setTyping(false), 2500);
    });
    return () => {
      offMessage();
      offTyping();
      clearTimeout(typingTimer.current);
    };
  }, [isAuthenticated, open, activeId, loadOverview]);

  useEffect(() => {
    if (!isAuthenticated || !activeId || !open) return undefined;
    const socket = getSocket();
    if (!socket) return undefined;
    const join = () => joinSupportThread(activeId);
    if (socket.connected) join();
    else socket.once('connect', join);
    return () => {
      if (socket.connected) leaveSupportThread(activeId);
    };
  }, [activeId, isAuthenticated, open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, typing]);

  const openThread = async (thread) => {
    setActiveId(thread.id);
    setView('chat');
    setError('');
    setLoading(true);
    try {
      const res = await api.support.messages(thread.id);
      setMessages(res.messages || []);
      setThreads((prev) => prev.map((item) => (item.id === thread.id ? { ...item, unread_count: 0 } : item)));
      setUnread(0);
      await api.support.read(thread.id).catch(() => {});
    } catch (err) {
      setError(err.message || 'Could not load this conversation');
    } finally {
      setLoading(false);
    }
  };

  const startConversation = async (event) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.support.createConversation({
        subject: subject.trim() || `Support · ${context}`,
        category,
        context,
        message: text,
      });
      setThreads((prev) => [res.conversation, ...prev]);
      setActiveId(res.conversation.id);
      setMessages(res.messages || []);
      setView('chat');
      setDraft('');
      setSubject('');
      setSelectedFaq(null);
      loadOverview();
    } catch (err) {
      setError(err.message || 'Could not start the conversation');
    } finally {
      setBusy(false);
    }
  };

  const sendMessage = async (event) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !activeId || busy) return;
    setBusy(true);
    setError('');
    const payload = { id: `temp-${Date.now()}`, sender_role: 'user', sender_name: 'You', text, created_at: new Date().toISOString() };
    setMessages((prev) => [...prev, payload]);
    setDraft('');
    try {
      const res = await api.support.send(activeId, text);
      setMessages((prev) => [
        ...prev.filter((item) => item.id !== payload.id),
        res.message,
        ...(res.autoReply ? [res.autoReply] : []),
      ]);
      loadOverview();
    } catch (err) {
      setMessages((prev) => prev.filter((item) => item.id !== payload.id));
      setDraft(text);
      setError(err.message || 'Could not send your message');
    } finally {
      setBusy(false);
    }
  };

  const requestHuman = async () => {
    if (!activeId || busy) return;
    setBusy(true);
    try {
      const res = await api.support.handoff(activeId);
      setMessages((prev) => [...prev, res.message]);
    } catch (err) {
      setError(err.message || 'Could not request an agent');
    } finally {
      setBusy(false);
    }
  };

  const notifyTyping = () => {
    if (!activeId) return;
    supportTyping(activeId);
  };

  const backToHome = () => {
    setActiveId(null);
    setMessages([]);
    setView('home');
    setError('');
  };

  const panel = (
    <div className={`support-chat-panel ${isInline ? 'support-chat-panel--inline' : ''}`} role="dialog" aria-label="TradeHub support chat">
      <div className="support-chat-header">
        <div className="support-chat-heading">
          <span className="support-chat-avatar"><HelpIcon size={18} /></span>
          <div>
            <strong>TradeHub Support</strong>
            <span>{activeId ? 'Bot + human agents' : 'Answers in seconds'}</span>
          </div>
        </div>
        {!isInline && (
          <button className="support-chat-icon-btn" onClick={() => setOpen(false)} aria-label="Close support chat">
            <XIcon size={18} />
          </button>
        )}
      </div>

      {!isAuthenticated ? (
        <div className="support-chat-empty">
          <HelpIcon size={30} />
          <h4>Sign in to chat with support</h4>
          <p>We keep your conversations tied to your account so agents can help faster.</p>
          <button className="support-chat-primary" onClick={() => window.dispatchEvent(new CustomEvent('openAuthModal', { detail: 'login' }))}>
            Sign in
          </button>
        </div>
      ) : error ? (
        <div className="support-chat-error">
          <p>{error}</p>
          <button className="support-chat-link" onClick={() => setError('')}>Try again</button>
          <p className="support-chat-email">Or email support@tradehub.app</p>
        </div>
      ) : activeId ? (
        <>
          <div className="support-chat-toolbar">
            <button className="support-chat-back" onClick={backToHome}>
              <ArrowLeftIcon size={16} /> All conversations
            </button>
            <button className="support-chat-human" onClick={requestHuman} disabled={busy}>
              <ChatIcon size={14} /> Talk to a human
            </button>
          </div>
          <div className="support-chat-messages">
            {loading ? (
              <p className="support-chat-hint">Loading conversation…</p>
            ) : messages.map((message) => (
              <div key={message.id} className={`support-bubble-row ${message.sender_role === 'user' ? 'mine' : ''}`}>
                {message.sender_role !== 'user' && <span className="support-bubble-name">{roleName(message)}</span>}
                <div className={`support-bubble ${message.sender_role === 'bot' ? 'bot' : ''}`}>
                  {message.text.split('\n').map((line, index) => <p key={index}>{line}</p>)}
                </div>
              </div>
            ))}
            {typing && <div className="support-bubble-row"><span className="support-typing">Agent is typing…</span></div>}
            <div ref={endRef} />
          </div>
          <form className="support-chat-composer" onSubmit={sendMessage}>
            <input
              className="input"
              placeholder="Type your message…"
              value={draft}
              maxLength={2000}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={notifyTyping}
            />
            <button className="support-chat-send" type="submit" disabled={!draft.trim() || busy} aria-label="Send message">
              <SendIcon size={18} />
            </button>
          </form>
        </>
      ) : (
        <div className="support-chat-home">
          <div className="support-chat-section">
            <div className="support-chat-section-title">Quick answers</div>
            <div className="support-faq-list">
              {faqs.slice(0, 6).map((faq) => (
                <div key={faq.id} className="support-faq-item">
                  <button className="support-faq-question" onClick={() => setSelectedFaq(selectedFaq?.id === faq.id ? null : faq)}>
                    <HelpIcon size={14} /> {faq.question}
                  </button>
                  {selectedFaq?.id === faq.id && (
                    <div className="support-faq-answer">
                      <p>{faq.answer}</p>
                      <button className="support-chat-link" onClick={() => { setDraft(faq.question); setView('new'); }}>Ask this</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="support-chat-section">
            <div className="support-chat-section-title">
              New conversation
              {view === 'new' && <button className="support-chat-link" onClick={() => setView('home')}>Cancel</button>}
            </div>
            {view === 'new' ? (
              <form className="support-chat-form" onSubmit={startConversation}>
                <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
                  {CATEGORIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
                <input
                  className="input"
                  placeholder="Subject (optional)"
                  maxLength={200}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
                <textarea
                  className="input"
                  rows="3"
                  placeholder="Tell us what happened…"
                  maxLength={2000}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <button className="support-chat-primary" type="submit" disabled={!draft.trim() || busy}>
                  {busy ? 'Sending…' : 'Start chat'}
                </button>
              </form>
            ) : (
              <button className="support-chat-primary" onClick={() => setView('new')}>
                <ChatIcon size={16} /> Ask a question
              </button>
            )}
          </div>

          {threads.length > 0 && (
            <div className="support-chat-section">
              <div className="support-chat-section-title">Previous conversations</div>
              <div className="support-thread-list">
                {threads.map((thread) => (
                  <button key={thread.id} className="support-thread" onClick={() => openThread(thread)}>
                    <span className="support-thread-icon"><MessageIcon size={16} /></span>
                    <span className="support-thread-info">
                      <strong>{thread.subject}</strong>
                      <small>{thread.last_message || 'No messages yet'}</small>
                    </span>
                    {thread.unread_count > 0 && <span className="support-thread-unread">{thread.unread_count}</span>}
                    {thread.status === 'closed' && <CheckIcon size={14} />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  if (isInline) return panel;

  return (
    <>
      {open && panel}
      <button className="support-launch" onClick={() => setOpen((value) => !value)} aria-label="Open support chat">
        {open ? <XIcon size={22} /> : <ChatIcon size={22} />}
        {!open && unread > 0 && <span className="support-launch-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
    </>
  );
}
