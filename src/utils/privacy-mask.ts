/**
 * PDPA Shield & Privacy Masking Utilities
 * For Legal & Court Digital Evidence Redaction
 */

export function maskAccountNumber(acc: string | null | undefined): string {
  if (!acc) return "-";
  const clean = acc.replace(/[\s-]/g, "");
  if (clean.length < 8) return acc;
  const start = clean.slice(0, 3);
  const end = clean.slice(-4);
  return `${start}-x-xx${end.slice(0, 2)}-${end.slice(2)}`;
}

export function maskNationalId(id: string | null | undefined): string {
  if (!id) return "-";
  const clean = id.replace(/[\s-]/g, "");
  if (clean.length !== 13) return id;
  return `${clean[0]}-xxxx-xxxxx-${clean.slice(10, 12)}-${clean[12]}`;
}

export function maskPhoneNumber(phone: string | null | undefined): string {
  if (!phone) return "-";
  const clean = phone.replace(/[\s-]/g, "");
  if (clean.length === 10) {
    return `${clean.slice(0, 2)}x-xxx-x${clean.slice(-3)}`;
  }
  return phone;
}

export function maskPersonName(name: string | null | undefined, enabled: boolean): string {
  if (!name || !enabled) return name || "-";
  const parts = name.trim().split(/\s+/);
  if (parts.length > 1) {
    const firstName = parts[0];
    const lastName = parts.slice(1).join(" ");
    return `${firstName} ${lastName[0]}...`;
  }
  return name;
}
