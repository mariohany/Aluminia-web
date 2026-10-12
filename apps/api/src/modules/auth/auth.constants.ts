export const REFRESH_COOKIE_NAME = 'refresh_token';
export const REFRESH_COOKIE_PATH = '/';

// How long a refresh token we have rotated away stays accepted. Page
// loads firing /auth/refresh at the same instant (Chrome restoring
// several tabs) all present the same cookie; every one after the first
// would otherwise present a token the session row has already replaced
// and get logged out. A minute is far longer than any such overlap and
// far shorter than the session itself, so a genuinely stolen old token
// is worthless within moments.
export const REFRESH_GRACE_MS = 60_000;

// How many rotated-away tokens to keep. Each concurrent tab in one such
// burst consumes one slot (the first rotates the real token, the rest
// rotate a grace token onwards), so this is the number of tabs that can
// wake together before the slowest one is pushed out of the window.
export const REFRESH_GRACE_DEPTH = 5;

// Failed-login limit (stability S1, LoginAttemptsService): 5 failures
// per email and 20 per IP in a 15-minute window. The IP allowance is
// higher because an office shares one address.
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60_000;
export const LOGIN_FAILURE_LIMIT_PER_EMAIL = 5;
export const LOGIN_FAILURE_LIMIT_PER_IP = 20;

// /auth/refresh and /auth/logout, per IP: both are public and hit the
// database. A tab refreshes about once per access-token lifetime, so
// this leaves room for many tabs and several staff behind one address.
export const REFRESH_RATE_LIMIT = { limit: 60, ttl: 15 * 60_000 };
