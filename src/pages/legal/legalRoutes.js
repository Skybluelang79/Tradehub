import { useEffect } from 'react';

export const LEGAL_ROUTES = ['/terms', '/privacy', '/faq', '/contact', '/report'];

export function getLegalPath() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  return LEGAL_ROUTES.includes(path) ? path : null;
}

export function navigateToLegalPath(path) {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo(0, 0);
}

export function useLegalMount() {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
}
