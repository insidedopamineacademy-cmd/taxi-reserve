import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { createDeviceSession, logoutDeviceSession } from "@/lib/security/sessionCore";
import { decodeRegisteredToken } from "@/lib/security/token";
import { SESSION_MAX_AGE_SECONDS } from "@/lib/security/policy";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  jwt: { decode: decodeRegisteredToken },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password;
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user?.password || user.status !== "ACTIVE") return null;

        const ok = await bcrypt.compare(password, user.password);
        if (!ok) return null;

        const headers = new Headers();
        for (const [key, value] of Object.entries(request.headers ?? {})) {
          if (typeof value === "string") headers.set(key, value);
        }
        const registered = await createDeviceSession(prisma, user.id, user.password, headers);

        return {
          id: user.id,
          email: registered.user.email,
          name: registered.user.name,
          role: registered.user.role,
          sid: registered.session.id,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) { token.role = user.role; token.sid = user.sid; }
      return token;
    },
    async session({ session, token }) {
      return identitySession(session, token);
    },
  },
  events: {
    async signOut(message) {
      if (message.token) await logoutDeviceSession(prisma, message.token);
    },
  },
  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
};

function identitySession(session: import("next-auth").Session, token: import("next-auth/jwt").JWT) {
  return {
    ...session,
    user: { ...session.user, id: token.sub, email: token.email, name: token.name, role: token.role },
    id: token.sid, expires: token.sessionExpiresAt ?? session.expires, expiresAt: token.sessionExpiresAt,
    settingsUnlockedUntil: token.settingsUnlockedUntil,
  };
}
