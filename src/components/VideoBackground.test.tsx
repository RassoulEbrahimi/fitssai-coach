import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VideoBackground from './VideoBackground';
import { PreferencesProvider, usePreferences } from '@/contexts/PreferencesContext';
import { ThemeProvider, useTheme } from '@/hooks/useTheme';
import { BACKGROUND_MODE_STORAGE_KEY } from '@/lib/background';

const Controls = () => {
  const { setBackgroundMode } = usePreferences();
  const { setTheme } = useTheme();
  return <>{(['static', 'animated'] as const).map(mode => <button key={mode} onClick={() => setBackgroundMode(mode)}>{mode}</button>)}{(['light', 'dark', 'system'] as const).map(theme => <button key={theme} onClick={() => setTheme(theme)}>{theme}</button>)}</>;
};
const tree = () => <ThemeProvider><PreferencesProvider><Controls /><VideoBackground /></PreferencesProvider></ThemeProvider>;
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('background media lifecycle', () => {
  it.each([null, 'static', 'broken'])('never mounts or starts media for stored %s', (value) => {
    if (value) localStorage.setItem(BACKGROUND_MODE_STORAGE_KEY, value);
    const { container } = render(tree());
    expect(container.querySelector('video, source')).toBeNull();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(container.querySelector('img')).toHaveAttribute('src', '/fitssai-coach/backgrounds/dashboard-bg-light-v1.webp');
  });
  it('does not briefly render video when storage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const { container } = render(tree());
    expect(container.querySelector('video, source')).toBeNull();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });
  it('mounts one MP4 only on selection, then removes and releases it', () => {
    const { container } = render(tree());
    click('animated');
    const video = container.querySelector('video')!;
    expect(container.querySelectorAll('video')).toHaveLength(1);
    expect(video).toHaveAttribute('src', '/fitssai-coach/video/dashboard-bg.mp4');
    expect(container.querySelector('source')).toBeNull();
    expect(video.autoplay).toBe(false);
    expect(video.loop && video.muted && video.playsInline).toBe(true);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    click('static');
    expect(video.isConnected).toBe(false);
    expect(video.hasAttribute('src')).toBe(false);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(1);
    expect(container.querySelector('video, source')).toBeNull();
  });
  it('uses actualTheme and keeps Animated identity during theme changes', () => {
    localStorage.setItem('fitssai.theme', 'dark');
    const { container } = render(tree());
    expect(container.querySelector('img')).toHaveAttribute('src', '/fitssai-coach/backgrounds/dashboard-bg-dark-v1.webp');
    expect(container.querySelector('img')).not.toHaveClass('bg-video');
    click('light');
    expect(container.querySelector('img')).toHaveAttribute('src', '/fitssai-coach/backgrounds/dashboard-bg-light-v1.webp');
    click('animated');
    const video = container.querySelector('video');
    click('dark'); click('system');
    expect(container.querySelector('video')).toBe(video);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });
  it('uses system Dark for a Static first render', () => {
    const original = window.matchMedia;
    vi.spyOn(window, 'matchMedia').mockImplementation(query => ({ ...original(query), matches: query.includes('prefers-color-scheme') }));
    const { container } = render(tree());
    expect(container.querySelector('img')).toHaveAttribute('src', '/fitssai-coach/backgrounds/dashboard-bg-dark-v1.webp');
  });
  it('honors explicit Animated even with reduced motion', () => {
    const original = window.matchMedia;
    vi.spyOn(window, 'matchMedia').mockImplementation(query => ({ ...original(query), matches: query.includes('prefers-reduced-motion') }));
    const { container } = render(tree());
    expect(container.querySelector('video')).toBeNull();
    click('animated');
    expect(container.querySelector('video')).not.toBeNull();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });
  it.each(['reject', 'error', 'throw'])('falls back for playback %s without changing the saved choice', async (failure) => {
    if (failure === 'reject') vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error('blocked'));
    if (failure === 'throw') vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(() => { throw new Error('blocked'); });
    localStorage.setItem(BACKGROUND_MODE_STORAGE_KEY, 'animated');
    localStorage.setItem('fitssai.theme', 'dark');
    const { container } = render(tree());
    if (failure === 'error') fireEvent.error(container.querySelector('video')!);
    await waitFor(() => expect(container.querySelector('video')).toBeNull());
    expect(container.querySelector('img')).toHaveAttribute('src', '/fitssai-coach/backgrounds/dashboard-bg-dark-v1.webp');
    expect(localStorage.getItem(BACKGROUND_MODE_STORAGE_KEY)).toBe('animated');
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(1);
    click('light');
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    click('static'); click('animated');
    expect(container.querySelector('video')).not.toBeNull();
  });
  it.each(['resolve', 'reject'])('ignores a late %s after rapid switching', async (settlement) => {
    let resolve!: () => void; let reject!: (reason: Error) => void;
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(() => new Promise<void>((yes, no) => { resolve = yes; reject = no; }));
    const { container, unmount } = render(tree());
    click('animated'); const old = container.querySelector('video')!;
    click('static'); click('animated'); const current = container.querySelector('video');
    await act(async () => { if (settlement === 'resolve') resolve(); else reject(new Error('aborted')); });
    expect(container.querySelector('video')).toBe(current);
    expect(old.hasAttribute('src')).toBe(false);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
    unmount();
    expect(current?.hasAttribute('src')).toBe(false);
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(2);
  });
  it('reassigns the resource safely through Strict Mode effect replay', async () => {
    localStorage.setItem(BACKGROUND_MODE_STORAGE_KEY, 'animated');
    const { container } = render(<StrictMode>{tree()}</StrictMode>);
    await act(async () => {});
    expect(container.querySelector('video')).toHaveAttribute('src', '/fitssai-coach/video/dashboard-bg.mp4');
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
  });
});
