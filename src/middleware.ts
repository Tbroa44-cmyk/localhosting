import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl;
    const token = req.nextauth.token;

    if (pathname.startsWith("/admin") && !(token as any)?.isAdmin) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }

    if ((token as any)?.allowed === 1) {
      if (pathname.startsWith("/portfolio") || pathname.startsWith("/wallet")) {
        return NextResponse.redirect(new URL("/dashboard?banned=1", req.url));
      }
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  }
);

export const config = {
  matcher: ["/portfolio", "/wallet", "/admin/:path*"],
};
