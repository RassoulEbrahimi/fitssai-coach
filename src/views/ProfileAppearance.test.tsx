import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';

const motionPreference = vi.hoisted(() => ({ reduced: false }));
vi.mock('framer-motion', async (importOriginal) => ({
  ...await importOriginal<typeof import('framer-motion')>(),
  useReducedMotion: () => motionPreference.reduced,
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'test', id: 'test' } }) }));
vi.mock('@/components/AIAnalyticsCard', () => ({ AIAnalyticsCard: () => null }));
vi.mock('@/components/profile/NotificationSettingsCard', () => ({ NotificationSettingsCard: () => null }));
vi.mock('@/components/LogoutButton', () => ({ LogoutButton: () => null }));
vi.mock('@/components/DeleteAccountButton', () => ({ DeleteAccountButton: () => null }));

import ProfileView from './ProfileView';
import VideoBackground from '@/components/VideoBackground';
import { ThemeProvider } from '@/hooks/useTheme';
import { PreferencesProvider } from '@/contexts/PreferencesContext';
import { BACKGROUND_MODE_STORAGE_KEY } from '@/lib/background';

const mount = (workoutProgress = { completed: 0, total: 0 }) => render(<MemoryRouter><ThemeProvider><PreferencesProvider>
  <VideoBackground />
  <ProfileView profile={{ id: 'test', full_name: 'Test' }} onProfileUpdate={() => {}} workoutProgress={workoutProgress} />
</PreferencesProvider></ThemeProvider></MemoryRouter>);
beforeEach(() => {
  localStorage.clear(); motionPreference.reduced = false;
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Profile appearance', () => {
  it.each([
    ['system', 'System'], ['light', 'Hell'], ['dark', 'Dunkel'],
  ])('exposes the persisted %s choice as the only pressed theme', (value, label) => {
    localStorage.setItem('fitssai.theme', value);
    mount();
    const group = screen.getByRole('group', { name: 'Erscheinungsbild' });
    expect(within(group).getAllByRole('button')).toHaveLength(3);
    for (const name of ['System', 'Hell', 'Dunkel']) {
      expect(within(group).getByRole('button', { name })).toHaveAttribute('aria-pressed', String(name === label));
    }
    expect(within(group).getAllByRole('button', { pressed: true })).toHaveLength(1);
  });

  it('applies and persists each theme immediately, including selecting it again', async () => {
    const user = userEvent.setup();
    const mounted = mount();
    const group = screen.getByRole('group', { name: 'Erscheinungsbild' });
    expect(within(group).getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true');
    for (const [name, value, resolved] of [
      ['Dunkel', 'dark', 'dark'], ['Hell', 'light', 'light'],
      ['System', 'system', 'light'], ['System', 'system', 'light'],
    ]) {
      await user.click(within(group).getByRole('button', { name }));
      expect(within(group).getByRole('button', { name, pressed: true })).toBeInTheDocument();
      expect(within(group).getAllByRole('button', { pressed: true })).toHaveLength(1);
      expect(localStorage.getItem('fitssai.theme')).toBe(value);
      expect(document.documentElement).toHaveClass(resolved);
      expect(document.documentElement).not.toHaveClass(resolved === 'dark' ? 'light' : 'dark');
    }
    mounted.unmount();
    mount();
    expect(screen.getByRole('button', { name: 'System', pressed: true })).toBeInTheDocument();
  });

  it('uses Tab, Enter and Space to change the theme without a save step', async () => {
    const user = userEvent.setup();
    mount();
    // The three edit controls precede the three native theme buttons.
    for (let index = 0; index < 4; index++) await user.tab();
    expect(screen.getByRole('button', { name: 'System' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Hell' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Hell', pressed: true })).toHaveFocus();
    expect(localStorage.getItem('fitssai.theme')).toBe('light');
    await user.tab();
    await user.keyboard(' ');
    expect(screen.getByRole('button', { name: 'Dunkel', pressed: true })).toHaveFocus();
    expect(localStorage.getItem('fitssai.theme')).toBe('dark');
    expect(document.documentElement).toHaveClass('dark');
    expect(within(screen.getByRole('group', { name: 'Erscheinungsbild' })).getAllByRole('button', { pressed: true })).toHaveLength(1);
  });

  it('places the labeled control between theme and glass, with exactly one choice', () => {
    const { container } = mount();
    const group = screen.getByRole('radiogroup', { name: 'Hintergrund' });
    expect(group).toHaveAccessibleDescription('Statisch spart Ressourcen. Animiert zeigt das Hintergrundvideo.');
    expect(within(group).getByRole('radio', { name: 'Statisch' })).toBeChecked();
    expect(within(group).getAllByRole('radio', { checked: true })).toHaveLength(1);
    const appearance = screen.getByText('Erscheinungsbild');
    const glass = screen.getByRole('switch', { name: 'Visuelle Effekte' });
    expect(appearance.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(group.compareDocumentPosition(glass) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('video')).toBeNull();
  });
  it('supports keyboard selection and updates the shared background immediately', async () => {
    const user = userEvent.setup(); const { container } = mount();
    const staticChoice = screen.getByRole('radio', { name: 'Statisch' });
    await user.click(staticChoice);
    await user.keyboard('{ArrowRight>}');
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Animiert' })).toBeChecked());
    await user.keyboard('{/ArrowRight}');
    expect(container.querySelectorAll('video')).toHaveLength(1);
    expect(localStorage.getItem(BACKGROUND_MODE_STORAGE_KEY)).toBe('animated');
    await user.keyboard('{ArrowLeft>}');
    await waitFor(() => expect(staticChoice).toBeChecked());
    await user.keyboard('{/ArrowLeft}');
    expect(container.querySelector('video')).toBeNull();
    expect(localStorage.getItem(BACKGROUND_MODE_STORAGE_KEY)).toBe('static');
  });
  it('keeps theme and glass settings independent', async () => {
    const user = userEvent.setup(); const { container } = mount();
    await user.click(screen.getByRole('button', { name: 'Dunkel' }));
    expect(container.querySelector('.bg-still')).toHaveAttribute('src', '/fitssai-coach/backgrounds/dashboard-bg-dark-v1.webp');
    expect(localStorage.getItem('fitssai.theme')).toBe('dark');
    await user.click(screen.getByRole('switch', { name: 'Visuelle Effekte' }));
    expect(localStorage.getItem('fitssai.preferences.enableAdvancedGlass')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Statisch' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Animiert' }));
    expect(screen.getByRole('button', { name: 'Dunkel', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Visuelle Effekte' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Hell' }));
    await user.click(screen.getByRole('switch', { name: 'Visuelle Effekte' }));
    expect(screen.getByRole('radio', { name: 'Animiert' })).toBeChecked();
    expect(localStorage.getItem(BACKGROUND_MODE_STORAGE_KEY)).toBe('animated');
    expect(container.querySelectorAll('video')).toHaveLength(1);
  });

  it('explains visual effects and preserves the boolean preference through keyboard changes and remounts', async () => {
    const user = userEvent.setup();
    const mounted = mount();
    const effects = screen.getByRole('switch', { name: 'Visuelle Effekte' });
    expect(effects).toHaveAccessibleDescription('Zusätzliche Schimmereffekte in der Navigation anzeigen');
    expect(screen.getByText('Zusätzliche Schimmereffekte in der Navigation anzeigen')).toBeVisible();
    expect(effects).not.toBeChecked();
    effects.focus();
    await user.keyboard(' ');
    expect(effects).toBeChecked();
    expect(localStorage.getItem('fitssai.preferences.enableAdvancedGlass')).toBe('true');
    mounted.unmount();
    mount();
    expect(screen.getByRole('switch', { name: 'Visuelle Effekte' })).toBeChecked();
    await user.click(screen.getByText('Visuelle Effekte'));
    expect(screen.getByRole('switch', { name: 'Visuelle Effekte' })).not.toBeChecked();
    expect(localStorage.getItem('fitssai.preferences.enableAdvancedGlass')).toBe('false');
  });

  it('does not render jargon or an invented membership tier', () => {
    const { container } = mount();
    expect(container).not.toHaveTextContent(/Premium Liquid Glass|Shimmer-Effekte|Pro Mitglied|Premium Mitglied|Free Plan/i);
  });

  it('describes the weekly ring using the supplied training days', () => {
    mount({ completed: 3, total: 5 });
    expect(screen.getByRole('img', { name: 'Wochenziel: 3 von 5 Trainingstagen' })).toBeInTheDocument();
    expect(screen.getByText('3/5')).toBeVisible();
  });

  it('does not announce or display a made-up weekly total when unavailable', () => {
    mount();
    expect(screen.getByRole('img', { name: 'Wochenziel: Noch nicht verfügbar' })).toBeInTheDocument();
    expect(screen.queryByText('0/7')).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Progress|0 von 7/ })).not.toBeInTheDocument();
  });
  it('explains reduced motion while allowing explicit Animated', async () => {
    motionPreference.reduced = true;
    const user = userEvent.setup(); const { container } = mount();
    expect(screen.getByText('Reduzierte Bewegung ist aktiv. Mit ‚Animiert‘ erlaubst du das Hintergrundvideo.')).toBeInTheDocument();
    expect(container.querySelector('video')).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Animiert' }));
    expect(container.querySelector('video')).not.toBeNull();
  });
});
