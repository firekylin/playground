// Adapt only official theme ZIP downloads; Firekylin still validates the SHA-512 digest.
module.exports = function installThemeProxy(origin) {
    if (!origin) return;
    const base = new URL(origin);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, options = {}) => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
        if (url.origin === 'https://github.com' &&
            /^\/firekylin\/themes\/releases\/download\/[a-z0-9][a-z0-9._+-]*\/[a-z0-9][a-z0-9._+-]*\.zip$/i.test(url.pathname) &&
            !url.search && !url.hash && !url.username && !url.password &&
            (!options.method || options.method === 'GET')) {
            const proxy = new URL('/api/theme', base);
            proxy.searchParams.set('url', url.href);
            return originalFetch(proxy, {signal: options.signal, redirect: 'error'});
        }
        return originalFetch(input, options);
    };
};
