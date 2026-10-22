import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { SearchableSelect, MAX_VISIBLE_OPTIONS } from '../searchable-select';

const manyFilters = Array.from({ length: 2500 }, (_, i) => ({
  value: `f${i}`,
  label: `HF-${String(i).padStart(4, '0')}`,
}));

const openPanel = () => fireEvent.click(screen.getByRole('button', { expanded: false }));
const searchFor = (text: string) =>
  fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: text } });

describe('SearchableSelect', () => {
  test('shows the selected option label on the trigger', () => {
    render(<SearchableSelect value="f7" onChange={vi.fn()} options={manyFilters} />);

    expect(screen.getByRole('button')).toHaveTextContent('HF-0007');
  });

  test('falls back to the placeholder when nothing is selected', () => {
    render(
      <SearchableSelect value="" onChange={vi.fn()} options={manyFilters} placeholder="Pick one" />,
    );

    expect(screen.getByRole('button')).toHaveTextContent('Pick one');
  });

  test('renders at most MAX_VISIBLE_OPTIONS rows even with 2500 options', () => {
    render(<SearchableSelect value="" onChange={vi.fn()} options={manyFilters} />);

    openPanel();

    expect(screen.getAllByRole('option')).toHaveLength(MAX_VISIBLE_OPTIONS);
  });

  test('tells the operator how many matches the cap is hiding', () => {
    render(<SearchableSelect value="" onChange={vi.fn()} options={manyFilters} />);

    openPanel();

    expect(screen.getByText(/Showing 50 of 2,500/)).toBeInTheDocument();
  });

  test('typing narrows the list and drops the cap notice once under the cap', () => {
    render(<SearchableSelect value="" onChange={vi.fn()} options={manyFilters} />);

    openPanel();
    searchFor('HF-0042');

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('HF-0042');
    expect(screen.queryByText(/keep typing to narrow/)).not.toBeInTheDocument();
  });

  test('selecting an option reports its value and closes the panel', () => {
    const onChange = vi.fn();
    render(<SearchableSelect value="" onChange={onChange} options={manyFilters} />);

    openPanel();
    searchFor('HF-0042');
    fireEvent.click(screen.getByRole('option', { name: 'HF-0042' }));

    expect(onChange).toHaveBeenCalledWith('f42');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  test('shows an empty state rather than a blank panel when nothing matches', () => {
    render(<SearchableSelect value="" onChange={vi.fn()} options={manyFilters} />);

    openPanel();
    searchFor('zzzz');

    expect(within(screen.getByRole('listbox')).getByText('No matches')).toBeInTheDocument();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  test('Escape closes without changing the selection', () => {
    const onChange = vi.fn();
    render(<SearchableSelect value="" onChange={onChange} options={manyFilters} />);

    openPanel();
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  test('tapping outside closes without changing the selection', () => {
    const onChange = vi.fn();
    render(<SearchableSelect value="" onChange={onChange} options={manyFilters} />);

    openPanel();
    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  test('the clear-search button empties the query, restores the list and refocuses the search box', () => {
    render(<SearchableSelect value="" onChange={vi.fn()} options={manyFilters} />);

    openPanel();
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
    searchFor('HF-0042');
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));

    const search = screen.getByPlaceholderText(/search/i);
    expect(search).toHaveValue('');
    expect(document.activeElement).toBe(search);
    expect(screen.getAllByRole('option')).toHaveLength(MAX_VISIBLE_OPTIONS);
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
  });

  test('marks the current value as the selected option', () => {
    render(<SearchableSelect value="f1" onChange={vi.fn()} options={manyFilters.slice(0, 3)} />);

    openPanel();

    expect(screen.getByRole('option', { name: 'HF-0001' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: 'HF-0000' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('button', { expanded: true })).toHaveAttribute('aria-haspopup', 'listbox');
  });

  test('anchors the panel to the right edge when asked, the left by default', () => {
    const { unmount } = render(<SearchableSelect value="" onChange={vi.fn()} options={manyFilters.slice(0, 2)} align="right" />);
    openPanel();
    expect(screen.getByRole('listbox').parentElement).toHaveClass('right-0');
    unmount();

    render(<SearchableSelect value="" onChange={vi.fn()} options={manyFilters.slice(0, 2)} />);
    openPanel();
    expect(screen.getByRole('listbox').parentElement).toHaveClass('left-0');
  });

  test('a disabled trigger does not open', () => {
    render(<SearchableSelect value="" onChange={vi.fn()} options={manyFilters} disabled />);

    fireEvent.click(screen.getByRole('button'));

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  test('a tap inside the panel or another key does not close it; the trigger toggles it shut', () => {
    render(<SearchableSelect value="" onChange={vi.fn()} options={manyFilters.slice(0, 3)} searchPlaceholder="Find a filter" />);

    openPanel();
    fireEvent.pointerDown(screen.getByPlaceholderText('Find a filter'));
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { expanded: true }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  test('a stale query does not survive reopening the panel', () => {
    render(<SearchableSelect value="" onChange={vi.fn()} options={manyFilters} />);

    openPanel();
    searchFor('HF-0042');
    fireEvent.keyDown(document, { key: 'Escape' });
    openPanel();

    expect(screen.getByPlaceholderText(/search/i)).toHaveValue('');
    expect(screen.getAllByRole('option')).toHaveLength(MAX_VISIBLE_OPTIONS);
  });

  // 2026-10-22: the trigger was named only by its value ("All"), so a screen
  // reader never heard which field it was. With `labelId` it is named by the
  // visible label AND the value; the open list is named by the label; the
  // search box always has a name.
  test('labelId names the trigger "<label> <value>", and the open list by the label', () => {
    render(
      <>
        <label id="ahu-label">AHU</label>
        <SearchableSelect value="f7" onChange={vi.fn()} options={manyFilters.slice(0, 10)} labelId="ahu-label" />
      </>,
    );
    expect(screen.getByRole('button', { name: 'AHU HF-0007' })).toBeInTheDocument();
    openPanel();
    expect(screen.getByRole('listbox', { name: 'AHU' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Type to search…' })).toBeInTheDocument();
  });

  test('without labelId the trigger is still named by its value (unchanged)', () => {
    render(<SearchableSelect value="" onChange={vi.fn()} options={manyFilters.slice(0, 3)} placeholder="All" />);
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-labelledby');
  });
});
