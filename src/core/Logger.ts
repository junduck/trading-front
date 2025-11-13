import pino from "pino";

/**
 * Log level for messages.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Logger interface for middleware and system logging.
 * Supports multiple log levels: debug, info, warn, error.
 */
export interface Logger {
  /** Log debug message. */
  debug(msg: string): void;
  debug(obj: object, msg?: string): void;

  /** Log info message. */
  info(msg: string): void;
  info(obj: object, msg?: string): void;

  /** Log warning message. */
  warn(msg: string): void;
  warn(obj: object, msg?: string): void;

  /** Log error message. */
  error(msg: string): void;
  error(obj: object, msg?: string): void;
}

/**
 * Default pino logger implementation.
 */
export const defaultLogger: Logger = (() => {
  const isDev = process.env["NODE_ENV"] !== "production";

  return pino({
    level: "debug",
    ...(isDev && {
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss.l",
          ignore: "pid,hostname",
        },
      },
    }),
  });
})();
