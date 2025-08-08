const { createLogger, format, transports } = require('winston');
const path = require('path');
const { combine, timestamp, printf, colorize, align } = format;
const logFormat = printf(({ level, message, timestamp, stack }) => {
    return `${timestamp} [${level}]: ${stack || message}`;
});
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
        new transports.File({ 
            filename: path.join('logs', 'error.log'), 
            level: 'error',
            maxsize: 5 * 1024 * 1024, 
            maxFiles: 5
        }),
        new transports.File({ 
            filename: path.join('logs', 'combined.log'),
            maxsize: 10 * 1024 * 1024, 
            maxFiles: 5
        })
    ],
    exitOnError: false 
});
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
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
});
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
module.exports = logger;