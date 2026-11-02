import type { ContactFields } from "../core/types";

export const EVENT_NAME_LIMIT = 200;
export const CONTACT_FIELD_LIMITS = { firstName: 200, lastName: 200, company: 300, email: 320, jobTitle: 300, phone: 100 } as const;
const labels = { firstName: "first name", lastName: "last name", company: "company", email: "email", jobTitle: "job title", phone: "phone" };

export function backupTextIssue(fields: ContactFields | undefined, eventName?: string): string | undefined {
  if (eventName !== undefined && eventName.length > EVENT_NAME_LIMIT) return "Shorten event name to 200 characters for cloud backup. Local CSV export is still available.";
  for (const field of Object.keys(CONTACT_FIELD_LIMITS) as (keyof ContactFields)[]) {
    const value = fields?.[field];
    if (value && value.length > CONTACT_FIELD_LIMITS[field]) return `Shorten ${labels[field]} to ${CONTACT_FIELD_LIMITS[field]} characters for cloud backup. Saving and CSV export still work.`;
    if (value?.includes("\0")) return `Remove unsupported characters from ${labels[field]} for cloud backup. Saving and CSV export still work.`;
  }
}

export class BackupTextError extends Error {}
