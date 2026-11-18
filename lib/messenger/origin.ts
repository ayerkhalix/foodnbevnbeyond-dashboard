export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const url = new URL(request.url);
    const host = request.headers.get("host");
    // Next.js can use an internal hostname in the route URL behind a proxy.
    const expected = host
      ? new URL(`${url.protocol}//${host}`).origin
      : url.origin;
    return origin === expected;
  } catch {
    return false;
  }
}
