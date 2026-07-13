import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Pagination } from './Pagination';

describe('Pagination', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders "Page X of Y"', () => {
    render(<Pagination page={2} totalPages={5} onPageChange={vi.fn()} />);

    expect(screen.getByText('Page 2 of 5')).toBeInTheDocument();
  });

  it('disables Previous when page is 1', () => {
    render(<Pagination page={1} totalPages={5} onPageChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled();
  });

  it('disables Next when page equals totalPages', () => {
    render(<Pagination page={5} totalPages={5} onPageChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous' })).not.toBeDisabled();
  });

  it('calls onPageChange with page - 1 when Previous is clicked', () => {
    const onPageChange = vi.fn();
    render(<Pagination page={3} totalPages={5} onPageChange={onPageChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));

    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('calls onPageChange with page + 1 when Next is clicked', () => {
    const onPageChange = vi.fn();
    render(<Pagination page={3} totalPages={5} onPageChange={onPageChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  it('both Previous and Next are enabled when totalPages is 1... page is 1 (edge: single page)', () => {
    render(<Pagination page={1} totalPages={1} onPageChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });
});
