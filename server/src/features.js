import { isPaystackConfigured } from './paystack.js';
import { isEmailConfigured } from './email.js';
import { isSmsConfigured } from './sms.js';
import { hasLLM } from './ai.js';

// Reports which optional third-party integrations have credentials configured
// at runtime. Booleans only — the secrets themselves are never returned. This
// is surfaced on /api/health and in the boot log so a production deploy can be
// verified without reading logs of an actual payment/email attempt.
export function integrationStatus() {
  const env = process.env;
  return {
    paystack: isPaystackConfigured(),
    paystackWebhook: Boolean(env.PAYSTACK_WEBHOOK_SECRET),
    email: isEmailConfigured(),
    sms: isSmsConfigured(),
    ai: hasLLM(),
    firebase: Boolean(env.FIREBASE_SERVICE_ACCOUNT || env.FIREBASE_PROJECT_ID),
    facebookLogin: Boolean(env.FACEBOOK_APP_ID && env.FACEBOOK_APP_SECRET),
  };
}
