const { createLogger, format, transports } = require('winston');
const path = require('path');
const { combine, timestamp, printf, colorize, align } = format;

// Define log format
const logFormat = printf(({ level, message, timestamp, stack }) => {
    return `${timestamp} [${level}]: ${stack || message}`;
});

// Create logger instance
const logger = createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug', 
    format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        format.errors({ stack: true }),
        colorize({ all: true }),
        align(),
        logFormat
    ),
    transports: [
        // Write all logs with level `error` and below to `error.log`
        new transports.File({ 
            filename: path.join('logs', 'error.log'), 
            level: 'error',
            maxsize: 5 * 1024 * 1024, // 5MB
            maxFiles: 5
        }),
        // Write all logs to `combined.log`
        new transports.File({ 
            filename: path.join('logs', 'combined.log'),
            maxsize: 10 * 1024 * 1024, // 10MB
            maxFiles: 5
        })
    ],
    exitOnError: false // Don't exit on handled exceptions
});

// If we're not in production, log to the console as well
if (process.env.NODE_ENV !== 'production') {
    logger.add(new transports.Console({
        format: combine(
            timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            format.errors({ stack: true }),
            colorize({ all: true }),
            align(),
            logFormat
        )
    }));
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    // Don't exit here, let the process continue
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit here, let the process continue
});

module.exports = logger;
