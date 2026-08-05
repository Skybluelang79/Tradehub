import winston from 'winston';
import { join } from 'path';
import { __dirname } from './paths.js';

const USE_CONSOLE_ONLY = process.env.NETLIFY === 'true' || process.env.DB_BLOB === 'true' || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

const transports = [];

if (!USE_CONSOLE_ONLY) {
  try {
    transports.push(
      new winston.transports.File({
        filename: join(__dirname, '..', 'logs', 'error.log'),
        level: 'error',
        maxsize: 5 * 1024 * 1024,
        maxFiles: 5,
      }),
      new winston.transports.File({
        filename: join(__dirname, '..', 'logs', 'combined.log'),
        maxsize: 5 * 1024 * 1024,
        maxFiles: 5,
      })
    );
  } catch {}
}

if (USE_CONSOLE_ONLY || process.env.NODE_ENV !== 'production') {
  transports.push(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    ),
  }));
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports,
});

export default logger;
