// src/middleware.ts
import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: { signIn: "/login" },
  callbacks: {
    authorized: ({ token, req }) => {
      if (
        req.nextUrl.pathname.startsWith("/admin") ||
        req.nextUrl.pathname.startsWith("/drivers") ||
        req.nextUrl.pathname.startsWith("/commissions") ||
        req.nextUrl.pathname.startsWith("/payments")
      ) {
        return token?.role === "ADMIN";
      }
      return !!token;
    },
  },
});

export const config = {
  matcher: [
    "/reservations/:path*",
    "/emails/:path*",
    "/settings/:path*",
    "/admin/:path*",
    "/drivers/:path*",
    "/commissions/:path*",
    "/payments/:path*",
    "/activity-log/:path*",
  ],
};
