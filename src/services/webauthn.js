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

let supportPromise = null;

/**
 * Probe the device once and cache the answer. `platform` is true when a
 * fingerprint/face sensor is actually present — this is what lets the login
 * screen say "fingerprint" instead of the vaguer "passkey". `conditional` is
 * true when the browser can surface passkeys inline inside an input field
 * (WebAuthn autofill / conditional mediation).
 */
export function passkeySupport() {
  if (!isPasskeySupported()) {
    return Promise.resolve({ supported: false, platform: false, conditional: false });
  }
  if (!supportPromise) {
    const { PublicKeyCredential } = window;
    const platform = typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
      ? PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false)
      : Promise.resolve(false);
    const conditional = typeof PublicKeyCredential.isConditionalMediationAvailable === 'function'
      ? PublicKeyCredential.isConditionalMediationAvailable().catch(() => false)
      : Promise.resolve(false);

    supportPromise = Promise.all([platform, conditional]).then(([platformAvailable, conditionalAvailable]) => ({
      supported: true,
      platform: platformAvailable,
      conditional: conditionalAvailable,
    }));
  }
  return supportPromise;
}

export function isPlatformAuthenticatorAvailable() {
  return passkeySupport().then((support) => support.platform);
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
      return 'Fingerprint sign-in was dismissed or timed out. Please try again.';
    case 'InvalidStateError':
      return 'This device is already set up for fingerprint sign-in';
    case 'NotSupportedError':
    case 'SecurityError':
      return 'This browser cannot use fingerprint sign-in. Set up a fingerprint, face unlock or device PIN and try again.';
    case 'AbortError':
      return 'Fingerprint sign-in was cancelled';
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
 *
 * `mediation: 'conditional'` runs the ceremony in autofill mode: no modal is
 * shown, the passkey just appears in the browser's autofill list for the
 * focused username field.
 */
export async function loginWithPasskey(email, { mediation } = {}) {
  if (!isPasskeySupported()) {
    throw new Error('This browser cannot use passkeys');
  }

  const options = await api.webauthn.loginOptions(email || undefined);

  let assertion;
  try {
    assertion = await navigator.credentials.get({
      publicKey: toCredentialRequestOptions(options),
      ...(mediation ? { mediation } : {}),
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
  passkeySupport,
  isPlatformAuthenticatorAvailable,
  registerPasskey,
  loginWithPasskey,
  listPasskeys,
  removePasskey,
};