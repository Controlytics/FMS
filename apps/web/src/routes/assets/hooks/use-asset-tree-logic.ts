import { useState, useMemo, useCallback } from 'react';
import type { TreeNode } from '../types';

export function useAssetTreeLogic(treeData: TreeNode[] | undefined) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  const filteredTreeFn = useCallback(
    (debouncedTreeSearch: string, treeTemplateFilter: string) => {
      if (!treeData) return [];
      let nodes = treeData;
      if (debouncedTreeSearch) {
        const search = debouncedTreeSearch.toLowerCase();
        nodes = nodes.filter((n) => n.name.toLowerCase().includes(search));
      }
      if (treeTemplateFilter) {
        nodes = nodes.filter((n) => n.templateId === treeTemplateFilter);
      }
      return nodes;
    },
    [treeData],
  );

  // Build parent-to-children map from full (unfiltered) tree data
  const childrenMap = useMemo(() => {
    const map = new Map<string | null, TreeNode[]>();
    if (!treeData) return map;
    for (const node of treeData) {
      const parentKey = node.parentId;
      if (!map.has(parentKey)) map.set(parentKey, []);
      map.get(parentKey)!.push(node);
    }
    return map;
  }, [treeData]);

  const getChildren = useCallback(
    (parentId: string): TreeNode[] => {
      return childrenMap.get(parentId) ?? [];
    },
    [childrenMap],
  );

  const toggleExpand = useCallback((nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    if (!treeData) return;
    const allIds = new Set(treeData.filter((n) => n._count.children > 0).map((n) => n.id));
    setExpandedNodes(allIds);
  }, [treeData]);

  const collapseAll = useCallback(() => {
    setExpandedNodes(new Set());
  }, []);

  // Build parent path for detail view
  const getParentPath = useCallback(
    (assetId: string): string[] => {
      if (!treeData) return [];
      const nodeMap = new Map(treeData.map((n) => [n.id, n]));
      const path: string[] = [];
      let current = nodeMap.get(assetId);
      while (current?.parentId) {
        const parent = nodeMap.get(current.parentId);
        if (parent) {
          path.unshift(parent.name);
          current = parent;
        } else {
          break;
        }
      }
      return path;
    },
    [treeData],
  );

  // Flat list of all entities for dropdowns (with indent info)
  const flatAssetList = useMemo(() => {
    if (!treeData) return [];
    const result: { id: string; name: string; depth: number; templateName: string; childCount: number }[] = [];

    function isRoot(pid: string | null | undefined): boolean {
      return pid === null || pid === undefined || pid === '';
    }
    function walk(parentId: string | null, depth: number) {
      const children = (treeData ?? []).filter((n) => parentId === null ? isRoot(n.parentId) : n.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name));
      for (const child of children) {
        result.push({ id: child.id, name: child.name, depth, templateName: child.template.name, childCount: child._count?.children ?? 0 });
        walk(child.id, depth + 1);
      }
    }
    walk(null, 0);
    return result;
  }, [treeData]);

  return {
    expandedNodes,
    setExpandedNodes,
    childrenMap,
    getChildren,
    toggleExpand,
    expandAll,
    collapseAll,
    getParentPath,
    flatAssetList,
    filteredTreeFn,
  };
}
