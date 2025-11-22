// logger.js - Flexible logging system with categories and levels

// Log levels
const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
  TRACE: 4,
};

// Default log level from environment or INFO
const DEFAULT_LEVEL = process.env.LOG_LEVEL?.toUpperCase() || "INFO";

// Detect if running in CLI context (invokej/tasks.js)
const isCliContext = () => {
  // Check if main module contains 'tasks.js' or 'invokej'
  const mainModule = process.argv[1] || '';
  return mainModule.includes('tasks.js') ||
         mainModule.includes('invokej') ||
         mainModule.includes('invj');
};

// Parse LOG_CATEGORIES from environment
// Format: "ws:debug,db:trace,auth:info" or "*:debug" for all
const parseCategories = () => {
  const categories = {};
  const envCategories = process.env.LOG_CATEGORIES || "";

  if (!envCategories) {
    // Default settings for development vs production
    // CLI context defaults to ERROR level unless explicitly configured
    if (process.env.NODE_ENV === "production" || isCliContext()) {
      categories["*"] = LOG_LEVELS.ERROR;  // Only errors in production/CLI
    } else if (process.env.NODE_ENV === "test") {
      categories["*"] = LOG_LEVELS.ERROR;
    } else {
      // Development defaults
      categories["*"] = LOG_LEVELS[DEFAULT_LEVEL] ?? LOG_LEVELS.INFO;
    }
    return categories;
  }

  // Parse category:level pairs
  envCategories.split(",").forEach((pair) => {
    const [category, level] = pair.trim().split(":");
    if (category && level) {
      const levelValue = LOG_LEVELS[level.toUpperCase()];
      if (levelValue !== undefined) {
        categories[category] = levelValue;
      }
    }
  });

  // Set default for non-specified categories
  if (!categories["*"]) {
    categories["*"] = LOG_LEVELS[DEFAULT_LEVEL] ?? LOG_LEVELS.INFO;
  }

  return categories;
};

// Initialize categories
let logCategories = parseCategories();

// Colors for terminal output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

// Level colors
const levelColors = {
  ERROR: colors.red,
  WARN: colors.yellow,
  INFO: colors.blue,
  DEBUG: colors.cyan,
  TRACE: colors.gray,
};

// Category colors
const categoryColors = {
  ws: colors.green,
  db: colors.magenta,
  auth: colors.yellow,
  api: colors.cyan,
  server: colors.blue,
  notify: colors.magenta,
};

// Format timestamp
const timestamp = () => {
  const now = new Date();
  return now.toISOString().replace("T", " ").slice(0, -5);
};

// Check if logging is enabled for category and level
const shouldLog = (category, level) => {
  const categoryLevel = logCategories[category] ?? logCategories["*"] ?? LOG_LEVELS.INFO;
  return LOG_LEVELS[level] <= categoryLevel;
};

// Format log message with colors
const formatMessage = (category, level, message, ...args) => {
  const useColors = process.env.NO_COLOR !== "1" && process.env.NODE_ENV !== "test";

  if (useColors) {
    const catColor = categoryColors[category] || colors.white;
    const lvlColor = levelColors[level];

    return [
      `${colors.gray}${timestamp()}${colors.reset}`,
      `${lvlColor}[${level}]${colors.reset}`,
      `${catColor}[${category}]${colors.reset}`,
      message,
      ...args,
    ];
  } else {
    return [
      timestamp(),
      `[${level}]`,
      `[${category}]`,
      message,
      ...args,
    ];
  }
};

// Create logger for a specific category
export const createLogger = (category) => {
  return {
    error: (message, ...args) => {
      if (shouldLog(category, "ERROR")) {
        console.error(...formatMessage(category, "ERROR", message, ...args));
      }
    },
    warn: (message, ...args) => {
      if (shouldLog(category, "WARN")) {
        console.warn(...formatMessage(category, "WARN", message, ...args));
      }
    },
    info: (message, ...args) => {
      if (shouldLog(category, "INFO")) {
        console.log(...formatMessage(category, "INFO", message, ...args));
      }
    },
    debug: (message, ...args) => {
      if (shouldLog(category, "DEBUG")) {
        console.log(...formatMessage(category, "DEBUG", message, ...args));
      }
    },
    trace: (message, ...args) => {
      if (shouldLog(category, "TRACE")) {
        console.log(...formatMessage(category, "TRACE", message, ...args));
      }
    },
    // Special method for request/response logging
    request: (method, params) => {
      if (shouldLog(category, "DEBUG")) {
        console.log(...formatMessage(
          category,
          "DEBUG",
          `→ ${method}`,
          params ? JSON.stringify(params) : "no params"
        ));
      }
    },
    response: (method, result, duration) => {
      if (shouldLog(category, "DEBUG")) {
        const resultStr = result === undefined
          ? "void"
          : typeof result === "object"
            ? `${JSON.stringify(result).slice(0, 100)}...`
            : result;
        console.log(...formatMessage(
          category,
          "DEBUG",
          `← ${method} (${duration}ms)`,
          resultStr
        ));
      }
    },
  };
};

// Pre-configured loggers for common categories
export const wsLogger = createLogger("ws");
export const dbLogger = createLogger("db");
export const authLogger = createLogger("auth");
export const serverLogger = createLogger("server");
export const notifyLogger = createLogger("notify");

// Reload configuration (useful for runtime changes)
export const reloadConfig = () => {
  logCategories = parseCategories();
};

// Get current configuration
export const getConfig = () => {
  return {
    categories: logCategories,
    levels: LOG_LEVELS,
  };
};

// Middleware for timing operations
export const timed = async (category, operation, fn) => {
  const logger = createLogger(category);
  const start = Date.now();

  try {
    logger.trace(`Starting ${operation}`);
    const result = await fn();
    const duration = Date.now() - start;
    logger.debug(`Completed ${operation} in ${duration}ms`);
    return result;
  } catch (error) {
    const duration = Date.now() - start;
    logger.error(`Failed ${operation} after ${duration}ms:`, error.message);
    throw error;
  }
};

// Log configuration on startup (only in development and when explicitly debugging)
// Suppress banner if LOG_CATEGORIES is not set (user doesn't care about logging config)
if (process.env.NODE_ENV !== "production" &&
    process.env.NODE_ENV !== "test" &&
    process.env.LOG_CATEGORIES) {
  const config = getConfig();
  console.log(colors.bright + "=== Logger Configuration ===" + colors.reset);
  console.log("Categories:", config.categories);
  console.log("Available levels:", Object.keys(config.levels).join(", "));
  console.log("");
  console.log("Set LOG_CATEGORIES env var to configure:");
  console.log('  Example: LOG_CATEGORIES="ws:debug,db:trace,auth:info"');
  console.log('  Or use "*:debug" to set all categories to debug');
  console.log(colors.bright + "===========================" + colors.reset + "\n");
}

export default {
  createLogger,
  wsLogger,
  dbLogger,
  authLogger,
  serverLogger,
  notifyLogger,
  reloadConfig,
  getConfig,
  timed,
};
