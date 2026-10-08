// Currency definitions shared by the frontend (Vite) and the backend (Node).
// Pure ESM with no side effects so both sides can import it directly.
//
// Rates in USD_RATES are APPROXIMATE, USD-anchored statics (units per 1 USD).
// They are intentionally baked in (no network dependency); update the numbers
// here to re-price the whole app. convert() anchors through USD so any pair
// can be derived without keeping a full cross-rate matrix.

export const DEFAULT_CURRENCY = 'NGN';

// Currencies Paystack can actually charge. Everything else is priced and
// stored in its own currency but settled in NGN at checkout (see payments.js).
export const PAYSTACK_CURRENCIES = ['NGN', 'GHS', 'KES', 'ZAR', 'UGX'];

// One entry per unique currency across all 54 African countries.
// Shared currencies (XOF/XAF) cover several countries each.
export const AFRICAN_CURRENCIES = [
  { code: 'AOA', name: 'Angolan Kwanza', symbol: 'Kz', countries: ['Angola'] },
  { code: 'BIF', name: 'Burundian Franc', symbol: 'FBu', countries: ['Burundi'] },
  { code: 'BWP', name: 'Botswana Pula', symbol: 'P', countries: ['Botswana'] },
  { code: 'CDF', name: 'Congolese Franc', symbol: 'FC', countries: ['DR Congo'] },
  { code: 'CVE', name: 'Cape Verdean Escudo', symbol: '$', countries: ['Cabo Verde'] },
  { code: 'DJF', name: 'Djiboutian Franc', symbol: 'DJF', countries: ['Djibouti'] },
  { code: 'DZD', name: 'Algerian Dinar', symbol: 'DA', countries: ['Algeria'] },
  { code: 'EGP', name: 'Egyptian Pound', symbol: 'E£', countries: ['Egypt'] },
  { code: 'ERN', name: 'Eritrean Nakfa', symbol: 'Nfk', countries: ['Eritrea'] },
  { code: 'ETB', name: 'Ethiopian Birr', symbol: 'Br', countries: ['Ethiopia'] },
  { code: 'GHS', name: 'Ghanaian Cedi', symbol: 'GH₵', countries: ['Ghana'] },
  { code: 'GMD', name: 'Gambian Dalasi', symbol: 'D', countries: ['Gambia'] },
  { code: 'GNF', name: 'Guinean Franc', symbol: 'FG', countries: ['Guinea'] },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', countries: ['Kenya'] },
  { code: 'KMF', name: 'Comorian Franc', symbol: 'CF', countries: ['Comoros'] },
  { code: 'LRD', name: 'Liberian Dollar', symbol: 'L$', countries: ['Liberia'] },
  { code: 'LSL', name: 'Lesotho Loti', symbol: 'M', countries: ['Lesotho'] },
  { code: 'LYD', name: 'Libyan Dinar', symbol: 'LD', countries: ['Libya'] },
  { code: 'MAD', name: 'Moroccan Dirham', symbol: 'DH', countries: ['Morocco', 'Western Sahara'] },
  { code: 'MGA', name: 'Malagasy Ariary', symbol: 'Ar', countries: ['Madagascar'] },
  { code: 'MWK', name: 'Malawian Kwacha', symbol: 'MK', countries: ['Malawi'] },
  { code: 'MZN', name: 'Mozambican Metical', symbol: 'MT', countries: ['Mozambique'] },
  { code: 'NAD', name: 'Namibian Dollar', symbol: 'N$', countries: ['Namibia'] },
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', countries: ['Nigeria'] },
  { code: 'RWF', name: 'Rwandan Franc', symbol: 'FRw', countries: ['Rwanda'] },
  { code: 'SDG', name: 'Sudanese Pound', symbol: '£Sd', countries: ['Sudan'] },
  { code: 'SCR', name: 'Seychellois Rupee', symbol: 'SR', countries: ['Seychelles'] },
  { code: 'SLE', name: 'Sierra Leonean Leone', symbol: 'Le', countries: ['Sierra Leone'] },
  { code: 'SOS', name: 'Somali Shilling', symbol: 'Sh', countries: ['Somalia'] },
  { code: 'SSP', name: 'South Sudanese Pound', symbol: '£SS', countries: ['South Sudan'] },
  { code: 'STN', name: 'São Tomé and Príncipe Dobra', symbol: 'Db', countries: ['São Tomé and Príncipe'] },
  { code: 'SZL', name: 'Swazi Lilangeni', symbol: 'L', countries: ['Eswatini'] },
  { code: 'TZS', name: 'Tanzanian Shilling', symbol: 'TSh', countries: ['Tanzania'] },
  { code: 'TND', name: 'Tunisian Dinar', symbol: 'DT', countries: ['Tunisia'] },
  { code: 'UGX', name: 'Ugandan Shilling', symbol: 'USh', countries: ['Uganda'] },
  { code: 'XAF', name: 'Central African CFA Franc', symbol: 'FCFA', countries: ['Cameroon', 'Central African Republic', 'Chad', 'Republic of the Congo', 'Equatorial Guinea', 'Gabon'] },
  { code: 'XOF', name: 'West African CFA Franc', symbol: 'CFA', countries: ['Benin', 'Burkina Faso', "Côte d'Ivoire", 'Guinea-Bissau', 'Mali', 'Niger', 'Senegal', 'Togo'] },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', countries: ['South Africa'] },
  { code: 'ZMW', name: 'Zambian Kwacha', symbol: 'ZK', countries: ['Zambia'] },
  { code: 'ZWG', name: 'Zimbabwe Gold', symbol: 'Z$', countries: ['Zimbabwe'] },
];

// Approximate static rates: units per 1 USD (2025 order of magnitude).
export const USD_RATES = {
  AOA: 915, BIF: 2900, BWP: 13.5, CDF: 2850, CVE: 102, DJF: 177.7,
  DZD: 133, EGP: 48, ERN: 15, ETB: 130, GHS: 10.5, GMD: 70, GNF: 8600,
  KES: 129, KMF: 455, LRD: 197, LSL: 18, LYD: 4.8, MAD: 9.2, MGA: 4400,
  MWK: 1740, MZN: 63, NAD: 18, NGN: 1500, RWF: 1440, SDG: 600, SCR: 14,
  SLE: 21.5, SOS: 571, SSP: 3900, STN: 22.5, SZL: 18, TZS: 2600, TND: 3.1,
  UGX: 3650, XAF: 605, XOF: 605, ZAR: 18, ZMW: 28, ZWG: 13.5,
};

const BY_CODE = Object.fromEntries(AFRICAN_CURRENCIES.map((c) => [c.code, c]));

export function normalizeCurrency(c) {
  return String(c || '').toUpperCase();
}

export function isValidCurrency(c) {
  const code = normalizeCurrency(c);
  return !!BY_CODE[code] && USD_RATES[code] > 0;
}

export function isPaystackCurrency(c) {
  return PAYSTACK_CURRENCIES.includes(normalizeCurrency(c));
}

export function getCurrency(code) {
  return BY_CODE[normalizeCurrency(code)] || null;
}

export function getCurrencySymbol(code) {
  return getCurrency(code)?.symbol || normalizeCurrency(code);
}

// Converts an amount from one currency to another through the USD anchor.
// Unknown source currencies are treated as NGN (DB defaults are 'NGN');
// unknown targets return the amount unchanged.
export function convert(amount, from, to) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return amount;
  const src = isValidCurrency(from) ? normalizeCurrency(from) : DEFAULT_CURRENCY;
  const dst = isValidCurrency(to) ? normalizeCurrency(to) : null;
  if (!dst || src === dst) return value;
  const result = (value * USD_RATES[src]) / USD_RATES[dst];
  return Number(result.toFixed(2));
}

// Formats an amount already expressed in `currency` (no conversion).
// Keeps whole units by default, matching the app's price display style.
export function formatMoney(amount, currency = DEFAULT_CURRENCY) {
  const code = isValidCurrency(currency) ? normalizeCurrency(currency) : DEFAULT_CURRENCY;
  const value = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  try {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    // Older ICU builds may not know newer codes (ZWG, SLE) yet.
    return `${getCurrencySymbol(code)}${value.toLocaleString('en-NG', { maximumFractionDigits: 0 })}`;
  }
}
