export const adminFetch = (input: RequestInfo | URL, init: RequestInit = {}) =>
    fetch(input, { ...init, credentials: 'include' });
