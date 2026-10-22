import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '../button';

/**
 * P1 (2026-10-22): <Button> rendered a bare <button>, whose HTML default type is
 * "submit". Any Button placed inside a <form> without an explicit type submitted
 * it: My Profile's Cancel saved the edits before going back.
 *
 * Button now defaults to type="button"; a submit button must say type="submit".
 * Survey before the change: of 143 typeless <Button>s in apps/web/src, the only
 * one inside a <form> was that Cancel. No Button used form="id" and every
 * component rendered inside a form already passed explicit types.
 */
describe('Button — default type', () => {
  it('defaults to type="button"', () => {
    render(<Button>Cancel</Button>);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('type', 'button');
  });

  it('a typeless Button inside a form does not submit it; an explicit type="submit" does', () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button onClick={() => {}}>Cancel</Button>
        <Button type="submit">Save</Button>
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('an explicit type="reset" is kept', () => {
    render(<Button type="reset">Reset</Button>);
    expect(screen.getByRole('button', { name: 'Reset' })).toHaveAttribute('type', 'reset');
  });
});
