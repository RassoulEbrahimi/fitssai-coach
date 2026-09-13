import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';

const { setDoc } = vi.hoisted(() => ({ setDoc: vi.fn().mockResolvedValue(undefined) }));
vi.mock('firebase/firestore', () => ({
  doc: (...path: unknown[]) => ({ path }),
  setDoc,
  Timestamp: { now: () => ({ __ts: true }) },
}));
vi.mock('@/lib/avatarUtils', () => ({ getAvatarUrl: () => null, uploadAvatar: vi.fn(), updateProfileAvatar: vi.fn() }));
vi.mock('@/components/AIAnalyticsCard', () => ({ AIAnalyticsCard: () => null }));
vi.mock('@/components/profile/NotificationSettingsCard', () => ({ NotificationSettingsCard: () => null }));
vi.mock('@/components/LogoutButton', () => ({ LogoutButton: () => null }));
vi.mock('@/components/DeleteAccountButton', () => ({ DeleteAccountButton: () => null }));

import ProfileView from './ProfileView';
import { ThemeProvider } from '@/hooks/useTheme';
import { PreferencesProvider } from '@/contexts/PreferencesContext';

const onProfileUpdate = vi.fn();
const mount = () => render(<MemoryRouter><ThemeProvider><PreferencesProvider>
  <ProfileView profile={{
    id: 'test', full_name: 'Alex Beispiel', age: 30, height: 180, weight: 80,
    fitness_goal: 'gainMuscle', dietary_preference: 'vegetarian',
    equipment: ['dumbbells'], daysPerWeek: 3, sessionMinutes: 45,
  }} onProfileUpdate={onProfileUpdate} workoutProgress={{ completed: 3, total: 5 }} />
</PreferencesProvider></ThemeProvider></MemoryRouter>);

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

describe('Profile edit affordances', () => {
  it('names each pencil distinctly and hides its decorative icon', () => {
    mount();
    for (const name of ['Profil bearbeiten', 'Ernährung und Ziele bearbeiten', 'Trainingsangaben bearbeiten']) {
      const button = screen.getByRole('button', { name });
      expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
    expect(screen.queryByRole('button', { name: '' })).not.toBeInTheDocument();
  });

  it('keeps the header avatar passive and opens profile editing with the first keyboard target', async () => {
    const user = userEvent.setup();
    const { container } = mount();
    await user.click(screen.getByText('AB'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Profil bearbeiten' })).toHaveFocus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Profil bearbeiten' });
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveValue('Alex Beispiel');
    const photo = within(dialog).getByRole('button', { name: 'Profilbild ändern' });
    expect(photo).toHaveFocus();
    const fileInput = container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement;
    const fileClick = vi.spyOn(fileInput, 'click');
    await user.keyboard(' ');
    expect(fileClick).toHaveBeenCalledOnce();
    fileClick.mockRestore();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('opens the goals dialog by keyboard and keeps the existing stored values on save', async () => {
    const user = userEvent.setup();
    mount();
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Ernährung und Ziele bearbeiten' })).toHaveFocus();
    await user.keyboard(' ');
    const dialog = screen.getByRole('dialog', { name: 'Ernährung und Ziele bearbeiten' });
    expect(within(dialog).getByRole('combobox', { name: 'Fitness-Ziel' })).toHaveTextContent('Muskeln aufbauen');
    expect(within(dialog).getByRole('combobox', { name: 'Ernährungsform' })).toHaveTextContent('Vegetarisch');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onProfileUpdate).toHaveBeenCalledOnce());
    expect(setDoc).toHaveBeenCalledWith(expect.objectContaining({ path: [expect.anything(), 'users', 'test'] }), {
      fitnessGoal: 'gainMuscle', dietaryPreference: 'vegetarian', updatedAt: { __ts: true },
    }, { merge: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the distinct training dialog by keyboard with the saved preferences', async () => {
    const user = userEvent.setup();
    mount();
    for (let index = 0; index < 3; index++) await user.tab();
    expect(screen.getByRole('button', { name: 'Trainingsangaben bearbeiten' })).toHaveFocus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Trainingsangaben bearbeiten' });
    expect(within(dialog).getByRole('button', { name: /Kurzhanteln/, pressed: true })).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: 'Trainingstage pro Woche' })).toHaveTextContent('3 Tage');
    expect(within(dialog).getByRole('combobox', { name: 'Gewünschte Trainingsdauer' })).toHaveTextContent('45 Minuten');
  });

  it('uses dietary preference terminology while keeping the stored value label', () => {
    mount();
    expect(screen.getByText('Ernährungsform')).toBeInTheDocument();
    expect(screen.getByText('Vegetarisch')).toBeInTheDocument();
    expect(screen.queryByText('Diät')).not.toBeInTheDocument();
  });
});
