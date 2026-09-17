import React, { useState } from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ExerciseWithSets from './ExerciseWithSets';
import { IDLE_REST } from '@/lib/restTimer';

/* A list of exercises with the one-open-at-a-time state the session owns. */
function mount() {
  const toggle = vi.fn();
  const rest = vi.fn();
  const List = () => {
    const [expanded, setExpanded] = useState<number | null>(0);
    return <>{['Bankdrücken', 'Plank', 'Bankdrücken enger Griff'].map((name, index) => (
      <ExerciseWithSets key={name} exercise={{ name, sets: 2, reps: '10' }} exerciseIndex={index}
        isSetCompleted={(_e, s) => s === 1} getCompletedSetsCount={() => 1}
        onToggleSet={toggle} isToggling={false}
        isExpanded={expanded === index} onExpandedChange={(open) => setExpanded(open ? index : null)}
        timerState={{ ...IDLE_REST, remainingSeconds: 0, isComplete: false }} isRestSheetOpen={false} onOpenRest={rest} />
    ))}</>;
  };
  render(<List />);
  return { user: userEvent.setup(), toggle, rest };
}

describe('active exercise guidance', () => {
  it('opens from independent Info controls, renders two tabs, and preserves completed sets and collapse', async () => {
    const { user, toggle, rest } = mount();
    const header = screen.getByRole('button', { name: /^Bankdrücken 1/ });
    const info = screen.getByRole('button', { name: 'Informationen zu Bankdrücken' });
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(header.contains(info)).toBe(false);
    expect(document.querySelector('button button')).toBeNull();
    const completed = screen.getByRole('checkbox', { name: /Satz 1/ });
    const incomplete = screen.getByRole('checkbox', { name: /Satz 2/ });
    await user.click(info);
    const dialog = screen.getByRole('dialog', { name: 'Bankdrücken' });
    expect(within(dialog).getAllByRole('tab')).toHaveLength(2);
    expect(within(dialog).getByRole('tab', { name: 'Ausführung' })).toHaveAttribute('aria-selected', 'true');
    expect(within(dialog).getByText('Auf die Flachbank legen und beide Füße fest aufstellen.')).toBeVisible();
    expect(within(dialog).queryByText('Historie')).toBeNull();
    await user.click(within(dialog).getByRole('tab', { name: 'Muskelgruppen' }));
    for (const label of ['Primär', 'Sekundär', 'Brustmuskulatur', 'Trizeps', 'Vordere Schultern']) {
      expect(within(dialog).getByText(label)).toBeVisible();
    }
    expect(within(dialog).getByRole('img', { name: /Schematische Muskelübersicht/ })).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Übungsdetails schließen' }));
    await waitFor(() => expect(info).toHaveFocus());
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(completed).toHaveAttribute('aria-checked', 'true');
    expect(incomplete).toHaveAttribute('aria-checked', 'false');
    expect(toggle).not.toHaveBeenCalled();
    expect(rest).not.toHaveBeenCalled();
  });

  it('opens the corresponding exercise, resets the tab on reopen, and leaves collapsed cards collapsed', async () => {
    const { user } = mount();
    await user.click(screen.getByRole('button', { name: 'Informationen zu Bankdrücken' }));
    await user.click(screen.getByRole('tab', { name: 'Muskelgruppen' }));
    await user.keyboard('{Escape}');
    const info = screen.getByRole('button', { name: 'Informationen zu Plank' });
    const header = screen.getByRole('button', { name: /^Plank 1/ });
    await user.click(info);
    expect(screen.getByRole('dialog', { name: 'Plank' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Ausführung' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Zum Beenden die Knie kontrolliert absetzen.')).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Muskelgruppen' }));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(info).toHaveFocus());
    expect(header).toHaveAttribute('aria-expanded', 'false');
    await user.click(info);
    expect(screen.getByRole('tab', { name: 'Ausführung' })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps unsupported exercises accessible in both tabs without showing a similar exercise', async () => {
    const { user } = mount();
    await user.click(screen.getByRole('button', { name: 'Informationen zu Bankdrücken enger Griff' }));
    const dialog = screen.getByRole('dialog', { name: 'Bankdrücken enger Griff' });
    expect(within(dialog).getByText(/noch keine Detailinformationen/)).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Muskelgruppen' }));
    expect(within(dialog).getByText(/noch keine Detailinformationen/)).toBeVisible();
    expect(within(dialog).queryByText('Brustmuskulatur')).toBeNull();
    expect(within(dialog).queryByRole('img')).toBeNull();
  });

  it('supports keyboard entry, arrow-key tabs, a reachable panel, focus trapping and Escape restoration', async () => {
    const { user } = mount();
    const info = screen.getByRole('button', { name: 'Informationen zu Bankdrücken' });
    info.focus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Bankdrücken' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    screen.getByRole('tab', { name: 'Ausführung' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Muskelgruppen' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Muskelgruppen' })).toHaveAttribute('aria-selected', 'true');
    await user.tab();
    expect(screen.getByRole('tabpanel')).toHaveFocus();
    for (let i = 0; i < 6; i++) {
      await user.tab({ shift: i % 2 === 0 });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.keyboard('{Escape}');
    await waitFor(() => expect(info).toHaveFocus());
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
