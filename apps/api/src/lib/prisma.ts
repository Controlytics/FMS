import { PrismaClient } from '@prisma/client';
import process from 'node:process';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});
