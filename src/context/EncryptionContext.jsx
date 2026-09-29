import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import {
  generateKeyPair,
  deriveSharedSecret,
  encryptMessage,
  decryptMessage,
  generateFingerprint,
} from '../services/crypto';
import { api } from '../services/client';
import { useAuth } from './AuthContext';

const EncryptionContext = createContext();

const STORAGE_PREFIX = 'tradehub_enc_';

function storeKeys(userId, keys) {
  localStorage.setItem(`${STORAGE_PREFIX}kp_${userId}`, JSON.stringify(keys));
}

function loadKeys(userId) {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}kp_${userId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function EncryptionProvider({ children }) {
  const { user: authUser } = useAuth();
  const [sharedKeys, setSharedKeys] = useState({});
  const [fingerprints, setFingerprints] = useState({});
  const [pendingConvs, setPendingConvs] = useState({});
  const [trustedKeys, setTrustedKeys] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('tradehub_trusted_keys') || '{}');
    } catch {
      return {};
    }
  });

  useEffect(() => {
    localStorage.setItem('tradehub_trusted_keys', JSON.stringify(trustedKeys));
  }, [trustedKeys]);

  const getOrCreateKeyPair = useCallback(async (userId) => {
    const stored = loadKeys(userId);
    if (stored) return stored;

    const kp = await generateKeyPair();
    storeKeys(userId, kp);
    return kp;
  }, []);

  const syncPublicKey = useCallback(async (userId) => {
    if (!userId) return;
    const kp = await getOrCreateKeyPair(userId);
    try {
      await api.chat.savePublicKey(kp.publicKey);
    } catch (err) {
      console.error('Failed to sync public key:', err);
    }
  }, [getOrCreateKeyPair]);

  const ensureIdentity = useCallback(async (userId) => {
    const kp = await getOrCreateKeyPair(userId);
    return kp;
  }, [getOrCreateKeyPair]);

  const hasIdentity = useCallback(
    (userId) => !!loadKeys(userId),
    []
  );

  // Push our own public key to the server whenever we are signed in. The
  // previous 'user-1' guard existed only to skip the demo fixture account and
  // silently skipped key setup for any real account.
  useEffect(() => {
    if (authUser?.id) {
      syncPublicKey(authUser.id);
    }
  }, [authUser?.id, syncPublicKey]);

  const initConversationEncryption = useCallback(async (conversationId, peerPublicKey) => {
    if (!peerPublicKey) {
      setPendingConvs((prev) => ({ ...prev, [conversationId]: true }));
      return null;
    }

    const myUserId = authUser?.id;
    if (!myUserId) return null;

    const myKp = await getOrCreateKeyPair(myUserId);
    const key = await deriveSharedSecret(myKp.privateKey, peerPublicKey);
    const fingerprint = generateFingerprint(peerPublicKey);

    setSharedKeys((prev) => ({ ...prev, [conversationId]: key }));
    setFingerprints((prev) => ({ ...prev, [conversationId]: fingerprint }));
    setPendingConvs((prev) => ({ ...prev, [conversationId]: false }));

    return { key, fingerprint };
  }, [authUser?.id, getOrCreateKeyPair]);

  const encrypt = useCallback(async (conversationId, plaintext) => {
    const key = sharedKeys[conversationId];
    if (!key) throw new Error('Encryption not initialized for this conversation');
    return encryptMessage(plaintext, key);
  }, [sharedKeys]);

  const decrypt = useCallback(async (conversationId, ciphertext, iv) => {
    const key = sharedKeys[conversationId];
    if (!key) throw new Error('Encryption not initialized for this conversation');
    return decryptMessage(ciphertext, iv, key);
  }, [sharedKeys]);

  const isConversationEncrypted = useCallback((conversationId) => {
    return !!sharedKeys[conversationId];
  }, [sharedKeys]);

  const isConversationPending = useCallback((conversationId) => {
    return !!pendingConvs[conversationId];
  }, [pendingConvs]);

  const getFingerprint = useCallback((conversationId) => {
    return fingerprints[conversationId] || null;
  }, [fingerprints]);

  const trustKey = useCallback((conversationId) => {
    setTrustedKeys((prev) => ({ ...prev, [conversationId]: true }));
  }, []);

  const isKeyTrusted = useCallback((conversationId) => {
    return !!trustedKeys[conversationId];
  }, [trustedKeys]);

  const value = {
    ensureIdentity,
    syncPublicKey,
    hasIdentity,
    initConversationEncryption,
    encrypt,
    decrypt,
    isConversationEncrypted,
    isConversationPending,
    getFingerprint,
    trustKey,
    isKeyTrusted,
  };

  return (
    <EncryptionContext.Provider value={value}>
      {children}
    </EncryptionContext.Provider>
  );
}

export function useEncryption() {
  const context = useContext(EncryptionContext);
  if (!context) {
    throw new Error('useEncryption must be used within EncryptionProvider');
  }
  return context;
}

export default EncryptionContext;