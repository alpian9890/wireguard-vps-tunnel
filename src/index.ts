#!/usr/bin/env node
import { runCli } from './cli/program';
import { AppError } from './core/errors';
import { logger } from './core/logger';

void runCli().catch((error: unknown) => {
  if (error instanceof AppError) {
    logger.error(error.message);
    process.exit(error.exitCode);
  }

  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  logger.error(message);
  process.exit(1);
});

