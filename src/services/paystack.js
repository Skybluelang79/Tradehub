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
  onSuccess,
  onClose,
  onError,
}) {
  return loadPaystack().then((PaystackPop) => {
    const handler = PaystackPop.setup({
      key: publicKey,
      email: email || (window.__tradehub_user_email__ || ''),
      amount: Math.round(amountCents),
      currency,
      ref: reference,
      access_code: accessCode,
      callback: () => {
        if (accessCode) {
          // Paystack Pop with an access_code returns the paymentReference on
          // success; verify server-side using the original reference.
          onSuccess(reference);
          return;
        }
        onSuccess(reference);
      },
      onClose,
    });
    handler.openIframe();
  }).catch((err) => {
    if (onError) onError(err);
  });
}

export { loadPaystack, payWithCard };