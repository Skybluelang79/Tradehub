import { useCallback, useEffect, useRef, useState } from 'react';
import { useAdmin } from '../../context/AdminContext.jsx';
import { api } from '../../services/client';
import { createSupportSocket } from '../../services/socket';
import { HeadphonesIcon, RefreshIcon, SendIcon } from './Icons.jsx';
import './AdminTransactions.css';
import './AdminPayouts.css';
import './AdminSupport.css';

const formatTime = (value) => {
  if (!value) return '';
  const date = new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z'));
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
};

export default function AdminSupport() {
  const { isAdminAuth } = useAdmin();
  const [threads, setThreads] = useState([]);
  const [stats, setStats] = useState({ open: 0, unread: 0 });
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [faqs, setFaqs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef(null);

  const refresh = useCallback(async () => {
    if (!isAdminAuth) {
      window.dispatchEvent(new CustomEvent('adminSessionExpired'));
      return;
    }
    try {
      const [list, summary] = await Promise.all([
        api.admin.supportConversations({ status: filter }),
        api.admin.supportStats(),
      ]);
      setThreads(list.conversations || []);
      setStats(summary || { open: 0, unread: 0 });
    } catch (err) {
      setError(err.message || 'Could not load support conversations');
    } finally {
      setLoading(false);
    }
  }, [isAdminAuth, filter]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    api.support.faq().then((res) => setFaqs(res.faqs || [])).catch(() => {});
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('tradehub_admin_token');
    if (!selectedId || !token) return undefined;
    const socket = createSupportSocket(token);
    if (!socket) return undefined;
    const onMessage = ({ threadId, message }) => {
      if (threadId === selectedId && message) {
        setMessages((prev) => (prev.some((item) => item.id === message.id) ? prev : [...prev, message]));
      }
      refresh();
    };
    const join = () => socket.emit('support_join', selectedId);
    socket.on('support_message', onMessage);
    socket.on('connect', join);
    if (socket.connected) join();
    return () => {
      socket.off('support_message', onMessage);
      socket.off('connect', join);
      if (socket.connected) socket.emit('support_leave', selectedId);
      socket.disconnect();
    };
  }, [selectedId, refresh]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const openThread = async (thread) => {
    setSelectedId(thread.id);
    setDraft('');
    setError('');
    setBusy(true);
    try {
      const res = await api.admin.supportMessages(thread.id);
      setMessages(res.messages || []);
      refresh();
    } catch (err) {
      setError(err.message || 'Could not load this conversation');
    } finally {
      setBusy(false);
    }
  };

  const reply = async (event) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !selectedId || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.admin.supportSend(selectedId, text);
      setMessages((prev) => [...prev, res.message]);
      setDraft('');
      refresh();
    } catch (err) {
      setError(err.message || 'Could not send your reply');
    } finally {
      setBusy(false);
    }
  };

  const toggleStatus = async () => {
    const thread = threads.find((item) => item.id === selectedId);
    if (!thread) return;
    setBusy(true);
    try {
      await api.admin.supportUpdate(thread.id, thread.status === 'open' ? 'closed' : 'open');
      refresh();
    } catch (err) {
      setError(err.message || 'Could not update the conversation');
    } finally {
      setBusy(false);
    }
  };

  const selected = threads.find((item) => item.id === selectedId);

  return (
    <div className="admin-support">
      <div className="admin-page-header">
        <div className="header-left">
          <h1>Support Inbox</h1>
          <p>Reply to buyer and seller questions in real time</p>
        </div>
        <button className="btn-sm btn-secondary" onClick={refresh} type="button">
          <RefreshIcon size={14} /> Refresh
        </button>
      </div>

      <div className="admin-support-stats">
        <div className="tx-stat-card">
          <div className="tx-stat-icon warning"><HeadphonesIcon size={22} /></div>
          <div className="tx-stat-info">
            <span className="tx-stat-value">{stats.open}</span>
            <span className="tx-stat-label">Open conversations</span>
          </div>
        </div>
        <div className="tx-stat-card">
          <div className="tx-stat-icon"><SendIcon size={22} /></div>
          <div className="tx-stat-info">
            <span className="tx-stat-value">{stats.unread}</span>
            <span className="tx-stat-label">Unread messages</span>
          </div>
        </div>
      </div>

      {error && <div className="admin-support-error">{error}</div>}

      <div className="admin-support-layout">
        <div className="admin-support-list">
          <div className="payout-actions" style={{ marginBottom: 12 }}>
            {['all', 'open', 'closed'].map((status) => (
              <button
                key={status}
                type="button"
                className={`btn-sm ${filter === status ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => { setFilter(status); setSelectedId(null); }}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="empty-state">Loading conversations…</div>
          ) : threads.length === 0 ? (
            <div className="empty-state">
              <h3 className="empty-title">Inbox zero</h3>
              <p className="empty-text">New support conversations will appear here</p>
            </div>
          ) : threads.map((thread) => (
            <button
              key={thread.id}
              type="button"
              className={`admin-support-thread ${selectedId === thread.id ? 'active' : ''}`}
              onClick={() => openThread(thread)}
            >
              <div className="admin-support-thread-top">
                <strong>{thread.subject}</strong>
                {thread.unread_count > 0 && <span className="admin-support-unread">{thread.unread_count}</span>}
              </div>
              <span className="admin-support-thread-user">{thread.user_name || thread.user_id} · {thread.category}</span>
              <span className="admin-support-thread-preview">{thread.last_message}</span>
              <span className={`status-badge ${thread.status === 'open' ? 'status-pending' : 'status-completed'}`}>
                {thread.status === 'open' ? 'Open' : 'Closed'}
              </span>
            </button>
          ))}
        </div>

        <div className="admin-support-thread-panel">
          {!selected ? (
            <div className="empty-state">
              <HeadphonesIcon size={32} />
              <h3 className="empty-title">Select a conversation</h3>
              <p className="empty-text">Choose a question from the left to reply</p>
            </div>
          ) : (
            <>
              <div className="admin-support-thread-header">
                <div>
                  <strong>{selected.subject}</strong>
                  <span>{selected.user_name || selected.user_id} · {selected.category} · {selected.context}</span>
                </div>
                <button className="btn-sm btn-secondary" type="button" onClick={toggleStatus} disabled={busy}>
                  {selected.status === 'open' ? 'Close' : 'Reopen'}
                </button>
              </div>

              <div className="admin-support-messages">
                {messages.map((message) => (
                  <div key={message.id} className={`admin-support-message ${message.sender_role === 'admin' ? 'mine' : ''}`}>
                    <span className="admin-support-sender">
                      {message.sender_role === 'bot' ? 'TradeHub Bot' : message.sender_role === 'admin' ? 'You' : selected.user_name || 'Customer'}
                      {' · '}{formatTime(message.created_at)}
                    </span>
                    <div className="admin-support-bubble">{message.text}</div>
                  </div>
                ))}
                <div ref={endRef} />
              </div>

              {faqs.length > 0 && (
                <div className="admin-support-quick-replies">
                  <span>Quick answers</span>
                  {faqs.slice(0, 4).map((faq) => (
                    <button key={faq.id} type="button" onClick={() => setDraft(faq.answer)}>{faq.question}</button>
                  ))}
                </div>
              )}

              <form className="admin-support-composer" onSubmit={reply}>
                <textarea
                  className="input"
                  rows="3"
                  placeholder="Write a reply…"
                  maxLength={2000}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <button className="btn-sm btn-primary" type="submit" disabled={!draft.trim() || busy}>
                  {busy ? 'Sending…' : <><SendIcon size={14} /> Send</>}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
