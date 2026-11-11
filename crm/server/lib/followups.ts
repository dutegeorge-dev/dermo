export function followupsEnabled(): boolean {
  return process.env.MAIL_FOLLOWUPS_ENABLED?.trim().toLowerCase() === "true";
}
