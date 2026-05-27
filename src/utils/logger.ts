import { ZodError } from 'zod';

const secretPatterns = [
  /OPENAI_API_KEY\s*=\s*[^\s]+/gi,
  /GEMINI_API_KEY\s*=\s*[^\s]+/gi,
  /LOGIN_PASSWORD\s*=\s*[^\s]+/gi,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /eyJ[A-Za-z0-9._-]+?\.[A-Za-z0-9._-]+?\.[A-Za-z0-9._-]+/g
];

export function redactSecrets(value: unknown): string {
  let text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);

  for (const pattern of secretPatterns) {
    text = text.replace(pattern, '[REDACTED]');
  }

  if (process.env.OPENAI_API_KEY) {
    text = text.split(process.env.OPENAI_API_KEY).join('[REDACTED_OPENAI_API_KEY]');
  }

  if (process.env.GEMINI_API_KEY) {
    text = text.split(process.env.GEMINI_API_KEY).join('[REDACTED_GEMINI_API_KEY]');
  }

  if (process.env.LOGIN_PASSWORD) {
    text = text.split(process.env.LOGIN_PASSWORD).join('[REDACTED_LOGIN_PASSWORD]');
  }

  return text;
}

/** Formats any thrown value for logs (Error, ZodError, API errors, plain objects). */
export function formatForLog(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }

  if (typeof value === 'string') {
    return redactSecrets(value);
  }

  if (value instanceof Error) {
    const lines: string[] = [`${value.name}: ${value.message}`];

    if (value instanceof ZodError) {
      lines.push(formatZodIssues(value));
    }

    const enriched = value as Error & { status?: number; code?: string | number };
    if (enriched.status !== undefined) {
      lines.push(`status: ${enriched.status}`);
    }
    if (enriched.code !== undefined) {
      lines.push(`code: ${enriched.code}`);
    }

    if (value.cause !== undefined) {
      lines.push(`cause: ${formatForLog(value.cause)}`);
    }

    if (value.stack) {
      lines.push(value.stack);
    }

    return redactSecrets(lines.join('\n'));
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const parts: string[] = [];

    if (typeof record.message === 'string') {
      parts.push(record.message);
    }
    if (record.status !== undefined) {
      parts.push(`status: ${record.status}`);
    }
    if (record.code !== undefined) {
      parts.push(`code: ${record.code}`);
    }
    if (record.type !== undefined) {
      parts.push(`type: ${record.type}`);
    }

    if (parts.length > 0) {
      return redactSecrets(parts.join(' | '));
    }

    try {
      return redactSecrets(JSON.stringify(value, null, 2));
    } catch {
      return redactSecrets(String(value));
    }
  }

  return redactSecrets(String(value));
}

function formatZodIssues(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `  - ${path}: ${issue.message}`;
    })
    .join('\n');
}

export const logger = {
  info(message: string, meta?: unknown): void {
    console.log(format('INFO', message, meta));
  },
  warn(message: string, meta?: unknown): void {
    console.warn(format('WARN', message, meta));
  },
  error(message: string, meta?: unknown): void {
    console.error(format('ERROR', message, meta));
  }
};

function format(level: string, message: string, meta?: unknown): string {
  const prefix = `[${new Date().toISOString()}] ${level} ${message}`;
  if (meta === undefined) {
    return prefix;
  }

  const details = formatForLog(meta);
  if (!details) {
    return prefix;
  }

  if (details.includes('\n')) {
    return `${prefix}\n${details
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n')}`;
  }

  return `${prefix} — ${details}`;
}
