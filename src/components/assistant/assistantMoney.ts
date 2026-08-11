export function formatAssistantEuro(amount: string) {
  return amount.startsWith("-") ? `-€${amount.slice(1)}` : `€${amount}`;
}
