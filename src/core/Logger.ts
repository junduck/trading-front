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
  /**
   * Log debug message (development/troubleshooting).
   *
   * @param message - Message object to log
   */
  debug(message: object): void;

  /**
   * Log info message (general information).
   *
   * @param message - Message object to log
   */
  info(message: object): void;

  /**
   * Log warning message (non-critical issues).
   *
   * @param message - Message object to log
   */
  warn(message: object): void;

  /**
   * Log error message (critical failures).
   *
   * @param message - Message object to log
   */
  error(message: object): void;
}

/**
 * Default pino logger implementation.
 */
export const defaultLogger: Logger = (() => {
  const isDev = process.env["NODE_ENV"] !== "production";

  const log = pino({
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

  return {
    debug: (message: object) => log.debug(message),
    info: (message: object) => log.info(message),
    warn: (message: object) => log.warn(message),
    error: (message: object) => log.error(message),
  };
})();
