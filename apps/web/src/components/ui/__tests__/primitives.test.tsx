import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { createRef, useState } from 'react';
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from '../dialog';
import { Button } from '../button';
import { Input } from '../input';
import { Select } from '../select';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../card';
import { Badge } from '../badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../table';
import { ReasonBox, reasonOk, MIN_REASON_LEN } from '../reason-box';

/**
 * Shared UI primitives. Most are thin class wrappers, so the tests assert what a
 * caller relies on: the right element/role, props and refs forwarded, the
 * variant's semantic colour, and the few real behaviours (Dialog's Escape stack
 * and backdrop, Input's secureField, ReasonBox's countdown).
 */

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
  consoleWarn = vi.spyOn(console, 'warn');
});
afterEach(() => {
  cleanup();
  // Normal use of every primitive must be console-silent.
  expect(consoleError).not.toHaveBeenCalled();
  expect(consoleWarn).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

describe('Dialog', () => {
  it('renders nothing while closed', () => {
    render(<Dialog open={false} onClose={() => {}}><p>Body</p></Dialog>);
    expect(screen.queryByText('Body')).toBeNull();
  });

  it('renders its children, header, title (h2) and footer when open', () => {
    render(
      <Dialog open onClose={() => {}} className="max-w-xl">
        <DialogHeader data-testid="hdr"><DialogTitle>Edit record</DialogTitle></DialogHeader>
        <p>Body</p>
        <DialogFooter data-testid="ftr"><button>Save</button></DialogFooter>
      </Dialog>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Edit record' })).toBeInTheDocument();
    expect(screen.getByText('Body')).toBeInTheDocument();
    expect(screen.getByTestId('hdr')).toHaveClass('mb-5');
    expect(screen.getByTestId('ftr')).toHaveClass('justify-end');
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    // The caller's className reaches the panel.
    expect(screen.getByText('Body').parentElement).toHaveClass('max-w-xl');
  });

  it('Escape closes it; other keys do not', () => {
    const onClose = vi.fn();
    render(<Dialog open onClose={onClose}><p>Body</p></Dialog>);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a backdrop click closes it; a click inside the panel does not', () => {
    const onClose = vi.fn();
    const { container } = render(<Dialog open onClose={onClose}><p>Body</p></Dialog>);
    fireEvent.click(screen.getByText('Body'));
    expect(onClose).not.toHaveBeenCalled();
    const backdrop = container.querySelector('.bg-slate-900\\/50') as HTMLElement;
    // mousedown on the backdrop is default-prevented (keeps focus where it was).
    expect(fireEvent.mouseDown(backdrop)).toBe(false);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('with two dialogs open, Escape closes only the TOPMOST; then the one beneath', () => {
    function Stack() {
      const [lower, setLower] = useState(true);
      const [upper, setUpper] = useState(true);
      return (
        <>
          <Dialog open={lower} onClose={() => setLower(false)}><p>Lower</p></Dialog>
          <Dialog open={upper} onClose={() => setUpper(false)} priority><p>Upper</p></Dialog>
        </>
      );
    }
    render(<Stack />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Upper')).toBeNull();
    expect(screen.getByText('Lower')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Lower')).toBeNull();
  });

  it('priority raises both layers above a normal dialog', () => {
    const { container, rerender } = render(<Dialog open onClose={() => {}} priority><p>P</p></Dialog>);
    expect(container.firstElementChild).toHaveClass('z-[60]');
    expect(screen.getByText('P').parentElement).toHaveClass('z-[60]');
    rerender(<Dialog open onClose={() => {}}><p>P</p></Dialog>);
    expect(container.firstElementChild).toHaveClass('z-50');
  });

  it('stops listening after it closes', () => {
    const onClose = vi.fn();
    const { rerender } = render(<Dialog open onClose={onClose}><p>B</p></Dialog>);
    rerender(<Dialog open={false} onClose={onClose}><p>B</p></Dialog>);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Button', () => {
  it('is a button that forwards its ref, props and clicks', () => {
    const ref = createRef<HTMLButtonElement>();
    const onClick = vi.fn();
    render(<Button ref={ref} type="submit" onClick={onClick}>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(ref.current).toBe(btn);
    expect(btn).toHaveAttribute('type', 'submit');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('defaults to the brand fill; each variant applies its own semantic colour', () => {
    const { rerender } = render(<Button>X</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-brand-600', 'h-10');
    rerender(<Button variant="destructive">X</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-red-600');
    rerender(<Button variant="success" size="sm">X</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-emerald-700', 'h-8');
    rerender(<Button variant="outline" size="lg" className="w-full">X</Button>);
    expect(screen.getByRole('button')).toHaveClass('border-slate-300', 'h-11', 'w-full');
    rerender(<Button variant="link" size="icon">X</Button>);
    expect(screen.getByRole('button')).toHaveClass('text-brand-700', 'w-10');
  });

  it('a disabled button does not fire', () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>X</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('Input', () => {
  it('forwards ref, value and change events', () => {
    const ref = createRef<HTMLInputElement>();
    const onChange = vi.fn();
    render(<Input ref={ref} aria-label="Name" defaultValue="a" onChange={onChange} className="mt-2" />);
    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(ref.current).toBe(input);
    expect(input).toHaveClass('mt-2');
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect((input as HTMLInputElement).value).toBe('abc');
  });

  it('a normal field allows copy / paste / cut / drag / context menu', () => {
    render(<Input aria-label="Plain" />);
    const input = screen.getByRole('textbox', { name: 'Plain' });
    // fireEvent returns false when the default action was prevented.
    expect(fireEvent.copy(input)).toBe(true);
    expect(fireEvent.paste(input)).toBe(true);
    expect(fireEvent.cut(input)).toBe(true);
    expect(fireEvent.dragStart(input)).toBe(true);
    expect(fireEvent.contextMenu(input)).toBe(true);
  });

  it('secureField blocks copy / paste / cut / drag / context menu (password entry)', () => {
    render(<Input aria-label="Secret" secureField />);
    const input = screen.getByRole('textbox', { name: 'Secret' });
    expect(fireEvent.copy(input)).toBe(false);
    expect(fireEvent.paste(input)).toBe(false);
    expect(fireEvent.cut(input)).toBe(false);
    expect(fireEvent.dragStart(input)).toBe(false);
    expect(fireEvent.contextMenu(input)).toBe(false);
    // secureField is not leaked onto the DOM element.
    expect(input).not.toHaveAttribute('secureField');
    expect(input).not.toHaveAttribute('securefield');
  });
});

describe('Select', () => {
  it('forwards ref, options and change events', () => {
    const ref = createRef<HTMLSelectElement>();
    const onChange = vi.fn();
    render(
      <Select ref={ref} aria-label="Status" defaultValue="b" onChange={onChange}>
        <option value="a">A</option><option value="b">B</option>
      </Select>,
    );
    const sel = screen.getByRole('combobox', { name: 'Status' }) as HTMLSelectElement;
    expect(ref.current).toBe(sel);
    expect(sel.value).toBe('b');
    fireEvent.change(sel, { target: { value: 'a' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(sel.value).toBe('a');
    // (The chevron is an inline `url("data:…")` background-image; jsdom's CSS
    // parser drops that value, so it cannot be observed here.)
  });

  it('applies the size + variant border/sizing styling', () => {
    // Variant BACKGROUND colours are deliberately not asserted: tailwind-merge
    // strips them in every variant — defect D-UI-3 in the coverage report.
    const { rerender } = render(<Select aria-label="S"><option>x</option></Select>);
    expect(screen.getByRole('combobox')).toHaveClass('h-10', 'border-slate-300', 'bg-[length:1rem]', 'bg-[right_0.625rem_center]');
    rerender(<Select aria-label="S" selectSize="sm" variant="filled"><option>x</option></Select>);
    expect(screen.getByRole('combobox')).toHaveClass('h-8', 'border-transparent', 'hover:bg-slate-200/70', 'bg-[length:0.875rem]');
    rerender(<Select aria-label="S" selectSize="lg" variant="outlined" className="w-40"><option>x</option></Select>);
    expect(screen.getByRole('combobox')).toHaveClass('h-11', 'border-slate-400', 'bg-[length:1.125rem]', 'w-40');
  });

  it('a disabled select cannot be focused for change', () => {
    render(<Select aria-label="S" disabled><option>x</option></Select>);
    expect(screen.getByRole('combobox')).toBeDisabled();
  });
});

describe('Card', () => {
  it('renders title as an h3 with description, content and footer', () => {
    render(
      <Card data-testid="card" className="p-0">
        <CardHeader><CardTitle>Filters</CardTitle><CardDescription>All filters</CardDescription></CardHeader>
        <CardContent>Body</CardContent>
        <CardFooter>Foot</CardFooter>
      </Card>,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Filters' })).toBeInTheDocument();
    expect(screen.getByText('All filters').tagName).toBe('P');
    expect(screen.getByText('Body')).toHaveClass('p-5');
    expect(screen.getByText('Foot')).toHaveClass('flex');
    expect(screen.getByTestId('card')).toHaveClass('rounded-xl', 'p-0');
  });
});

describe('Badge', () => {
  it('renders its text with the variant colour', () => {
    const { rerender } = render(<Badge>Active</Badge>);
    expect(screen.getByText('Active')).toHaveClass('bg-slate-100');
    rerender(<Badge variant="success">Active</Badge>);
    expect(screen.getByText('Active')).toHaveClass('bg-emerald-50', 'text-emerald-700');
    rerender(<Badge variant="warning">Active</Badge>);
    expect(screen.getByText('Active')).toHaveClass('bg-amber-50');
    rerender(<Badge variant="destructive" className="ml-1" title="t">Active</Badge>);
    expect(screen.getByText('Active')).toHaveClass('bg-red-50', 'ml-1');
    expect(screen.getByText('Active')).toHaveAttribute('title', 't');
  });
});

describe('Table', () => {
  it('renders a real table with column headers and cells', () => {
    render(
      <Table aria-label="Filters" className="min-w-max">
        <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
        <TableBody>
          <TableRow className="x"><TableCell>F-1</TableCell><TableCell>Done</TableCell></TableRow>
        </TableBody>
      </Table>,
    );
    const table = screen.getByRole('table', { name: 'Filters' });
    expect(table).toHaveClass('min-w-max');
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Name', 'Status']);
    expect(screen.getAllByRole('cell').map((c) => c.textContent)).toEqual(['F-1', 'Done']);
    expect(screen.getAllByRole('row')[1]).toHaveClass('x');
    // Scroll container wraps the table so wide tables scroll, not overflow the page.
    expect(table.parentElement).toHaveClass('overflow-auto');
  });
});

describe('ReasonBox', () => {
  it('reasonOk needs MIN_REASON_LEN non-blank characters', () => {
    expect(MIN_REASON_LEN).toBe(5);
    expect(reasonOk('abcd')).toBe(false);
    expect(reasonOk('   abcd   ')).toBe(false);
    expect(reasonOk('abcde')).toBe(true);
    expect(reasonOk('  abcde  ')).toBe(true);
  });

  it('counts down the characters still required (plural / singular), then shows the hint', () => {
    function Host({ hint }: { hint?: string }) {
      const [v, setV] = useState('');
      return <ReasonBox value={v} onChange={setV} hint={hint} />;
    }
    const { rerender } = render(<Host />);
    const box = screen.getByRole('textbox');
    expect(box).toHaveAttribute('placeholder', 'Why is this record being changed?');
    expect(screen.getByText('5 more characters required')).toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'abcd' } });
    expect(screen.getByText('1 more character required')).toBeInTheDocument();
    fireEvent.change(box, { target: { value: '  abcd ' } }); // whitespace does not count
    expect(screen.getByText('1 more character required')).toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'abcde' } });
    expect(screen.getByText('Recorded on the audit trail alongside the before/after values.')).toBeInTheDocument();
    rerender(<Host hint="Custom hint" />);
    expect(screen.getByText('Custom hint')).toBeInTheDocument();
  });

  it('marks the field required and honours danger styling and a custom placeholder', () => {
    render(<ReasonBox value="" onChange={() => {}} danger placeholder="Why delete?" />);
    expect(screen.getByText('*')).toHaveClass('text-red-500');
    const box = screen.getByPlaceholderText('Why delete?');
    expect(box).toHaveClass('border-red-200');
  });
});
