import NavbarClient from "@/components/NavbarClient";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getEmailInboxAccess } from "@/lib/emails/permissions";

type Props = {
  assistantEnabled: boolean;
};

export default async function ServerNavbar({ assistantEnabled }: Props) {
  const [access, session] = await Promise.all([
    getEmailInboxAccess(),
    getServerSession(authOptions),
  ]);

  return (
    <NavbarClient
      userEmail={access.email}
      canAccessInbox={access.allowed}
      isAdmin={session?.user?.role === "ADMIN"}
      assistantEnabled={assistantEnabled && Boolean(access.email)}
    />
  );
}
