import { z } from 'zod';

const authAgentSchema = z.object({
  method: z.literal('agent'),
});

const authKeySchema = z.object({
  method: z.literal('key'),
  privateKeyPath: z.string().min(1),
  passphraseEnv: z.string().min(1).optional(),
});

const authPasswordSchema = z.object({
  method: z.literal('password'),
  passwordEnv: z.string().min(1),
});

export const serverRoleSchema = z.enum(['host', 'client']);

export const serverSchema = z.object({
  name: z.string().min(1),
  role: serverRoleSchema,
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(22),
  user: z.string().min(1).default('root'),
  wgInterface: z.string().min(1).default('wg0'),
  auth: z.discriminatedUnion('method', [authAgentSchema, authKeySchema, authPasswordSchema]),
  tags: z.array(z.string()).default([]),
});

export const inventorySchema = z.object({
  version: z.literal(1),
  servers: z.array(serverSchema).default([]),
});

export type ServerRole = z.infer<typeof serverRoleSchema>;
export type Server = z.infer<typeof serverSchema>;
export type Inventory = z.infer<typeof inventorySchema>;

