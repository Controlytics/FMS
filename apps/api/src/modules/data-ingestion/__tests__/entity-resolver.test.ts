import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockFindUnique, mockAssetFindUnique, mockUnsFindUnique } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockAssetFindUnique: vi.fn(),
  mockUnsFindUnique: vi.fn(),
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    deviceCredential: {
      findUnique: mockFindUnique,
    },
    assetInstance: {
      findUnique: mockAssetFindUnique,
    },
    unsMapping: {
      findUnique: mockUnsFindUnique,
    },
  },
}));

import {
  resolveEntityByToken,
  invalidateEntityCache,
  clearEntityCache,
} from '../entity-resolver.js';

// ── Fixtures ────────────────────────────────────────────────────────────

const VALID_TOKEN = 'tok_valid_abc123';

const mockCredential = {
  id: 'cred-001',
  accessToken: VALID_TOKEN,
  entityId: 'entity-001',
  status: 'ACTIVE',
  isActive: true,
};

const mockTemplate = {
  id: 'tmpl-001',
  name: 'Temperature Sensor',
};

const mockEntity = {
  id: 'entity-001',
  name: 'Sensor-A',
  isActive: true,
  unsPath: 'digilog/v1/enterprise/sensor-a',
  template: mockTemplate,
};

const mockUnsMapping = {
  entityId: 'entity-001',
  unsPath: 'digilog/v1/custom/sensor-a',
};

// ── Helpers ─────────────────────────────────────────────────────────────

function setupValidChain() {
  mockFindUnique.mockResolvedValue(mockCredential);
  mockAssetFindUnique.mockResolvedValue(mockEntity);
  mockUnsFindUnique.mockResolvedValue(mockUnsMapping);
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('entity-resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearEntityCache();
  });

  // 1. Valid token resolves to entity info
  it('should resolve a valid token to entity info', async () => {
    setupValidChain();

    const result = await resolveEntityByToken(VALID_TOKEN);

    expect(result).not.toBeNull();
    expect(result!.entityId).toBe('entity-001');
    expect(result!.entityName).toBe('Sensor-A');
    expect(result!.templateId).toBe('tmpl-001');
    expect(result!.templateName).toBe('Temperature Sensor');
    expect(result!.unsPath).toBe('digilog/v1/custom/sensor-a');
    expect(result!.isActive).toBe(true);
  });

  // 2. Invalid token returns null
  it('should return null for an unknown token', async () => {
    mockFindUnique.mockResolvedValue(null);

    const result = await resolveEntityByToken('tok_invalid');

    expect(result).toBeNull();
  });

  // 3. Inactive credential returns null
  it('should return null when credential is inactive', async () => {
    mockFindUnique.mockResolvedValue({
      ...mockCredential,
      isActive: false,
    });

    const result = await resolveEntityByToken(VALID_TOKEN);

    expect(result).toBeNull();
    // Should not attempt to look up the entity
    expect(mockAssetFindUnique).not.toHaveBeenCalled();
  });

  // 4. Active entity with template resolves correctly
  it('should resolve an active entity with its template details', async () => {
    setupValidChain();

    const result = await resolveEntityByToken(VALID_TOKEN);

    expect(result).not.toBeNull();
    expect(result!.credentialId).toBe('cred-001');
    expect(result!.templateId).toBe('tmpl-001');
    expect(result!.templateName).toBe('Temperature Sensor');
  });

  // 5. Cache returns same result on second call (DB called once)
  it('should return cached result on second call without querying DB again', async () => {
    setupValidChain();

    const first = await resolveEntityByToken(VALID_TOKEN);
    const second = await resolveEntityByToken(VALID_TOKEN);

    expect(first).toEqual(second);
    // DB should only be called once since second call uses cache
    expect(mockFindUnique).toHaveBeenCalledTimes(1);
    expect(mockAssetFindUnique).toHaveBeenCalledTimes(1);
  });

  // 6. invalidateEntityCache clears cache for specific token
  it('should re-query DB after invalidateEntityCache is called for a token', async () => {
    setupValidChain();

    await resolveEntityByToken(VALID_TOKEN);
    expect(mockFindUnique).toHaveBeenCalledTimes(1);

    // Invalidate just this token
    invalidateEntityCache(VALID_TOKEN);

    await resolveEntityByToken(VALID_TOKEN);
    // Now DB should have been called a second time
    expect(mockFindUnique).toHaveBeenCalledTimes(2);
  });

  // 7. clearEntityCache clears all cache
  it('should re-query DB after clearEntityCache is called', async () => {
    setupValidChain();

    await resolveEntityByToken(VALID_TOKEN);
    expect(mockFindUnique).toHaveBeenCalledTimes(1);

    clearEntityCache();

    await resolveEntityByToken(VALID_TOKEN);
    expect(mockFindUnique).toHaveBeenCalledTimes(2);
  });

  // 8. Missing template returns null
  it('should return null when entity has no template', async () => {
    mockFindUnique.mockResolvedValue(mockCredential);
    mockAssetFindUnique.mockResolvedValue({
      ...mockEntity,
      template: null,
    });

    const result = await resolveEntityByToken(VALID_TOKEN);

    expect(result).toBeNull();
  });

  // 9. Returns correct credentialId, entityId, entityName, templateId
  it('should map all fields correctly from credential, entity, and template', async () => {
    setupValidChain();

    const result = await resolveEntityByToken(VALID_TOKEN);

    expect(result).toEqual({
      credentialId: 'cred-001',
      entityId: 'entity-001',
      entityName: 'Sensor-A',
      templateId: 'tmpl-001',
      templateName: 'Temperature Sensor',
      unsPath: 'digilog/v1/custom/sensor-a',
      isActive: true,
    });
  });

  // 10. Credential with non-ACTIVE status returns null
  it('should return null when credential status is not ACTIVE', async () => {
    mockFindUnique.mockResolvedValue({
      ...mockCredential,
      status: 'REVOKED',
    });

    const result = await resolveEntityByToken(VALID_TOKEN);

    expect(result).toBeNull();
    expect(mockAssetFindUnique).not.toHaveBeenCalled();
  });

  // 11. Inactive entity returns null
  it('should return null when entity is inactive', async () => {
    mockFindUnique.mockResolvedValue(mockCredential);
    mockAssetFindUnique.mockResolvedValue({
      ...mockEntity,
      isActive: false,
    });

    const result = await resolveEntityByToken(VALID_TOKEN);

    expect(result).toBeNull();
  });

  // 12. Falls back to entity.unsPath when no UNS mapping exists
  it('should use entity.unsPath when unsMapping is not found', async () => {
    mockFindUnique.mockResolvedValue(mockCredential);
    mockAssetFindUnique.mockResolvedValue(mockEntity);
    mockUnsFindUnique.mockResolvedValue(null);

    const result = await resolveEntityByToken(VALID_TOKEN);

    expect(result).not.toBeNull();
    expect(result!.unsPath).toBe('digilog/v1/enterprise/sensor-a');
  });
});
