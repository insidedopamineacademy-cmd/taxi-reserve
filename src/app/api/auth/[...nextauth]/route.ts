import NextAuth from "next-auth";
import { identityAuthOptions } from "@/lib/auth";

const handler = NextAuth(identityAuthOptions);
export { handler as GET, handler as POST };
