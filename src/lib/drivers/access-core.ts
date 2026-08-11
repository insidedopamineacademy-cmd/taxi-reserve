export function isDriverAdminRole(role: unknown): role is "ADMIN" {
  return role === "ADMIN";
}
