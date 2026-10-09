let pendingPromise = null;

function loadPaystack() {
  if (window.PaystackPop) return Promise.resolve(window.PaystackPop);
  if (pendingPromise) return pendingPromise;

  pendingPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://js.paystack.co/v1/inline.js';
    script.async = true;
    script.onload = () => (window.PaystackPop ? resolve(window.PaystackPop) : reject(new Error('Paystack script did not load')));
    script.onerror = () => reject(new Error('Failed to load Paystack script'));
    document.head.appendChild(script);
  });

  pendingPromise.finally(() => { pendingPromise = null; });
  return pendingPromise;
}

function payWithCard({
  publicKey,
  email,
  amountCents,
  currency = 'NGN',
  reference,
  accessCode,
  channels,
  onSuccess,
  onClose,
  onError,
}) {
  return loadPaystack().then((PaystackPop) => {
    const setup = {
      key: publicKey,
      email: email || (window.__tradehub_user_email__ || ''),
      amount: Math.round(amountCents),
      currency,
      ref: reference,
      access_code: accessCode,
      // Restrict the popup to the channels the buyer chose at checkout
      // (card, ussd, qr, mobile_money, bank…). Omitting it lets Paystack show
      // every channel enabled on the account.
      channels: Array.isArray(channels) && channels.length ? channels : undefined,
      callback: () => {
        // Paystack Pop returns on success; always verify server-side using the
        // original reference rather than trusting the browser.
        onSuccess(reference);
      },
      onClose,
    };
    const handler = PaystackPop.setup(setup);
    handler.openIframe();
  }).catch((err) => {
    if (onError) onError(err);
  });
}

export { loadPaystack, payWithCard };