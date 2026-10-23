import { describe, it, expect } from 'vitest';
import { actionReauthConfigSchema } from './action-reauth.js';

// PUT /api/config/action-reauth validates the body with this schema:
// action name -> the roles that must re-enter their password for it.
describe('actionReauthConfigSchema', () => {
  it('a missing body is an empty policy', () => {
    expect(actionReauthConfigSchema.parse(undefined)).toEqual({});
  });

  it('keeps each action with its role list', () => {
    const policy = { DELETE_USER: ['ADMIN', 'SUPERVISOR'], RESTORE_BACKUP: ['ADMIN'], EXPORT_AUDIT: [] };
    expect(actionReauthConfigSchema.parse(policy)).toEqual(policy);
  });

  it('refuses an action whose roles are not a list of role names', () => {
    expect(actionReauthConfigSchema.safeParse({ DELETE_USER: 'ADMIN' }).success).toBe(false);
    expect(actionReauthConfigSchema.safeParse({ DELETE_USER: [1] }).success).toBe(false);
    expect(actionReauthConfigSchema.safeParse({ DELETE_USER: null }).success).toBe(false);
  });
});
