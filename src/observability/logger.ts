import winston from "winston";
import { config } from "../config";

function redactSecrets(value: string): string {
  return value
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\bcog_[A-Za-z0-9_-]+\b/g, "[REDACTED_DEVIN_KEY]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, "[REDACTED_GITHUB_TOKEN]");
}

export function sanitizeLogMetadata(
  meta: Record<string, unknown> = {},
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(meta).map(([key, value]) => {
      if (!(value instanceof Error)) return [key, value];
      const safe: Record<string, unknown> = {
        name: value.name,
        message: redactSecrets(value.message),
      };
      const details = value as Error & {
        status?: unknown;
        retryable?: unknown;
        terminationConfirmed?: unknown;
      };
      if (typeof details.status === "number") safe.status = details.status;
      if (typeof details.retryable === "boolean")
        safe.retryable = details.retryable;
      if (typeof details.terminationConfirmed === "boolean")
        safe.terminationConfirmed = details.terminationConfirmed;
      return [key, safe];
    }),
  );
}

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.printf(({ timestamp, level, message, ...metadata }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(metadata).length > 0) {
      msg += ` ${JSON.stringify(metadata)}`;
    }
    return msg;
  }),
);

export const logger = winston.createLogger({
  level: config.server.nodeEnv === "production" ? "info" : "debug",
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: consoleFormat,
    }),
    new winston.transports.File({
      filename: "logs/error.log",
      level: "error",
    }),
    new winston.transports.File({
      filename: "logs/combined.log",
    }),
  ],
});

export class LoggerWithMetadata {
  constructor(private context: string) {}

  info(message: string, meta?: Record<string, unknown>) {
    logger.info(message, {
      context: this.context,
      ...sanitizeLogMetadata(meta),
    });
  }

  error(message: string, meta?: Record<string, unknown>) {
    logger.error(message, {
      context: this.context,
      ...sanitizeLogMetadata(meta),
    });
  }

  warn(message: string, meta?: Record<string, unknown>) {
    logger.warn(message, {
      context: this.context,
      ...sanitizeLogMetadata(meta),
    });
  }

  debug(message: string, meta?: Record<string, unknown>) {
    logger.debug(message, {
      context: this.context,
      ...sanitizeLogMetadata(meta),
    });
  }
}

export function getLogger(context: string): LoggerWithMetadata {
  return new LoggerWithMetadata(context);
}
