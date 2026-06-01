export interface PayloadIdentity {
  identityKey: string;
  identityValue: string;
}

const secretKeyPattern = /(password|passcode|secret|token|jwt|cookie|authorization|api[_-]?key)/i;

const identityPriority: Array<{ pattern: RegExp; score: number }> = [
  { pattern: /^emailaddress$|^email$|mail/i, score: 1 },
  { pattern: /^username$/i, score: 2 },
  { pattern: /^login$|loginname|loginid/i, score: 3 },
  { pattern: /^recordid$/i, score: 4 },
  { pattern: /^userid$/i, score: 5 },
  { pattern: /^customerid$/i, score: 6 },
  { pattern: /^licenseid$/i, score: 7 },
  { pattern: /^employeeid$/i, score: 8 },
  { pattern: /^fullname$/i, score: 9 },
  { pattern: /^displayname$/i, score: 10 },
  { pattern: /^name$/i, score: 11 },
  { pattern: /^phone$/i, score: 12 },
  { pattern: /^mobile$/i, score: 13 }
];

export function resolvePayloadIdentity(payload: Record<string, unknown>): PayloadIdentity | null {
  const stableEntries = Object.entries(payload)
    .filter(([key, value]) => !secretKeyPattern.test(key) && isStableNonEmptyString(value))
    .map(([key, value], index) => ({
      identityKey: key,
      identityValue: String(value).trim(),
      score: scoreIdentityKey(key),
      index
    }))
    .sort((left, right) => left.score - right.score || left.index - right.index);

  const best = stableEntries[0];
  if (!best) {
    return null;
  }

  return {
    identityKey: best.identityKey,
    identityValue: best.identityValue
  };
}

function scoreIdentityKey(key: string): number {
  const normalizedKey = normalize(key);
  const match = identityPriority.find((item) => item.pattern.test(normalizedKey));
  if (match) {
    return match.score;
  }

  if (/id$/.test(normalizedKey)) {
    return 20;
  }

  if (/name$/.test(normalizedKey) && !/firstname|lastname/i.test(normalizedKey)) {
    return 30;
  }

  if (/status|role|date|time|created|updated|first|last|description|comment|note/i.test(normalizedKey)) {
    return 100;
  }

  return 50;
}

function isStableNonEmptyString(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  const stringValue = String(value).trim();
  if (!stringValue) {
    return false;
  }

  return !/password|secret|token|jwt|bearer\s+/i.test(stringValue);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}
