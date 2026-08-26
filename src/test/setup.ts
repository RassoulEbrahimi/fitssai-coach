import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

// jsdom does not implement matchMedia, and several components call it during
// render (reduced-motion checks, the system theme). Default to "no match";
// individual tests can still override it.
const stubMatchMedia = () => {
    window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
};

// cmdk observes its list container; jsdom ships no ResizeObserver.
class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}

beforeEach(() => {
    stubMatchMedia();
    if (!globalThis.ResizeObserver) {
        globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver;
    }
    if (!Element.prototype.scrollIntoView) {
        Element.prototype.scrollIntoView = () => {};
    }
});

// Runs after each test case (e.g. clearing jsdom)
afterEach(() => {
    cleanup();
});
