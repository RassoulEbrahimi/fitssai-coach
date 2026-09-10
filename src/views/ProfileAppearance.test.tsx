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

const mount = () => render(<MemoryRouter><ThemeProvider><PreferencesProvider>
  <VideoBackground />
  <ProfileView profile={{ id: 'test', full_name: 'Test' }} onProfileUpdate={() => {}} workoutProgress={{ completed: 0, total: 0 }} />
</PreferencesProvider></ThemeProvider></MemoryRouter>);
beforeEach(() => {
  localStorage.clear(); motionPreference.reduced = false;
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Profile appearance', () => {
  it('places the labeled control between theme and glass, with exactly one choice', () => {
    const { container } = mount();
    const group = screen.getByRole('radiogroup', { name: 'Hintergrund' });
    expect(group).toHaveAccessibleDescription('Statisch spart Ressourcen. Animiert zeigt das Hintergrundvideo.');
    expect(within(group).getByRole('radio', { name: 'Statisch' })).toBeChecked();
    expect(within(group).getAllByRole('radio', { checked: true })).toHaveLength(1);
    const appearance = screen.getByText('Erscheinungsbild');
    const glass = screen.getByRole('switch', { name: 'Premium Liquid Glass' });
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
    await user.click(screen.getByRole('switch', { name: 'Premium Liquid Glass' }));
    expect(localStorage.getItem('fitssai.preferences.enableAdvancedGlass')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Statisch' })).toBeChecked();
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
