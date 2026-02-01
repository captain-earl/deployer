import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.LOG_PRETTY === 'true' ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
  base: { service: 'deployer' },
});
