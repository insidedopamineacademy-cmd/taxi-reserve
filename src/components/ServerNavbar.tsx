import NavbarClient from "@/components/NavbarClient";
import { getEmailInboxAccess } from "@/lib/emails/permissions";

export default async function ServerNavbar() {
  const access = await getEmailInboxAccess();

  return (
    <NavbarClient
      userEmail={access.email}
      canAccessInbox={access.allowed}
    />
  );
}
