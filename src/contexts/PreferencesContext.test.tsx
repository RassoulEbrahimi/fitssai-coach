import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreferencesProvider, usePreferences } from './PreferencesContext';
import { BACKGROUND_MODE_STORAGE_KEY } from '@/lib/background';
import { clearSignOutSensitiveStorage } from '@/lib/storage';

const Controls = () => {
  const { backgroundMode, setBackgroundMode } = usePreferences();
  return <><output>{backgroundMode}</output><button onClick={() => setBackgroundMode('animated')}>Animated</button><button onClick={() => setBackgroundMode('static')}>Static</button></>;
};
const mount = () => render(<PreferencesProvider><Controls /></PreferencesProvider>);
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('background device preference', () => {
  it.each([null, '', 'true', 'invalid', 'static'])('defaults %s to Static', (stored) => {
    if (stored !== null) localStorage.setItem(BACKGROUND_MODE_STORAGE_KEY, stored);
    mount();
    expect(screen.getByRole('status')).toHaveTextContent('static');
  });
  it('defaults unreadable storage to Static', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    mount();
    expect(screen.getByRole('status')).toHaveTextContent('static');
  });
  it('persists both choices through remount and sign-out', () => {
    let view = mount();
    for (const [label, value] of [['Animated', 'animated'], ['Static', 'static']]) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(localStorage.getItem(BACKGROUND_MODE_STORAGE_KEY)).toBe(value);
      clearSignOutSensitiveStorage();
      view.unmount();
      view = mount();
      expect(screen.getByRole('status')).toHaveTextContent(value);
    }
  });
  it('updates the current session when writing storage fails', () => {
    mount();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    fireEvent.click(screen.getByRole('button', { name: 'Animated' }));
    expect(screen.getByRole('status')).toHaveTextContent('animated');
    fireEvent.click(screen.getByRole('button', { name: 'Static' }));
    expect(screen.getByRole('status')).toHaveTextContent('static');
  });
  it('follows cross-tab changes, key removal and storage clear', () => {
    mount();
    for (const [key, newValue, expected] of [
      [BACKGROUND_MODE_STORAGE_KEY, 'animated', 'animated'],
      [BACKGROUND_MODE_STORAGE_KEY, null, 'static'],
      [BACKGROUND_MODE_STORAGE_KEY, 'animated', 'animated'],
      [null, null, 'static'],
      [BACKGROUND_MODE_STORAGE_KEY, 'invalid', 'static'],
    ]) {
      act(() => window.dispatchEvent(new StorageEvent('storage', { key, newValue, storageArea: localStorage })));
      expect(screen.getByRole('status')).toHaveTextContent(expected!);
    }
  });
  it('ignores unrelated and session-storage events', () => {
    mount();
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated', newValue: 'animated' })));
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: BACKGROUND_MODE_STORAGE_KEY, newValue: 'animated', storageArea: sessionStorage })));
    expect(screen.getByRole('status')).toHaveTextContent('static');
  });
});
