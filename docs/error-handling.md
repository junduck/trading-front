# Error Handling Design

## Overview

Trading-front uses a unified, severity-based error handling system designed for:
- **Clear control flow**: Errors automatically trigger appropriate actions
- **AI inspection**: Structured, JSON-serializable error data
- **Lightweight**: Minimal overhead, essential fields only
- **Production-ready**: Integrates with monitoring services

## Core Concepts

### Error Severity Levels

| Severity | Behavior | Use Case |
|----------|----------|----------|
| `recover` | Log and continue | Transient errors, missing data, retryable failures |
| `cancel` | Cancel pending orders, log, continue | Validation failures, risk limit breaches |
| `halt` | Cancel pending, disconnect, graceful exit | Provider disconnection, critical state issues |
| `fatal` | Immediate termination | System integrity compromised |

### Control Flow

```typescript
TradingBot main loop:
  ├─ Event received
  ├─ Middleware chain executes
  ├─ Error thrown?
  │  ├─ No → Process pending orders → Continue
  │  └─ Yes → ErrorHandler determines action:
  │     ├─ recover → Log → Continue to next event
  │     ├─ cancel → Cancel pending orders → Log → Continue
  │     ├─ halt → Cancel pending → Disconnect → Stop bot
  │     └─ fatal → Cancel pending → Disconnect → Stop → Re-throw
  └─ Next event
```

### TradingError Structure

```typescript
class TradingError {
  // Core fields
  severity: ErrorSeverity;      // Control flow decision
  source: ErrorSource;          // Where it originated
  category: ErrorCategory;      // Semantic classification
  event: Event;                 // Event that triggered error
  message: string;              // Human-readable description
  timestamp: Date;              // When it occurred

  // Optional fields
  sourceName?: string;          // Middleware/algorithm name
  cause?: Error;                // Wrapped error
  metadata?: Record<string, unknown>;  // Additional context
}
```

## Usage Patterns

### 1. Middleware Handles Error Internally

If middleware can handle the error, just don't throw:

```typescript
const safeMiddleware: Algorithm = async (ctx, next) => {
  try {
    const price = ctx.snapshot.price.get("AAPL");
    if (!price) {
      console.log("Price not available, skipping");
      return; // Handle internally, don't throw
    }
    await next();
  } catch (error) {
    console.log("Handled:", error);
    // Don't re-throw
  }
};
```

### 2. Recoverable Errors

For transient errors that should be logged but allow processing to continue:

```typescript
const middleware: Algorithm = async (ctx, next) => {
  if (someTransientCondition) {
    throw TradingErrors.middleware(
      "Temporary issue occurred",
      ctx.event,
      "myMiddleware",
      { severity: "recover" }
    );
  }
  await next();
};
```

### 3. Cancel Pending Orders

When validation fails or risk limits are breached:

```typescript
const riskCheck: Algorithm = async (ctx, next) => {
  await next(); // Let others queue orders

  const pending = ctx._getPendingActions();
  const totalRisk = calculateRisk(pending);

  if (totalRisk > MAX_RISK) {
    throw TradingErrors.validation(
      `Risk limit exceeded: ${totalRisk}`,
      ctx.event,
      {
        severity: "cancel",
        metadata: { totalRisk, maxRisk: MAX_RISK }
      }
    );
  }
};
```

### 4. Halt Bot on Critical Error

For provider failures or critical state issues:

```typescript
const providerCheck: Algorithm = async (ctx, next) => {
  try {
    await ctx.dataProvider.connect();
    await next();
  } catch (error) {
    throw TradingErrors.provider(
      "Provider connection lost",
      ctx.event,
      "DataProvider",
      {
        severity: "halt",
        category: "network",
        cause: error instanceof Error ? error : undefined
      }
    );
  }
};
```

### 5. Custom Error Logging with Pino

The error handling system uses [pino](https://github.com/pinojs/pino) for structured, high-performance logging:

```typescript
import pino from "pino";
import {
  createDefaultLogger,
  createPinoErrorLogger,
  TradingBot
} from "@junduck/trading-front";

// Create custom pino logger
const logger = createDefaultLogger(); // Uses pino-pretty in development

// File logger for AI analysis
const fileLogger = pino(pino.destination({ dest: "./errors.log" }));

const bot = new TradingBot(
  dataProvider,
  tradeProvider,
  symbols,
  undefined,
  {
    errorCallbacks: [
      // Default pino logger (pretty-printed in dev)
      createPinoErrorLogger(logger),

      // JSON file for AI inspection
      createPinoErrorLogger(fileLogger),

      // Custom integration (Sentry, Datadog, etc.)
      async (error: TradingError) => {
        await Sentry.captureException(error, {
          extra: error.metadata,
          tags: {
            severity: error.severity,
            source: error.source,
            category: error.category
          }
        });
      }
    ]
  }
);
```

#### Pino Logger Features

- **Structured logging**: All errors logged as JSON with consistent schema
- **Performance**: Zero-cost abstractions, minimal overhead
- **Pretty printing**: Human-readable output in development (via pino-pretty)
- **Multiple transports**: Console, file, remote, etc.
- **Log levels**: Maps error severity to pino levels (info, warn, error, fatal)

## AI-Friendly Design

The error system uses pino for structured, JSON-based logging optimized for AI inspection:

### Pino Structured Output

When using `createPinoErrorLogger()`, errors are logged as structured JSON:

```typescript
// Example pino output (development with pino-pretty)
[10:30:15.123] INFO: Risk limit exceeded
  severity: "cancel"
  source: "middleware"
  sourceName: "riskCheck"
  category: "validation"
  event: {
    type: "market"
    timestamp: "2025-11-12T10:29:59.000Z"
  }
  metadata: {
    totalRisk: 150000
    maxRisk: 100000
  }

// Example pino output (production, raw JSON)
{"level":30,"time":1731408615123,"severity":"cancel","source":"middleware","sourceName":"riskCheck","category":"validation","event":{"type":"market","timestamp":"2025-11-12T10:29:59.000Z"},"metadata":{"totalRisk":150000,"maxRisk":100000},"msg":"Risk limit exceeded"}
```

### TradingError JSON Serialization

```typescript
const error = new TradingError({...});
const json = error.toJSON();

// Returns:
{
  "name": "TradingError",
  "message": "Risk limit exceeded",
  "severity": "cancel",
  "source": "middleware",
  "category": "validation",
  "sourceName": "riskCheck",
  "timestamp": "2025-11-12T10:30:00.000Z",
  "event": {
    "type": "market",
    "timestamp": "2025-11-12T10:29:59.000Z"
  },
  "metadata": {
    "totalRisk": 150000,
    "maxRisk": 100000
  },
  "stack": "..."
}
```

### Semantic Classification

- **ErrorSource**: Identifies where the error originated (middleware, provider, system, etc.)
- **ErrorCategory**: Semantic meaning (network, data, execution, validation, etc.)
- **Severity**: Control flow action (recover, cancel, halt, fatal)

This structured format allows AI agents to:
- Analyze error patterns across trading sessions
- Suggest middleware improvements
- Detect systemic issues
- Auto-tune risk parameters

## Design Principles

### 1. Lightweight

Only essential fields are required. Optional metadata is available for debugging but not mandatory.

### 2. Fail-Safe

- Error callbacks are wrapped in try-catch to prevent cascading failures
- Default console logger is always available
- Error handler never throws (returns control flow decision)

### 3. Separation of Concerns

- **TradingError**: Structured error data
- **ErrorHandler**: Control flow logic
- **ErrorCallback**: Logging/monitoring (user-defined)

### 4. Type-Safe

All error types are strongly typed. Convenience constructors (`TradingErrors.*`) provide common patterns with correct defaults.

## Migration Guide

### From Old `AgentError`

**Before:**
```typescript
export interface AgentError {
  error: Error;
  event: Event;
  middleware?: string;
}

bot.on('error', (agentError: AgentError) => {
  console.log(agentError.error.message);
});
```

**After:**
```typescript
bot.onError((tradingError: TradingError) => {
  console.log(tradingError.toString());
  console.log(tradingError.toJSON());
});
```

### Error Recovery Flag

**Before:**
```typescript
const bot = new TradingBot(
  dataProvider,
  tradeProvider,
  symbols,
  undefined,
  errorRecovery: true  // Boolean flag
);
```

**After:**
```typescript
// Error recovery is now automatic based on severity
// No flag needed - middleware controls behavior via severity
const bot = new TradingBot(
  dataProvider,
  tradeProvider,
  symbols,
  undefined,
  {
    errorCallbacks: [customLogger]  // Optional
  }
);
```

## Best Practices

1. **Use appropriate severity**: Choose the right level for each error type
2. **Add metadata**: Include relevant context for debugging (lightweight)
3. **Throw early**: Let the system handle control flow
4. **Log to external services**: Use error callbacks for production monitoring
5. **Structured logging**: Use `error.toJSON()` for AI inspection
6. **Source names**: Always provide middleware/algorithm names for traceability

## Future Enhancements

- [ ] Error aggregation and deduplication
- [ ] Rate limiting for error callbacks
- [ ] Retry policies for recoverable errors
- [ ] Error metrics (count by severity/category)
- [ ] AI-powered error diagnosis
- [ ] Automatic recovery strategies
