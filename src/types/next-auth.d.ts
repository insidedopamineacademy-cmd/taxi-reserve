import type { Role } from "@prisma/client";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    id?: string;
    expiresAt?: string;
    user?: DefaultSession["user"] & {
      id?: string;
      role?: Role;
    };
  }

  interface User {
    role?: Role;
    sid?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: Role;
    sid?: string;
    sessionExpiresAt?: string;
  }
}
