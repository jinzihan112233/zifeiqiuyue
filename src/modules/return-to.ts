export function safeReturnTo(value: string | null | undefined) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(value)) return '/account';
  try {
    const url = new URL(value, 'https://local.invalid');
    if (url.origin !== 'https://local.invalid' || /^\/(api|login|register|recover)(\/|$)/.test(url.pathname)) return '/account';
    return url.pathname + url.search + url.hash;
  } catch { return '/account'; }
}
