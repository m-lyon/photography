import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import App from './App.tsx';
import type { Photo } from './useGetPhotos.tsx';

const photos = (variantsReady: boolean): Photo[] =>
    ['a', 'b'].map((name) => ({
        src: `/images/${name}.jpg`,
        width: 100,
        height: 50,
        variantsReady,
        ...(variantsReady ? { srcSet: [{ src: `/cache/${name}.320.webp`, width: 320, height: 160 }] } : {}),
    }));

let current: Photo[];

vi.mock('./useGetPhotos.tsx', () => ({ useGetPhotos: () => current }));

beforeEach(() => {
    current = photos(false);
    // jsdom reports a zero-width container, which makes the album render no photos
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

test('keeps the lightbox on the current slide when metadata refreshes', async () => {
    const { rerender } = render(<App />);
    await act(async () => {
        fireEvent.click(document.querySelectorAll('img')[0]);
    });
    await act(async () => {
        fireEvent.click(screen.getByLabelText('Next'));
    });
    expect(document.querySelector('.yarl__slide_current img')).toHaveProperty(
        'src',
        expect.stringContaining('b.jpg')
    );

    // A poll that gains variants replaces the slides array
    current = photos(true);
    await act(async () => rerender(<App />));
    expect(document.querySelector('.yarl__slide_current img')).toHaveProperty(
        'src',
        expect.stringContaining('b.jpg')
    );
});

test('closes the lightbox when the selected photo disappears', async () => {
    const { rerender } = render(<App />);
    await act(async () => {
        fireEvent.click(document.querySelectorAll('img')[0]);
    });
    expect(document.querySelector('.yarl__container')).not.toBeNull();

    current = [];
    await act(async () => rerender(<App />));
    expect(document.querySelector('.yarl__container')).toBeNull();

    // A stale selection would reopen it here
    current = photos(true);
    await act(async () => rerender(<App />));
    expect(document.querySelector('.yarl__container')).toBeNull();
});
