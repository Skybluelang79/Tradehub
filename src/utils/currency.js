// Frontend currency helpers. The user's chosen currency (stored server-side in
// user_settings.currency) lives here as module state so every formatPrice call
// converts into it without threading it through every component. AuthContext
// sets it once settings load; the Profile screen updates it on change.
import {
  AFRICAN_CURRENCIES,
  DEFAULT_CURRENCY,
  USD_RATES,
  isValidCurrency,
  isPaystackCurrency,
  getCurrency,
  getCurrencySymbol,
  convert,
  formatMoney,
} from '../../shared/currencies.js';

let displayCurrency = DEFAULT_CURRENCY;

export function setDisplayCurrency(code) {
  displayCurrency = isValidCurrency(code) ? String(code).toUpperCase() : DEFAULT_CURRENCY;
  return displayCurrency;
}

export function getDisplayCurrency() {
  return displayCurrency;
}

// Formats an amount for display, converting from its stored currency to the
// viewer's chosen currency. Existing callers that pass only an amount keep
// working: the source defaults to NGN, the app's base currency.
export function formatPrice(amount, fromCurrency = DEFAULT_CURRENCY) {
  const converted = convert(amount, fromCurrency, displayCurrency);
  return formatMoney(converted, displayCurrency);
}

export {
  AFRICAN_CURRENCIES,
  DEFAULT_CURRENCY,
  USD_RATES,
  isValidCurrency,
  isPaystackCurrency,
  getCurrency,
  getCurrencySymbol,
  convert,
  formatMoney,
};