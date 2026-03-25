import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { apiClient } from '../../lib/api-client';


const NODE_COLORS: Record<string, string> = {
  START: 'bg-green-700 border-green-500', END: 'bg-red-700 border-red-500',
  STAGE: 'bg-blue-700 border-blue-500', CHECKLIST: 'bg-purple-700 border-purple-500',
  REMARKS: 'bg-gray-600 border-gray-400', DURATION_INTERLOCK: 'bg-amber-700 border-amber-500',
  PARAM_CAPTURE: 'bg-indigo-700 border-indigo-500', CUSTOM_SCRIPT: 'bg-pink-700 border-pink-500',
  APPROVAL: 'bg-emerald-700 border-emerald-500', EQUIPMENT_LINK: 'bg-teal-700 border-teal-500',
};

interface PipelineNode {
  id?: string; stateKey: string | null; nodeType: string; configuration: any;
  positionX: number; positionY: number; sortOrder: number;
}

interface Connection {
  id?: string; fromIndex: number; toIndex: number; label: string;
}

export function CleaningProfileEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === 'new';
  const { data: profile } = useSWR(!isNew && id ? `/api/filter-cleaning-profiles/${id}` : null);
  const { data: lifecycleConfig } = useSWR('/api/config/dynamic/filter_lifecycle_states');

  const [name, setName] = useState('');
  const [flowMode, setFlowMode] = useState<'STRICT' | 'BYPASS_ENABLED'>('STRICT');
  const [alarmFlags, setAlarmFlags] = useState({ forwardSkip: true, backwardJump: true, outOfSequence: true });
  const [nodes, setNodes] = useState<PipelineNode[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedNode, setSelectedNode] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [connectingFrom, setConnectingFrom] = useState<number | null>(null);

  const lifecycleStates: any[] = lifecycleConfig?.value ?? [];

  useEffect(() => {
    if (profile) {
      setName(profile.name);
      setFlowMode(profile.flowMode);
      setAlarmFlags({
        forwardSkip: profile.alarmOnForwardSkip,
        backwardJump: profile.alarmOnBackwardJump,
        outOfSequence: profile.alarmOnOutOfSequence,
      });
      setNodes(profile.stages?.map((s: any) => ({
        id: s.id, stateKey: s.stateKey, nodeType: s.nodeType,
        configuration: s.configuration, positionX: s.positionX,
        positionY: s.positionY, sortOrder: s.sortOrder,
      })) ?? []);
      setConnections(profile.connections?.map((c: any, i: number) => ({
        id: c.id, fromIndex: profile.stages.findIndex((s: any) => s.id === c.fromStageId),
        toIndex: profile.stages.findIndex((s: any) => s.id === c.toStageId), label: c.label ?? 'Next',
      })) ?? []);
    } else if (isNew) {
      setNodes([
        { stateKey: null, nodeType: 'START', configuration: {}, positionX: 50, positionY: 200, sortOrder: 0 },
        { stateKey: null, nodeType: 'END', configuration: {}, positionX: 700, positionY: 200, sortOrder: 99 },
      ]);
    }
  }, [profile, isNew]);

  const addNode = (type: string, stateKey?: string) => {
    const newNode: PipelineNode = {
      stateKey: stateKey ?? null, nodeType: type, configuration: {},
      positionX: 100 + nodes.length * 120, positionY: 200, sortOrder: nodes.length,
    };
    setNodes([...nodes, newNode]);
  };

  const removeNode = (idx: number) => {
    if (nodes[idx].nodeType === 'START' || nodes[idx].nodeType === 'END') return;
    setNodes(nodes.filter((_, i) => i !== idx));
    setConnections(connections.filter(c => c.fromIndex !== idx && c.toIndex !== idx)
      .map(c => ({
        ...c,
        fromIndex: c.fromIndex > idx ? c.fromIndex - 1 : c.fromIndex,
        toIndex: c.toIndex > idx ? c.toIndex - 1 : c.toIndex,
      })));
    setSelectedNode(null);
  };

  const handleNodeClick = (idx: number) => {
    if (connectingFrom !== null) {
      if (connectingFrom !== idx) {
        setConnections([...connections, { fromIndex: connectingFrom, toIndex: idx, label: 'Next' }]);
      }
      setConnectingFrom(null);
    } else {
      setSelectedNode(idx);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        name, flowMode,
        alarmOnForwardSkip: alarmFlags.forwardSkip,
        alarmOnBackwardJump: alarmFlags.backwardJump,
        alarmOnOutOfSequence: alarmFlags.outOfSequence,
        stages: nodes.map((n, i) => ({ ...n, sortOrder: i })),
        connections: connections.map(c => ({ fromIndex: c.fromIndex, toIndex: c.toIndex, label: c.label })),
      };
      if (isNew) {
        const result = await apiClient.post('/api/filter-cleaning-profiles', body);
        navigate(`/filter-cleaning-profiles/${(result as any).id}/edit`, { replace: true });
      } else {
        await apiClient.put(`/api/filter-cleaning-profiles/${id}`, body);
        mutate(`/api/filter-cleaning-profiles/${id}`);
      }
    } catch (e: any) { alert(e.message); }
    setSaving(false);
  };

  return (
    <div className="h-screen flex flex-col">
      {/* Toolbar */}
      <div className="bg-gray-800 border-b border-gray-700 p-3 flex items-center gap-4">
        <button onClick={() => navigate('/filter-cleaning-profiles')} className="text-gray-400 hover:text-gray-200">← Back</button>
        <input className="bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-gray-100 font-semibold w-64" value={name}
          onChange={e => setName(e.target.value)} placeholder="Profile Name" />
        <select className="bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-gray-100 text-sm" value={flowMode}
          onChange={e => setFlowMode(e.target.value as any)}>
          <option value="STRICT">Strict</option>
          <option value="BYPASS_ENABLED">Bypass Enabled</option>
        </select>
        {flowMode === 'BYPASS_ENABLED' && (
          <div className="flex gap-3 text-xs text-gray-400">
            <label className="flex items-center gap-1"><input type="checkbox" checked={alarmFlags.forwardSkip} onChange={e => setAlarmFlags({ ...alarmFlags, forwardSkip: e.target.checked })} /> Fwd Skip</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={alarmFlags.backwardJump} onChange={e => setAlarmFlags({ ...alarmFlags, backwardJump: e.target.checked })} /> Bwd Jump</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={alarmFlags.outOfSequence} onChange={e => setAlarmFlags({ ...alarmFlags, outOfSequence: e.target.checked })} /> Out of Seq</label>
          </div>
        )}
        <div className="flex-1" />
        {!isNew && profile && <span className="text-xs text-gray-500">v{profile.version}</span>}
        <button onClick={save} disabled={saving} className="px-4 py-1.5 bg-cyan-600 text-white rounded-lg text-sm hover:bg-cyan-500 disabled:opacity-50">
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar — Node Palette */}
        <div className="w-56 bg-gray-900 border-r border-gray-700 p-3 overflow-y-auto">
          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Lifecycle Stages</h4>
          {lifecycleStates.map((s: any) => (
            <button key={s.key} onClick={() => addNode('STAGE', s.key)}
              className="w-full text-left px-3 py-2 mb-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
              {s.name}
            </button>
          ))}

          <h4 className="text-xs font-semibold text-gray-500 uppercase mt-4 mb-2">Intermediate Blocks</h4>
          {['CHECKLIST', 'REMARKS', 'DURATION_INTERLOCK', 'PARAM_CAPTURE', 'CUSTOM_SCRIPT', 'APPROVAL', 'EQUIPMENT_LINK'].map(t => (
            <button key={t} onClick={() => addNode(t)}
              className="w-full text-left px-3 py-2 mb-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors">
              {t.replace(/_/g, ' ')}
            </button>
          ))}
        </div>

        {/* Canvas */}
        <div className="flex-1 bg-gray-950 relative overflow-auto p-8">
          {connectingFrom !== null && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 px-3 py-1 bg-cyan-900 text-cyan-200 rounded-full text-xs z-10">
              Click target node to connect...
              <button onClick={() => setConnectingFrom(null)} className="ml-2 text-cyan-400">Cancel</button>
            </div>
          )}

          {/* Render connection lines */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ minWidth: '100%', minHeight: '100%' }}>
            {connections.map((c, i) => {
              const from = nodes[c.fromIndex];
              const to = nodes[c.toIndex];
              if (!from || !to) return null;
              return (
                <line key={i} x1={from.positionX + 80} y1={from.positionY + 30} x2={to.positionX} y2={to.positionY + 30}
                  stroke="#4B5563" strokeWidth="2" markerEnd="url(#arrow)" />
              );
            })}
            <defs>
              <marker id="arrow" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#4B5563" />
              </marker>
            </defs>
          </svg>

          {/* Render nodes */}
          {nodes.map((node, idx) => (
            <div key={idx}
              className={`absolute w-40 rounded-lg border-2 p-3 cursor-pointer transition-all ${NODE_COLORS[node.nodeType] ?? 'bg-gray-700 border-gray-500'} ${selectedNode === idx ? 'ring-2 ring-cyan-400' : ''}`}
              style={{ left: node.positionX, top: node.positionY }}
              onClick={() => handleNodeClick(idx)}
              draggable
              onDragEnd={e => {
                const rect = (e.target as HTMLElement).closest('.bg-gray-950')?.getBoundingClientRect();
                if (rect) {
                  const newNodes = [...nodes];
                  newNodes[idx] = { ...newNodes[idx], positionX: e.clientX - rect.left - 80, positionY: e.clientY - rect.top - 30 };
                  setNodes(newNodes);
                }
              }}>
              <div className="text-xs font-semibold text-white/90 mb-1">{node.nodeType.replace(/_/g, ' ')}</div>
              {node.stateKey && <div className="text-xs text-white/60">{node.stateKey.replace(/_/g, ' ')}</div>}
              <div className="flex gap-1 mt-2">
                <button onClick={e => { e.stopPropagation(); setConnectingFrom(idx); }} className="text-xs text-white/50 hover:text-white/80">Connect →</button>
                {node.nodeType !== 'START' && node.nodeType !== 'END' && (
                  <button onClick={e => { e.stopPropagation(); removeNode(idx); }} className="text-xs text-red-400 hover:text-red-300 ml-auto">×</button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Right Sidebar — Node Config */}
        {selectedNode !== null && nodes[selectedNode] && (
          <div className="w-64 bg-gray-900 border-l border-gray-700 p-4 overflow-y-auto">
            <h4 className="text-sm font-semibold text-gray-300 mb-3">Node Configuration</h4>
            <div className="text-xs text-gray-500 mb-2">Type: {nodes[selectedNode].nodeType}</div>
            {nodes[selectedNode].stateKey && <div className="text-xs text-gray-500 mb-2">State: {nodes[selectedNode].stateKey}</div>}

            {nodes[selectedNode].nodeType === 'PARAM_CAPTURE' && (
              <div className="space-y-2">
                <div className="text-xs text-gray-400">Parameters are configured via the node's configuration JSON.</div>
                <textarea className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-xs text-gray-100 font-mono" rows={6}
                  value={JSON.stringify(nodes[selectedNode].configuration, null, 2)}
                  onChange={e => {
                    try {
                      const config = JSON.parse(e.target.value);
                      const ns = [...nodes]; ns[selectedNode!] = { ...ns[selectedNode!], configuration: config }; setNodes(ns);
                    } catch {}
                  }} />
              </div>
            )}

            {nodes[selectedNode].nodeType === 'DURATION_INTERLOCK' && (
              <div className="space-y-2">
                <label className="text-xs text-gray-400">Min Duration (min)</label>
                <input type="number" className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-gray-100 text-sm"
                  value={(nodes[selectedNode].configuration as any)?.minMinutes ?? ''}
                  onChange={e => {
                    const ns = [...nodes]; ns[selectedNode!] = { ...ns[selectedNode!], configuration: { ...ns[selectedNode!].configuration, minMinutes: parseInt(e.target.value) } }; setNodes(ns);
                  }} />
              </div>
            )}

            {nodes[selectedNode].nodeType === 'APPROVAL' && (
              <div className="space-y-2">
                <label className="text-xs text-gray-400">Required Role</label>
                <select className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-gray-100 text-sm"
                  value={(nodes[selectedNode].configuration as any)?.requiredRole ?? ''}
                  onChange={e => {
                    const ns = [...nodes]; ns[selectedNode!] = { ...ns[selectedNode!], configuration: { ...ns[selectedNode!].configuration, requiredRole: e.target.value } }; setNodes(ns);
                  }}>
                  <option value="">Any</option>
                  <option value="SUPERVISOR">Supervisor</option>
                  <option value="ORG_ADMIN">Org Admin</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </div>
            )}

            <button onClick={() => setSelectedNode(null)} className="mt-4 w-full py-1.5 bg-gray-700 text-gray-300 rounded text-sm">Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
