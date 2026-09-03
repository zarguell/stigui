/**
 * STIG data lives on the same origin as the site, so the client always
 * fetches relatively. The server side (dev rendering and the static
 * export) needs an absolute base; it defaults to the local dev server,
 * which `NEXT_PUBLIC_API_URL` overrides (as CI does).
 */
export const API_BASE =
    typeof window === 'undefined'
        ? (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000')
        : '';
