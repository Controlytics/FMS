import { useCallback } from 'react';
import { useSWRConfig } from 'swr';
import { apiClient } from '@/lib/api-client';
import { useReauth } from '@/hooks/use-reauth';
import { useToast } from '@/hooks/use-toast';

interface MutationCallbacks {
  setSaving: (v: boolean) => void;
  setError: (v: string) => void;
  onCreateSuccess: () => void;
  onUpdateSuccess: () => void;
  onDeleteSuccess: () => void;
  onRelationshipCreated: (result: any) => void;
  onRelationshipDeleted: () => void;
  onIdentifierCreated: () => void;
  onIdentifierDeleted: () => void;
  onUnlinked: () => void;
  onRemovedFromDiagram: () => void;
  onAttachSuccess: () => void;
}

export function useAssetMutations(callbacks: MutationCallbacks) {
  const { mutate } = useSWRConfig();
  const reauth = useReauth();
  const { toast } = useToast();

  const mutateAssets = useCallback(() => {
    mutate((key: unknown) => typeof key === 'string' && key.startsWith('/api/assets'));
  }, [mutate]);

  // ---- Create Entity ----
  const handleCreateAsset = useCallback(async (
    selectedTemplateId: string | null,
    newAsset: { name: string; description: string; status: string; parentId: string | null; attributes: Record<string, any> },
  ) => {
    if (!selectedTemplateId || !newAsset.name.trim()) return;
    callbacks.setSaving(true);
    callbacks.setError('');

    const body = {
      name: newAsset.name.trim(),
      description: newAsset.description.trim() || undefined,
      templateId: selectedTemplateId,
      status: newAsset.status,
      attributes: newAsset.attributes,
      parentId: newAsset.parentId || undefined,
    };

    try {
      await reauth.execute(
        'CREATE_ASSET',
        async (password?: string) => {
          if (password) {
            await apiClient.postWithReauth('/api/assets/instances', body, password);
          } else {
            await apiClient.post('/api/assets/instances', body);
          }
        },
        {
          onSuccess: () => {
            mutateAssets();
            callbacks.onCreateSuccess();
            callbacks.setSaving(false);
          },
          onError: (err: unknown) => {
            const e = err as any;
            callbacks.setError(e?.message || 'Failed to create entity');
            callbacks.setSaving(false);
          },
        },
      );
    } catch (e: unknown) {
      const err = e as any;
      callbacks.setError(err?.message || 'Unexpected error creating entity');
      callbacks.setSaving(false);
    }
  }, [reauth, mutateAssets, callbacks]);

  // ---- Update Entity ----
  const handleUpdateAsset = useCallback(async (
    selectedAssetId: string | null,
    editAsset: { name: string; description: string; status: string; parentId: string | null; attributes: Record<string, any> },
  ) => {
    if (!selectedAssetId || !editAsset.name.trim()) return;
    callbacks.setSaving(true);
    callbacks.setError('');

    const body = {
      name: editAsset.name.trim(),
      description: editAsset.description.trim() || undefined,
      status: editAsset.status,
      attributes: editAsset.attributes,
      parentId: editAsset.parentId,
    };

    try {
      await reauth.execute(
        'UPDATE_ASSET',
        async (password?: string) => {
          if (password) {
            await apiClient.putWithReauth(`/api/assets/instances/${selectedAssetId}`, body, password);
          } else {
            await apiClient.put(`/api/assets/instances/${selectedAssetId}`, body);
          }
        },
        {
          onSuccess: () => {
            mutateAssets();
            callbacks.onUpdateSuccess();
            callbacks.setSaving(false);
          },
          onError: (err: unknown) => {
            const e = err as any;
            callbacks.setError(e?.message || 'Failed to update entity');
            callbacks.setSaving(false);
          },
        },
      );
    } catch (e: unknown) {
      const err = e as any;
      callbacks.setError(err?.message || 'Unexpected error updating entity');
      callbacks.setSaving(false);
    }
  }, [reauth, mutateAssets, callbacks]);

  // ---- Delete Entity ----
  const handleDeleteAsset = useCallback(async (selectedAssetId: string | null) => {
    if (!selectedAssetId) return;
    callbacks.setSaving(true);
    callbacks.setError('');

    try {
      await reauth.execute(
        'DELETE_ASSET',
        async (password?: string) => {
          if (password) {
            await apiClient.deleteWithReauth(`/api/assets/instances/${selectedAssetId}`, password);
          } else {
            await apiClient.delete(`/api/assets/instances/${selectedAssetId}`);
          }
        },
        {
          onSuccess: () => {
            mutateAssets();
            callbacks.onDeleteSuccess();
            callbacks.setSaving(false);
          },
          onError: (err: unknown) => {
            const e = err as any;
            callbacks.setError(e?.message || 'Failed to delete entity');
            callbacks.setSaving(false);
          },
        },
      );
    } catch (e: unknown) {
      const err = e as any;
      callbacks.setError(err?.message || 'Unexpected error deleting entity');
      callbacks.setSaving(false);
    }
  }, [reauth, mutateAssets, callbacks]);

  // ---- Create Relationship ----
  const handleCreateRelationship = useCallback(async (
    linkSource: string,
    linkTargets: string[],
    linkType: string,
    linkCustomLabel: string,
    linkNotes: string,
  ) => {
    if (!linkSource || linkTargets.length === 0 || !linkType) return;
    callbacks.setSaving(true);
    callbacks.setError('');

    let lastResult: any = null;
    try {
      await reauth.execute(
        'CREATE_ASSET_RELATIONSHIP',
        async (password?: string) => {
          for (const targetId of linkTargets) {
            const body = {
              sourceAssetId: linkSource,
              targetAssetId: targetId,
              relationshipType: linkType,
              customLabel: linkType === 'CUSTOM' ? linkCustomLabel : undefined,
              notes: linkNotes || undefined,
            };
            if (password) {
              lastResult = await apiClient.postWithReauth('/api/assets/relationships', body, password);
            } else {
              lastResult = await apiClient.post('/api/assets/relationships', body);
            }
          }
        },
        {
          onSuccess: () => {
            mutateAssets();
            callbacks.onRelationshipCreated(lastResult);
            callbacks.setSaving(false);
            const ci = lastResult?.connectionInfo?.source;
            if (ci) {
              const remaining = ci.allowed > 0 ? ci.remaining : 'unlimited';
              toast.success('Relationship Created', `${ci.used}/${ci.allowed > 0 ? ci.allowed : '\u221E'} connections used, ${remaining} remaining`);
            } else {
              toast.success('Relationship Created');
            }
          },
          onError: (err: unknown) => {
            const e = err as any;
            const msg = e?.message || 'Failed to create relationship';
            callbacks.setError(msg);
            callbacks.setSaving(false);
            if (e?.connectionInfo) {
              toast.error('Connection Limit Reached', msg);
            } else {
              toast.error('Failed to Create Relationship', msg);
            }
          },
        },
      );
    } catch (e: unknown) {
      const err = e as any;
      const msg = err?.message || 'Unexpected error creating relationship';
      callbacks.setError(msg);
      callbacks.setSaving(false);
      toast.error('Failed to Create Relationship', msg);
    }
  }, [reauth, mutateAssets, toast, callbacks]);

  // ---- Delete Relationship ----
  const handleDeleteRelationship = useCallback(
    async (relationshipId: string) => {
      await reauth.execute(
        'DELETE_ASSET_RELATIONSHIP',
        async (password?: string) => {
          if (password) {
            await apiClient.deleteWithReauth(`/api/assets/relationships/${relationshipId}`, password);
          } else {
            await apiClient.delete(`/api/assets/relationships/${relationshipId}`);
          }
        },
        {
          onSuccess: () => {
            mutateAssets();
            toast.success('Relationship Removed');
          },
          onError: (err: any) => {
            const msg = err?.message || 'Failed to delete relationship';
            callbacks.setError(msg);
            toast.error('Failed to Remove', msg);
          },
        },
      );
    },
    [reauth, mutateAssets, toast, callbacks],
  );

  // ---- Create Identifier ----
  const handleCreateIdentifier = useCallback(async (
    selectedAssetId: string | null,
    newIdentifier: { identifierType: string; identifierValue: string; label: string; isPrimary: boolean },
  ) => {
    if (!selectedAssetId || !newIdentifier.identifierValue.trim()) return;
    callbacks.setSaving(true);
    callbacks.setError('');

    const body = {
      assetId: selectedAssetId,
      identifierType: newIdentifier.identifierType,
      identifierValue: newIdentifier.identifierValue.trim(),
      label: newIdentifier.label.trim() || undefined,
      isPrimary: newIdentifier.isPrimary,
    };

    await reauth.execute(
      'CREATE_ASSET_IDENTIFIER',
      async (password?: string) => {
        if (password) {
          await apiClient.postWithReauth('/api/assets/identifiers', body, password);
        } else {
          await apiClient.post('/api/assets/identifiers', body);
        }
      },
      {
        onSuccess: () => {
          mutateAssets();
          callbacks.onIdentifierCreated();
          callbacks.setSaving(false);
        },
        onError: (err: any) => {
          callbacks.setError(err?.message || 'Failed to create identifier');
          callbacks.setSaving(false);
        },
      },
    );
  }, [mutateAssets, reauth, callbacks]);

  // ---- Delete Identifier ----
  const handleDeleteIdentifier = useCallback(
    async (identifierId: string) => {
      await reauth.execute(
        'DELETE_ASSET_IDENTIFIER',
        async (password?: string) => {
          if (password) {
            await apiClient.deleteWithReauth(`/api/assets/identifiers/${identifierId}`, password);
          } else {
            await apiClient.delete(`/api/assets/identifiers/${identifierId}`);
          }
        },
        {
          onSuccess: () => {
            mutateAssets();
          },
          onError: (err: any) => {
            callbacks.setError(err?.message || 'Failed to delete identifier');
          },
        },
      );
    },
    [mutateAssets, reauth, callbacks],
  );

  // ---- Unlink from Parent ----
  const handleUnlinkFromParent = useCallback(async (assetId: string) => {
    if (!confirm('Remove this entity from its parent? The entity will become a root-level entity.')) return;
    try {
      await reauth.execute(
        'UPDATE_ASSET',
        async (password?: string) => {
          if (password) {
            await apiClient.putWithReauth(`/api/assets/instances/${assetId}`, { parentId: null }, password);
          } else {
            await apiClient.put(`/api/assets/instances/${assetId}`, { parentId: null });
          }
        },
        {
          onSuccess: () => mutateAssets(),
          onError: (err: any) => callbacks.setError(err?.message || 'Failed to unlink entity'),
        },
      );
    } catch (err: any) {
      callbacks.setError(err?.message || 'Unexpected error unlinking entity');
    }
  }, [reauth, mutateAssets, callbacks]);

  // ---- Remove node from diagram ----
  const handleRemoveFromDiagram = useCallback(async (
    childId: string,
    parentId: string,
    allRels: any[],
  ) => {
    const rel = allRels.find(
      (r: any) => r.sourceAssetId === parentId && r.targetAssetId === childId,
    );
    if (!rel) {
      callbacks.setError('Could not find the relationship to remove.');
      return;
    }
    const relType = rel.relationshipType;
    if (!confirm(`Remove this ${relType} relationship? This will delete the relationship but not the entity itself.`)) return;
    try {
      await reauth.execute(
        'DELETE_ASSET_RELATIONSHIP',
        async (password?: string) => {
          if (password) {
            await apiClient.deleteWithReauth(`/api/assets/relationships/${rel.id}`, password);
          } else {
            await apiClient.delete(`/api/assets/relationships/${rel.id}`);
          }
        },
        {
          onSuccess: () => {
            mutateAssets();
            toast.success('Relationship Removed');
          },
          onError: (err: any) => {
            const msg = err?.message || 'Failed to remove from tree';
            callbacks.setError(msg);
            toast.error('Failed to Remove', msg);
          },
        },
      );
    } catch (err: any) {
      const msg = err?.message || 'Unexpected error removing from tree';
      callbacks.setError(msg);
      toast.error('Failed to Remove', msg);
    }
  }, [reauth, mutateAssets, toast, callbacks]);

  // ---- Attach existing entity ----
  const handleAttachExisting = useCallback(async (
    attachParentId: string,
    attachTargetId: string,
  ) => {
    if (!attachParentId || !attachTargetId) return;
    callbacks.setSaving(true);
    callbacks.setError('');
    const body = {
      sourceAssetId: attachParentId,
      targetAssetId: attachTargetId,
      relationshipType: 'CONTAINS',
    };
    try {
      await reauth.execute(
        'CREATE_ASSET_RELATIONSHIP',
        async (password?: string) => {
          if (password) {
            return await apiClient.postWithReauth('/api/assets/relationships', body, password);
          } else {
            return await apiClient.post('/api/assets/relationships', body);
          }
        },
        {
          onSuccess: () => {
            mutateAssets();
            callbacks.onAttachSuccess();
            callbacks.setSaving(false);
            toast.success('Entity Attached', 'CONTAINS relationship created');
          },
          onError: (err: any) => {
            const msg = err?.message || 'Failed to attach entity';
            callbacks.setError(msg);
            callbacks.setSaving(false);
            toast.error('Failed to Attach', msg);
          },
        },
      );
    } catch (err: any) {
      const msg = err?.message || 'Unexpected error attaching entity';
      callbacks.setError(msg);
      callbacks.setSaving(false);
      toast.error('Failed to Attach', msg);
    }
  }, [reauth, mutateAssets, toast, callbacks]);

  return {
    reauth,
    mutateAssets,
    handleCreateAsset,
    handleUpdateAsset,
    handleDeleteAsset,
    handleCreateRelationship,
    handleDeleteRelationship,
    handleCreateIdentifier,
    handleDeleteIdentifier,
    handleUnlinkFromParent,
    handleRemoveFromDiagram,
    handleAttachExisting,
  };
}
