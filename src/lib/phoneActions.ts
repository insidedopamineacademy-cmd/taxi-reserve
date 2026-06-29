export type NormalizedPhoneActions = {
  display: string;
  tel: string | null;
  whatsappDigits: string | null;
};

export function normalizePhoneForActions(phone: string): NormalizedPhoneActions | null {
  const display = phone.trim();
  if (!display) return null;

  const digits = display.replace(/\D/g, "");
  if (!digits) {
    return { display, tel: null, whatsappDigits: null };
  }

  return {
    display,
    tel: `${display.startsWith("+") ? "+" : ""}${digits}`,
    whatsappDigits: digits,
  };
}
