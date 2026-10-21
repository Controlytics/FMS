import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { usePageTestLifecycle } from '../../__tests__/fm-test-kit';
import { ChecklistDialog } from '../checklist-dialog';

usePageTestLifecycle();

const q = (id: string, questionType: string, over: any = {}) => ({
  id, question: `Q ${id}`, questionType, required: false, section: null, description: null, options: [], sortOrder: 0, ...over,
});

const QUESTIONS = [
  q('yn', 'YES_NO_NA', { section: 'Pre-wash', description: 'Look at the frame', required: true }),
  q('pf', 'PASS_FAIL', { section: 'Pre-wash' }),
  q('num', 'NUMERIC', { section: 'Readings' }),
  q('dd', 'DROPDOWN', { options: ['Low', { value: 'hi', label: 'High' }] }),
  q('dd2', 'DROPDOWN', { options: 'not-an-array' }),
  q('ms', 'MULTI_SELECT', { options: ['A', { value: 'b', label: 'Bee' }] }),
  q('ms2', 'MULTI_SELECT', { options: null }),
  q('txt', 'TEXT'),
  q('free', 'SOMETHING_NEW'),
];
const dialog = {
  filterId: 'f1', filterName: 'FLT-1',
  checklists: [
    { pipelineNodeId: 'n1', checklistProfileId: 'p1', checklistProfileName: 'Post-wash checks', questions: QUESTIONS },
    { pipelineNodeId: 'n2', checklistProfileId: 'p2', checklistProfileName: 'Sign-off', questions: [q('s1', 'YES_NO', { required: true, question: 'Supervisor present?' })] },
  ],
};

describe('ChecklistDialog — every question type', () => {
  it('renders nothing without a dialog', () => {
    const { container } = render(<ChecklistDialog dialog={null} onClose={vi.fn()} onSubmit={vi.fn()} loading={false} error="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows profiles, section headers once per run, descriptions and required marks', () => {
    render(<ChecklistDialog dialog={dialog} onClose={vi.fn()} onSubmit={vi.fn()} loading={false} error="" />);
    expect(screen.getByText('FLT-1')).toBeInTheDocument();
    expect(screen.getByText('Post-wash checks')).toBeInTheDocument();
    expect(screen.getByText('Sign-off')).toBeInTheDocument();
    expect(screen.getAllByText('Pre-wash')).toHaveLength(1);
    expect(screen.getByText('Readings')).toBeInTheDocument();
    expect(screen.getByText('Look at the frame')).toBeInTheDocument();
    expect(screen.getAllByText('*')).toHaveLength(2);
  });

  it('collects an answer from each control type and submits them all', () => {
    const onSubmit = vi.fn();
    render(<ChecklistDialog dialog={dialog} onClose={vi.fn()} onSubmit={onSubmit} loading={false} error="" />);
    fireEvent.click(screen.getByRole('button', { name: 'N/A' }));
    const fail = screen.getByRole('button', { name: 'Fail' });
    fireEvent.click(fail);
    expect(fail).toHaveAttribute('aria-pressed', 'true');
    expect(fail.className).toContain('bg-red-600');
    fireEvent.click(screen.getByRole('button', { name: 'Pass' }));
    expect(screen.getByRole('button', { name: 'Pass' }).className).toContain('bg-green-600');
    fireEvent.change(screen.getByPlaceholderText('Enter value'), { target: { value: '42' } });
    const [dd, dd2] = screen.getAllByRole('combobox') as HTMLSelectElement[];
    expect([...dd.options].map((o) => [o.value, o.textContent])).toEqual([['', 'Select...'], ['Low', 'Low'], ['hi', 'High']]);
    expect(dd2.options).toHaveLength(1);
    fireEvent.change(dd, { target: { value: 'hi' } });
    // multi-select toggles on and off
    fireEvent.click(screen.getByRole('button', { name: 'A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bee' }));
    fireEvent.click(screen.getByRole('button', { name: 'A' }));
    const [txt, free] = screen.getAllByPlaceholderText('Enter answer');
    fireEvent.change(txt, { target: { value: 'clean' } });
    fireEvent.change(free, { target: { value: 'ok' } });
    // the sign-off checklist's YES_NO is the second "Yes" in document order
    fireEvent.click(screen.getAllByRole('button', { name: 'Yes' })[1]);
    fireEvent.click(screen.getByRole('button', { name: /Submit Checklist/ }));
    expect(onSubmit).toHaveBeenCalledWith({ yn: 'N/A', pf: 'Pass', num: '42', dd: 'hi', ms: ['b'], txt: 'clean', free: 'ok', s1: 'Yes' });
  });

  it('names the first unanswered required question, across checklists', () => {
    const onSubmit = vi.fn();
    render(<ChecklistDialog dialog={dialog} onClose={vi.fn()} onSubmit={onSubmit} loading={false} error="" />);
    fireEvent.click(screen.getByRole('button', { name: /Submit Checklist/ }));
    expect(screen.getByText('Please answer: "Q yn"')).toBeInTheDocument();
    // "Yes" of the YES_NO_NA question is first in document order
    fireEvent.click(screen.getAllByRole('button', { name: 'Yes' })[0]);
    fireEvent.click(screen.getByRole('button', { name: /Submit Checklist/ }));
    expect(screen.getByText('Please answer: "Supervisor present?"')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('an emptied numeric answer counts as unanswered', () => {
    const onSubmit = vi.fn();
    const d = { ...dialog, checklists: [{ ...dialog.checklists[0], questions: [q('n', 'NUMERIC', { required: true, question: 'Pressure?' })] }] };
    render(<ChecklistDialog dialog={d} onClose={vi.fn()} onSubmit={onSubmit} loading={false} error="" />);
    fireEvent.change(screen.getByPlaceholderText('Enter value'), { target: { value: '3' } });
    fireEvent.change(screen.getByPlaceholderText('Enter value'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit Checklist/ }));
    expect(screen.getByText('Please answer: "Pressure?"')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a parent error is shown; loading disables Cancel and Submit; Cancel closes', () => {
    const onClose = vi.fn();
    const { rerender } = render(<ChecklistDialog dialog={dialog} onClose={onClose} onSubmit={vi.fn()} loading error="CHECKLIST_REQUIRED" />);
    expect(screen.getByText('CHECKLIST_REQUIRED')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Submit Checklist/ })).toBeNull();
    rerender(<ChecklistDialog dialog={dialog} onClose={onClose} onSubmit={vi.fn()} loading={false} error="" />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('other keys do not close; reopening with a new dialog clears earlier answers', () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    const { rerender } = render(<ChecklistDialog dialog={dialog} onClose={onClose} onSubmit={onSubmit} loading={false} error="" />);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'N/A' }));
    rerender(<ChecklistDialog dialog={{ ...dialog }} onClose={onClose} onSubmit={onSubmit} loading={false} error="" />);
    expect(screen.getByRole('button', { name: 'N/A' })).toHaveAttribute('aria-pressed', 'false');
  });
});
