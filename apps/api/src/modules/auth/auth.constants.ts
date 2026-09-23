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
