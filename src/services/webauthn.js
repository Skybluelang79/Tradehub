import api from './client';

/**
 * Thin wrapper around the browser WebAuthn API.
 *
 * The server issues base64url-encoded options and expects the credential back
 * in the same shape, so the only real work here is converting between
 * ArrayBuffers and base64url and turning the awkward `NotAllowedError` the
 * browser throws when a user cancels into something worth showing.
 */

export function isPasskeySupported() {
  return typeof window !== 'undefined'
    && typeof window.PublicKeyCredential === 'function'
    && typeof navigator.credentials?.create === 'function';
}

export function base64urlToBuffer(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function bufferToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Map the server's JSON options onto the shape `navigator.credentials` wants. */
function toCredentialCreationOptions(optionsJSON) {
  const user = optionsJSON.user
    ? {
      ...optionsJSON.user,
      id: base64urlToBuffer(optionsJSON.user.id),
    }
    : undefined;

  return {
    ...optionsJSON,
    challenge: base64urlToBuffer(optionsJSON.challenge),
    user,
    excludeCredentials: (optionsJSON.excludeCredentials || []).map((cred) => ({
      ...cred,
      id: base64urlToBuffer(cred.id),
    })),
  };
}

function toCredentialRequestOptions(optionsJSON) {
  return {
    ...optionsJSON,
    challenge: base64urlToBuffer(optionsJSON.challenge),
    allowCredentials: (optionsJSON.allowCredentials || []).map((cred) => ({
      ...cred,
      id: base64urlToBuffer(cred.id),
    })),
  };
}

/** Convert a `PublicKeyCredential` back into plain JSON for the API. */
function serialise(credential) {
  const response = credential.response;
  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment || undefined,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      attestationObject: response.attestationObject
        ? bufferToBase64url(response.attestationObject)
        : undefined,
      authenticatorData: bufferToBase64url(response.authenticatorData),
      signature: bufferToBase64url(response.signature),
      userHandle: response.userHandle ? bufferToBase64url(response.userHandle) : undefined,
    },
  };
}

function friendlyError(err) {
  if (!(err instanceof Error)) return 'Something went wrong';
  switch (err.name) {
    case 'NotAllowedError':
      return 'Passkey prompt was dismissed or timed out';
    case 'InvalidStateError':
      return 'A passkey for this device already exists';
    case 'NotSupportedError':
    case 'SecurityError':
      return 'This browser cannot use passkeys. Try a fingerprint, face or device PIN.';
    case 'AbortError':
      return 'Passkey request was cancelled';
    default:
      return err.message || 'Something went wrong';
  }
}

/** Create a new passkey for the signed-in account. */
export async function registerPasskey() {
  if (!isPasskeySupported()) {
    throw new Error('This browser cannot use passkeys');
  }

  const options = await api.webauthn.registerOptions();

  let credential;
  try {
    credential = await navigator.credentials.create({
      publicKey: toCredentialCreationOptions(options),
    });
  } catch (err) {
    throw new Error(friendlyError(err));
  }

  if (!credential) throw new Error('No passkey was created');

  return api.webauthn.registerVerify(serialise(credential));
}

/**
 * Sign in with an existing passkey. Passing an email scopes the prompt to that
 * account's passkeys; omitting it lets the browser offer any passkey it holds
 * for this site, which is the one-tap "Sign in with your fingerprint" path.
 */
export async function loginWithPasskey(email) {
  if (!isPasskeySupported()) {
    throw new Error('This browser cannot use passkeys');
  }

  const options = await api.webauthn.loginOptions(email || undefined);

  let assertion;
  try {
    assertion = await navigator.credentials.get({
      publicKey: toCredentialRequestOptions(options),
    });
  } catch (err) {
    throw new Error(friendlyError(err));
  }

  if (!assertion) throw new Error('No passkey was used');

  return api.webauthn.loginVerify(serialise(assertion));
}

export function listPasskeys() {
  return api.webauthn.credentials();
}

export function removePasskey(id) {
  return api.webauthn.removeCredential(id);
}

export default {
  isPasskeySupported,
  registerPasskey,
  loginWithPasskey,
  listPasskeys,
  removePasskey,
};