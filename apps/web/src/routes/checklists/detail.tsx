import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { apiClient } from '../../lib/api-client';

const QUESTION_TYPES = [
  { value: 'YES_NO',       label: 'Yes / No' },
  { value: 'PASS_FAIL',    label: 'Pass / Fail' },
  { value: 'YES_NO_NA',    label: 'Yes / No / N/A' },
  { value: 'TEXT',          label: 'Text Input' },
  { value: 'NUMERIC',       label: 'Numeric Input' },
  { value: 'DROPDOWN',      label: 'Dropdown' },
  { value: 'MULTI_SELECT',  label: 'Multi Select' },
  { value: 'DATE_TIME',     label: 'Date / Time' },
  { value: 'PHOTO',         label: 'Photo Upload' },
  { value: 'SIGNATURE',     label: 'Signature' },
  { value: 'CALCULATED',    label: 'Calculated' },
  { value: 'CONDITIONAL',   label: 'Conditional' },
];

const TYPES_WITH_OPTIONS = ['DROPDOWN', 'MULTI_SELECT'];
const TYPES_WITH_NUMERIC = ['NUMERIC'];

interface QuestionForm {
  question: string; questionType: string; required: boolean;
  section: string; description: string; options: string[];
  validation: { min?: number; max?: number; unit?: string; expression?: string };
}

function emptyQuestion(): QuestionForm {
  return { question: '', questionType: 'YES_NO', required: false, section: '', description: '', options: [], validation: {} };
}

export function ChecklistProfileDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const swrKey = `/api/checklist-profiles/${id}`;
  const { data: profile, isLoading } = useSWR(id ? swrKey : null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<QuestionForm>(emptyQuestion());
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [optionInput, setOptionInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const questions = profile?.questions ?? [];

  const openAdd = () => { setForm(emptyQuestion()); setEditingId(null); setShowAdd(true); };
  const openEdit = (q: any) => {
    setForm({
      question: q.question, questionType: q.questionType, required: q.required,
      section: q.section ?? '', description: q.description ?? '',
      options: Array.isArray(q.options) ? q.options : [],
      validation: q.validation ?? {},
    });
    setEditingId(q.id); setShowAdd(true);
  };

  const saveQuestion = async () => {
    if (!form.question.trim()) return;
    setSaving(true);
    try {
      const body = { ...form, options: form.options, validation: form.validation };
      if (editingId) {
        await apiClient.put(`/api/checklist-profiles/${id}/questions/${editingId}`, body);
      } else {
        await apiClient.post(`/api/checklist-profiles/${id}/questions`, body);
      }
      mutate(swrKey); setShowAdd(false); setEditingId(null); setForm(emptyQuestion()); setError(null);
    } catch (e: any) { setError(e.message || 'Failed to save question'); console.error(e); }
    setSaving(false);
  };

  const deleteQuestion = async (qId: string) => {
    try { await apiClient.delete(`/api/checklist-profiles/${id}/questions/${qId}`); mutate(swrKey); setError(null); }
    catch (e: any) { setError(e.message || 'Failed to delete question'); console.error(e); }
  };

  const moveQuestion = async (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= questions.length) return;
    const ids = questions.map((q: any) => q.id);
    [ids[idx], ids[newIdx]] = [ids[newIdx], ids[idx]];
    try { await apiClient.put(`/api/checklist-profiles/${id}/reorder`, { questionIds: ids }); mutate(swrKey); }
    catch (e: any) { setError(e.message || 'Failed to reorder questions'); console.error(e); }
  };

  const addOption = () => {
    if (!optionInput.trim()) return;
    setForm({ ...form, options: [...form.options, optionInput.trim()] });
    setOptionInput('');
  };

  const removeOption = (idx: number) => {
    setForm({ ...form, options: form.options.filter((_, i) => i !== idx) });
  };

  const typeLabel = (t: string) => QUESTION_TYPES.find(qt => qt.value === t)?.label ?? t;

  if (isLoading) return <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/checklists')} className="text-slate-500 hover:text-slate-700 text-sm">&larr; Back</button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-800">{profile?.name ?? 'Checklist'}</h1>
          {profile?.description && <p className="text-sm text-slate-400 mt-0.5">{profile.description}</p>}
        </div>
        <span className={`px-2.5 py-1 text-xs rounded-full font-medium ${profile?.isActive ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
          {profile?.isActive ? 'Active' : 'Inactive'}
        </span>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-600 hover:text-red-600 ml-4">&times;</button>
        </div>
      )}

      {/* Questions */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">{questions.length} Question{questions.length !== 1 ? 's' : ''}</h2>
          <button onClick={openAdd} className="px-3 py-1.5 bg-cyan-600 text-white rounded-lg text-sm hover:bg-cyan-500">+ Add Question</button>
        </div>

        {questions.length === 0 ? (
          <div className="text-center py-16 bg-slate-50 rounded-xl border border-slate-200">
            <div className="text-3xl mb-2 text-slate-300">&#x2753;</div>
            <p className="text-slate-400">No questions yet. Add your first question.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {questions.map((q: any, idx: number) => (
              <div key={q.id} className="bg-white border border-slate-200 rounded-xl p-4 flex items-start gap-3 group hover:border-slate-300 transition-colors">
                <div className="flex flex-col gap-1 shrink-0 pt-1">
                  <button onClick={() => moveQuestion(idx, -1)} disabled={idx === 0}
                    className="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-700 disabled:opacity-30 flex items-center justify-center text-xs">&#9650;</button>
                  <button onClick={() => moveQuestion(idx, 1)} disabled={idx === questions.length - 1}
                    className="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-700 disabled:opacity-30 flex items-center justify-center text-xs">&#9660;</button>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2">
                    <span className="text-slate-400 text-sm font-mono shrink-0">{idx + 1}.</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-slate-800 font-medium">{q.question}</div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="px-2 py-0.5 text-[10px] rounded bg-slate-100 text-slate-600 font-medium">{typeLabel(q.questionType)}</span>
                        {q.required && <span className="px-2 py-0.5 text-[10px] rounded bg-amber-50 text-amber-700">Required</span>}
                        {q.section && <span className="px-2 py-0.5 text-[10px] rounded bg-slate-100 text-slate-500">{q.section}</span>}
                        {Array.isArray(q.options) && q.options.length > 0 && (
                          <span className="text-[10px] text-slate-400">{q.options.length} options</span>
                        )}
                      </div>
                      {q.description && <div className="text-xs text-slate-400 mt-1">{q.description}</div>}
                    </div>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => openEdit(q)} className="px-2 py-1 text-xs text-slate-500 hover:text-cyan-600 bg-slate-100 hover:bg-slate-200 rounded">Edit</button>
                  <button onClick={() => deleteQuestion(q.id)} className="px-2 py-1 text-xs text-slate-500 hover:text-red-600 bg-slate-100 hover:bg-red-50 rounded">&times;</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Question Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => { setShowAdd(false); setEditingId(null); }}>
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-800">{editingId ? 'Edit Question' : 'Add Question'}</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Question *</label>
                <textarea className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 text-sm" rows={2}
                  value={form.question} onChange={e => setForm({ ...form, question: e.target.value })} placeholder="Enter your question..." autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Type</label>
                  <select className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 text-sm"
                    value={form.questionType} onChange={e => setForm({ ...form, questionType: e.target.value, options: TYPES_WITH_OPTIONS.includes(e.target.value) ? form.options : [] })}>
                    {QUESTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Section (optional)</label>
                  <input className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 text-sm"
                    value={form.section} onChange={e => setForm({ ...form, section: e.target.value })} placeholder="e.g. Pre-checks" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={form.required} onChange={e => setForm({ ...form, required: e.target.checked })}
                    className="w-4 h-4 rounded border-slate-400 bg-slate-100 text-cyan-600" />
                  Required
                </label>
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Help Text / Description (optional)</label>
                <input className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 text-sm"
                  value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Additional guidance for this question" />
              </div>

              {/* Options for Dropdown / Multi Select */}
              {TYPES_WITH_OPTIONS.includes(form.questionType) && (
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Options</label>
                  <div className="space-y-1 mb-2">
                    {form.options.map((opt, i) => (
                      <div key={i} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-1.5">
                        <span className="text-sm text-slate-600 flex-1">{opt}</span>
                        <button onClick={() => removeOption(i)} className="text-xs text-slate-400 hover:text-red-600">&times;</button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input className="flex-1 bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-slate-800 text-sm"
                      value={optionInput} onChange={e => setOptionInput(e.target.value)} placeholder="Add option..."
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOption(); } }} />
                    <button onClick={addOption} className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-sm hover:bg-slate-200">Add</button>
                  </div>
                </div>
              )}

              {/* Numeric validation */}
              {TYPES_WITH_NUMERIC.includes(form.questionType) && (
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Min</label>
                    <input type="number" className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 text-sm"
                      value={form.validation.min ?? ''} onChange={e => setForm({ ...form, validation: { ...form.validation, min: e.target.value ? Number(e.target.value) : undefined } })} />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Max</label>
                    <input type="number" className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 text-sm"
                      value={form.validation.max ?? ''} onChange={e => setForm({ ...form, validation: { ...form.validation, max: e.target.value ? Number(e.target.value) : undefined } })} />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Unit</label>
                    <input className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 text-sm"
                      value={form.validation.unit ?? ''} onChange={e => setForm({ ...form, validation: { ...form.validation, unit: e.target.value } })} placeholder="e.g. °C" />
                  </div>
                </div>
              )}

              {/* Calculated expression */}
              {form.questionType === 'CALCULATED' && (
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Expression</label>
                  <input className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 text-sm font-mono"
                    value={form.validation.expression ?? ''} onChange={e => setForm({ ...form, validation: { ...form.validation, expression: e.target.value } })} placeholder="e.g. q_1 + q_2" />
                </div>
              )}
            </div>
            <div className="p-4 border-t border-slate-200 flex gap-2">
              <button onClick={() => { setShowAdd(false); setEditingId(null); }} className="flex-1 py-2 bg-slate-100 text-slate-600 rounded-lg text-sm">Cancel</button>
              <button onClick={saveQuestion} disabled={saving || !form.question.trim()} className="flex-1 py-2 bg-cyan-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                {saving ? 'Saving...' : editingId ? 'Update' : 'Add Question'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
