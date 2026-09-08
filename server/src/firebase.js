let app = null;

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

export async function sendPushNotification(tokens, notification) {
  try {
    const firebaseApp = await getFirebaseAdmin();
    if (!firebaseApp) return null;
    const message = {
      notification: {
        title: notification.title,
        body: notification.body,
        ...(notification.image && { image: notification.image }),
      },
      data: notification.data || {},
      tokens: Array.isArray(tokens) ? tokens : [tokens],
    };
    const response = await firebaseApp.messaging().sendEachForMulticast(message);
    return response;
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
