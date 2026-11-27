import jwt from 'jsonwebtoken';

let app = null;
let pushTokenCache = { value: null, expiresAt: 0, clientEmail: null };

async function getFirebaseAdmin() {
  if (app) return app;

  let admin;
  try {
    admin = (await import('firebase-admin')).default;
  } catch {
    return null;
  }

  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;

  if (serviceAccount) {
    app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
  } else if (process.env.FIREBASE_PROJECT_ID) {
    app = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
  } else {
    app = admin.initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID || 'tradehub-demo',
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
  }

  return app;
}

export async function verifyFirebaseToken(idToken) {
  try {
    const firebaseApp = await getFirebaseAdmin();
    if (!firebaseApp) return null;
    const decodedToken = await firebaseApp.auth().verifyIdToken(idToken);
    return decodedToken;
  } catch (err) {
    return null;
  }
}

function pushServiceAccount() {
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    }
  } catch {
    return null;
  }
  if (
    process.env.FIREBASE_PROJECT_ID
    && process.env.FIREBASE_CLIENT_EMAIL
    && process.env.FIREBASE_PRIVATE_KEY
  ) {
    return {
      project_id: process.env.FIREBASE_PROJECT_ID,
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
  }
  return null;
}

async function getPushAccessToken(serviceAccount) {
  const now = Date.now();
  if (
    pushTokenCache.value
    && pushTokenCache.expiresAt > now
    && pushTokenCache.clientEmail === serviceAccount.client_email
  ) {
    return pushTokenCache.value;
  }
  const issuedAt = Math.floor(now / 1000);
  const assertion = jwt.sign(
    {
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: issuedAt,
      exp: issuedAt + 3600,
    },
    serviceAccount.private_key,
    { algorithm: 'RS256' }
  );
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!response.ok) throw new Error(`FCM auth failed: ${response.status}`);
  const payload = await response.json();
  pushTokenCache = {
    value: payload.access_token,
    expiresAt: Date.now() + (Number(payload.expires_in) * 1000) - 60000,
    clientEmail: serviceAccount.client_email,
  };
  return payload.access_token;
}

export async function sendPushNotification(tokens, notification) {
  const serviceAccount = pushServiceAccount();
  if (!serviceAccount) return null;

  try {
    const accessToken = await getPushAccessToken(serviceAccount);
    const url = `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`;
    const messageNotification = {
      title: notification.title,
      body: notification.body,
      ...(notification.image && { image: notification.image }),
    };
    const data = Object.fromEntries(
      Object.entries(notification.data || {}).map(([key, value]) => [
        key,
        typeof value === 'string' ? value : JSON.stringify(value),
      ])
    );
    const targetTokens = Array.isArray(tokens) ? tokens : [tokens];
    const responses = [];
    let successCount = 0;
    let failureCount = 0;

    for (const token of targetTokens) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message: { token, notification: messageNotification, data } }),
        });
        if (response.ok) {
          const payload = await response.json();
          successCount++;
          responses.push({ success: true, messageId: payload.name });
        } else {
          failureCount++;
          responses.push({ success: false, error: await response.text() });
        }
      } catch (err) {
        failureCount++;
        responses.push({ success: false, error: err.message });
      }
    }

    return { successCount, failureCount, responses };
  } catch (err) {
    console.error('FCM send error:', err.message);
    return null;
  }
}

export async function uploadToFirebaseStorage(buffer, destinationPath, contentType) {
  try {
    const firebaseApp = await getFirebaseAdmin();
    if (!firebaseApp) return null;
    const bucket = firebaseApp.storage().bucket();
    const file = bucket.file(destinationPath);
    await file.save(buffer, { contentType, public: true });
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: '2030-01-01',
    });
    return url;
  } catch (err) {
    console.error('Firebase Storage upload error:', err.message);
    return null;
  }
}

export async function deleteFromFirebaseStorage(filePath) {
  try {
    const firebaseApp = await getFirebaseAdmin();
    if (!firebaseApp) return false;
    const bucket = firebaseApp.storage().bucket();
    await bucket.file(filePath).delete();
    return true;
  } catch {
    return false;
  }
}

export { getFirebaseAdmin };
export default getFirebaseAdmin;
