export function GET(request: Request) { return Response.redirect(new URL('/articles', request.url), 308); }
