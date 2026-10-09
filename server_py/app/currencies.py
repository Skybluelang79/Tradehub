DEFAULT_CURRENCY = "NGN"

PAYSTACK_CURRENCIES = ["NGN", "GHS", "KES", "ZAR", "UGX"]

AFRICAN_CURRENCIES = [
    {"code": "AOA", "symbol": "Kz"},
    {"code": "BIF", "symbol": "FBu"},
    {"code": "BWP", "symbol": "P"},
    {"code": "CDF", "symbol": "FC"},
    {"code": "CVE", "symbol": "$"},
    {"code": "DJF", "symbol": "DJF"},
    {"code": "DZD", "symbol": "DA"},
    {"code": "EGP", "symbol": "E\xa3"},
    {"code": "ERN", "symbol": "Nfk"},
    {"code": "ETB", "symbol": "Br"},
    {"code": "GHS", "symbol": "GH\u20b5"},
    {"code": "GMD", "symbol": "D"},
    {"code": "GNF", "symbol": "FG"},
    {"code": "KES", "symbol": "KSh"},
    {"code": "KMF", "symbol": "CF"},
    {"code": "LRD", "symbol": "L$"},
    {"code": "LSL", "symbol": "M"},
    {"code": "LYD", "symbol": "LD"},
    {"code": "MAD", "symbol": "DH"},
    {"code": "MGA", "symbol": "Ar"},
    {"code": "MWK", "symbol": "MK"},
    {"code": "MZN", "symbol": "MT"},
    {"code": "NAD", "symbol": "N$"},
    {"code": "NGN", "symbol": "\u20a6"},
    {"code": "RWF", "symbol": "FRw"},
    {"code": "SDG", "symbol": "\u00a3Sd"},
    {"code": "SCR", "symbol": "SR"},
    {"code": "SLE", "symbol": "Le"},
    {"code": "SOS", "symbol": "Sh"},
    {"code": "SSP", "symbol": "\u00a3SS"},
    {"code": "STN", "symbol": "Db"},
    {"code": "SZL", "symbol": "L"},
    {"code": "TZS", "symbol": "TSh"},
    {"code": "TND", "symbol": "DT"},
    {"code": "UGX", "symbol": "USh"},
    {"code": "XAF", "symbol": "FCFA"},
    {"code": "XOF", "symbol": "CFA"},
    {"code": "ZAR", "symbol": "R"},
    {"code": "ZMW", "symbol": "ZK"},
    {"code": "ZWG", "symbol": "Z$"},
]

USD_RATES = {
    "AOA": 915, "BIF": 2900, "BWP": 13.5, "CDF": 2850, "CVE": 102, "DJF": 177.7,
    "DZD": 133, "EGP": 48, "ERN": 15, "ETB": 130, "GHS": 10.5, "GMD": 70, "GNF": 8600,
    "KES": 129, "KMF": 455, "LRD": 197, "LSL": 18, "LYD": 4.8, "MAD": 9.2, "MGA": 4400,
    "MWK": 1740, "MZN": 63, "NAD": 18, "NGN": 1500, "RWF": 1440, "SDG": 600, "SCR": 14,
    "SLE": 21.5, "SOS": 571, "SSP": 3900, "STN": 22.5, "SZL": 18, "TZS": 2600, "TND": 3.1,
    "UGX": 3650, "XAF": 605, "XOF": 605, "ZAR": 18, "ZMW": 28, "ZWG": 13.5,
}

_BY_CODE = {c["code"]: c for c in AFRICAN_CURRENCIES}


def normalize_currency(code):
    return str(code or "").upper()


def is_valid_currency(code):
    key = normalize_currency(code)
    return key in _BY_CODE and USD_RATES.get(key, 0) > 0


def get_currency_symbol(code):
    return _BY_CODE.get(normalize_currency(code), {}).get("symbol") or normalize_currency(code)


def convert(amount, from_cur, to_cur):
    try:
        value = float(amount)
    except (TypeError, ValueError):
        return amount
    if not is_valid_currency(from_cur):
        src = DEFAULT_CURRENCY
    else:
        src = normalize_currency(from_cur)
    dst = normalize_currency(to_cur) if is_valid_currency(to_cur) else None
    if not dst or src == dst:
        return value
    return round((value * USD_RATES[src]) / USD_RATES[dst], 2)


def format_money(amount, currency=DEFAULT_CURRENCY):
    if not is_valid_currency(currency):
        code = DEFAULT_CURRENCY
    else:
        code = normalize_currency(currency)
    try:
        value = float(amount)
    except (TypeError, ValueError):
        value = 0.0
    symbol = get_currency_symbol(code)
    return f"{symbol}{value:,.0f}"