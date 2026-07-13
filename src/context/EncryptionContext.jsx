import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import {
  generateKeyPair,
  deriveSharedSecret,
  encryptMessage,
  decryptMessage,
  generateFingerprint,
} from '../services/crypto';

const EncryptionContext = createContext();

const STORAGE_PREFIX = 'tradehub_enc_';

function storeKeys(conversationId, keys) {
  localStorage.setItem(`${STORAGE_PREFIX}${conversationId}`, JSON.stringify(keys));
}

function loadKeys(conversationId) {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${conversationId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function EncryptionProvider({ children }) {
  const [keyPairs, setKeyPairs] = useState({});
  const [sharedKeys, setSharedKeys] = useState({});
  const [fingerprints, setFingerprints] = useState({});
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
    if (keyPairs[userId]) return keyPairs[userId];

    const stored = loadKeys(`kp_${userId}`);
    if (stored) {
      setKeyPairs(prev => ({ ...prev, [userId]: stored }));
      return stored;
    }

    const kp = await generateKeyPair();
    storeKeys(`kp_${userId}`, kp);
    setKeyPairs(prev => ({ ...prev, [userId]: kp }));
    return kp;
  }, [keyPairs]);

  const initConversationEncryption = useCallback(async (conversationId, myUserId, otherUserId, myPrivateKey, otherPublicKey) => {
    const key = await deriveSharedSecret(myPrivateKey, otherPublicKey);
    const fingerprint = generateFingerprint(otherPublicKey);

    setSharedKeys(prev => ({ ...prev, [conversationId]: key }));
    setFingerprints(prev => ({ ...prev, [conversationId]: fingerprint }));

    return { key, fingerprint };
  }, []);

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

  const getFingerprint = useCallback((conversationId) => {
    return fingerprints[conversationId] || null;
  }, [fingerprints]);

  const trustKey = useCallback((conversationId) => {
    setTrustedKeys(prev => ({ ...prev, [conversationId]: true }));
  }, []);

  const isKeyTrusted = useCallback((conversationId) => {
    return !!trustedKeys[conversationId];
  }, [trustedKeys]);

  const value = {
    getOrCreateKeyPair,
    initConversationEncryption,
    encrypt,
    decrypt,
    isConversationEncrypted,
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
