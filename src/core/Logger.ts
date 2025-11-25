import pino, { type LoggerOptions as PinoOptions } from "pino";

export type Logger = pino.Logger;
export type LogLevel = pino.Level;

/**
 * Configuration options for creating a logger.
 */
export interface LoggerConfig {
  /** Minimum log level (default: 'info' in production, 'debug' in development) */
  level?: LogLevel;

  /** Enable pretty printing for development (default: true in dev, false in production) */
  pretty?: boolean;

  /** Additional pino options for advanced configuration */
  pinoOptions?: Omit<PinoOptions, "level">;
}

/**
 * Create a configured logger instance with standard serializers.
 *
 * @param config - Logger configuration options
 * @returns Configured logger instance
 *
 * @example
 * ```ts
 * // Production logger with JSON output
 * const logger = createLogger({ level: 'info', pretty: false });
 *
 * // Development logger with pretty output
 * const logger = createLogger({ level: 'debug', pretty: true });
 *
 * // Child logger with context
 * const botLogger = logger.child({ component: 'trading-bot' });
 * ```
 */
export function createLogger(config: LoggerConfig = {}): Logger {
  const isBrowser = typeof globalThis !== "undefined" && "window" in globalThis;
  const isDev = !isBrowser && process.env["NODE_ENV"] !== "production";

  const level = config.level ?? (isDev ? "debug" : "info");
  const pretty = config.pretty ?? isDev;

  const options: PinoOptions = {
    level,
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err,
    },
    // pino-pretty only works in Node.js, skip in browser
    ...(pretty && !isBrowser && {
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss.l",
          ignore: "pid,hostname",
          singleLine: false,
        },
      },
    }),
    // In browsers, pino uses browser configuration by default
    ...(isBrowser && {
      browser: {
        asObject: false,
      },
    }),
    ...config.pinoOptions,
  };

  return pino(options);
}

/**
 * Default logger instance for the library.
 * Uses environment-based configuration.
 */
export const defaultLogger: Logger = createLogger();

/**
 * Null logger that discards all log output.
 * Use when logging should be disabled.
 *
 * @example
 * ```ts
 * const bot = new TradingBot({
 *   logger: nullLogger,
 *   // ... other config
 * });
 * ```
 */
export const nullLogger: Logger = pino({ level: "silent" });
