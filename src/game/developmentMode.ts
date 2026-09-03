export function shouldUseMedicalDevelopmentStart(isDevelopment: boolean, search: string): boolean {
  if (!isDevelopment) return false;
  return new URLSearchParams(search).get("medicalDev") === "1";
}
