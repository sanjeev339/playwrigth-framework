const secretPatterns = [
  /OPENAI_API_KEY\s*=\s*[^\s]+/gi,
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

  if (process.env.LOGIN_PASSWORD) {
    text = text.split(process.env.LOGIN_PASSWORD).join('[REDACTED_LOGIN_PASSWORD]');
  }

  return text;
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
  const suffix = meta === undefined ? '' : ` ${redactSecrets(meta)}`;
  return `[${new Date().toISOString()}] ${level} ${message}${suffix}`;
}
