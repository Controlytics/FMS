import { z } from 'zod';

export const identifierTypeEnum = z.enum(['QR', 'BARCODE', 'RFID', 'NFC', 'MANUAL']);

export const createIdentifierSchema = z.object({
  assetId: z.string().uuid(),
  type: identifierTypeEnum,
  value: z.string().min(1).max(500),
});

export type IdentifierType = z.infer<typeof identifierTypeEnum>;
export type CreateIdentifierInput = z.infer<typeof createIdentifierSchema>;
