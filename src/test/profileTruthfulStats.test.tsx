import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';

/*
  UI02-08 truthfulness regression.

  The Profile screen used to state two things it had no way of knowing.

  1. Streak / Gesamtzeit / Kcal were rendered from a `userStats` state that no
     backend ever wrote to — the get_user_stats RPC was removed during the
     migration and the fetch effect assigned `const data = null`. Every user
     therefore read "0 Tage", "0 Min" and "0" as if those were measured results
     rather than "no data source".

  2. A "Pro Mitglied" badge was rendered from `const isPro = true`. The app has
     no subscription state anywhere, so the claim was invented.

  The real ProfileView is mounted here; only the auth user and the heavy
  sibling cards are fixtures. Assertions are semantic — what a user can read on
  the screen — never Tailwind classes, so a later restyle does not fail them.
*/

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'u1', id: 'u1' } }) }));
vi.mock('@/components/AIAnalyticsCard', () => ({ AIAnalyticsCard: () => null }));
vi.mock('@/components/profile/NotificationSettingsCard', () => ({ NotificationSettingsCard: () => null }));
vi.mock('@/components/LogoutButton', () => ({ LogoutButton: () => null }));
vi.mock('@/components/DeleteAccountButton', () => ({ DeleteAccountButton: () => null }));

import ProfileView from '@/views/ProfileView';
import { ThemeProvider } from '@/hooks/useTheme';
import { PreferencesProvider } from '@/contexts/PreferencesContext';
import type { Profile } from '@/hooks/queries/useProfile';

const baseProfile: Profile = {
  id: 'u1',
  full_name: 'Alex Beispiel',
  email: 'alex@example.com',
  weight: 80,
  height: 180,
  age: 30,
  created_at: '2024-03-11T08:00:00.000Z',
};

const mount = (profile: Profile | null = baseProfile, workoutProgress = { completed: 2, total: 4 }) =>
  render(
    <MemoryRouter>
      <ThemeProvider>
        <PreferencesProvider>
          <ProfileView profile={profile} onProfileUpdate={() => {}} workoutProgress={workoutProgress} />
        </PreferencesProvider>
      </ThemeProvider>
    </MemoryRouter>
  );

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Profile membership claims', () => {
  it('does not claim a Pro membership', () => {
    mount();
    expect(screen.queryByText(/Pro Mitglied/i)).not.toBeInTheDocument();
  });

  it('does not substitute an equally unbacked Free tier', () => {
    mount();
    expect(screen.queryByText(/Free Plan/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bFree\b/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bPremium Mitglied\b/i)).not.toBeInTheDocument();
  });

  it('still shows the membership fact it does know: the year from created_at', () => {
    mount();
    expect(screen.getByText('Mitglied seit 2024')).toBeInTheDocument();
  });

  it('marks the member-since year unknown rather than guessing when created_at is absent', () => {
    mount({ ...baseProfile, created_at: null });
    expect(screen.getByText('Mitglied seit --')).toBeInTheDocument();
    expect(screen.queryByText(/Mitglied seit \d{4}/)).not.toBeInTheDocument();
  });
});

describe('Profile activity stats without a data source', () => {
  it('renders no streak, total-time or calorie figures at all', () => {
    mount();
    for (const label of ['Streak', 'Gesamtzeit', 'Kcal']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it('never presents an unavailable metric as a measured zero', () => {
    mount();
    expect(screen.queryByText(/^\s*0 Tage\s*$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^\s*0 Tag\s*$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^\s*0 Min\s*$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+\s*(Tage|Tag)\b/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+\s*Min\b/)).not.toBeInTheDocument();
  });

  it('keeps the weekly ring, the one figure backed by real input', () => {
    mount(baseProfile, { completed: 2, total: 4 });
    const section = screen.getByText('Training & Fortschritt').closest('section');
    expect(section).not.toBeNull();
    expect(within(section as HTMLElement).getByText('2/4')).toBeInTheDocument();
    expect(within(section as HTMLElement).getByText('Wochenziel')).toBeInTheDocument();
  });
});

describe('Profile keeps its truthful content and controls', () => {
  it('renders the stored name and body data', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Alex Beispiel' })).toBeInTheDocument();
    expect(screen.getByText('Körperdaten')).toBeInTheDocument();
    for (const label of ['Gewicht', 'Größe', 'Alter', 'BMI']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('80')).toBeInTheDocument();
    expect(screen.getByText('180')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
  });

  it('keeps the goals, training and appearance controls reachable', () => {
    mount();
    expect(screen.getByText('Ernährung & Ziele')).toBeInTheDocument();
    expect(screen.getByText('Erscheinungsbild')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Hintergrund' })).toBeInTheDocument();
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
  });
});
