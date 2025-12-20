export const isElementVisible = (element: HTMLElement): boolean => {
    const rect = element.getBoundingClientRect();
    const windowHeight = window.innerHeight || document.documentElement.clientHeight;
    const windowWidth = window.innerWidth || document.documentElement.clientWidth;

    return (
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= windowHeight &&
        rect.right <= windowWidth
    );
};

export const parseHashQuery = () => {
    const hash = window.location.hash;
    const match = hash.match(/[#/?]workout\?(.+)/);
    if (!match) return {
        w: null,
        d: null
    };
    const params = new URLSearchParams(match[1]);
    const w = params.get('w');
    const d = params.get('d');
    return {
        w: w && /^[1-9][0-9]*$/.test(w) ? parseInt(w) : null,
        d: d && /^[0-6]$/.test(d) ? parseInt(d) : null
    };
};

export const updateHash = (weekNum: number, dayIndex: number) => {
    const newHash = `#/workout?w=${weekNum}&d=${dayIndex}`;
    if (window.location.hash !== newHash) {
        history.replaceState(null, '', newHash);
    }
};
