import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ui';

describe('ConfirmDialog', () => {
  it('blocks confirmation until a required comment is entered', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open title="Reject batch" message="Sure?" confirmLabel="Reject" withComment commentRequired onConfirm={onConfirm} onClose={() => undefined} />);
    const btn = screen.getByRole('button', { name: 'Reject' });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'Overtime wrong' } });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onConfirm).toHaveBeenCalledWith('Overtime wrong');
  });

  it('closes on Escape and exposes dialog semantics', () => {
    const onClose = vi.fn();
    render(<ConfirmDialog open title="Finalise" message="Lock it" confirmLabel="Go" onConfirm={() => undefined} onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Finalise' })).toHaveAttribute('aria-modal', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
