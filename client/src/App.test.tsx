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

const tagged = (): Photo[] => [
    { src: '/images/zoo.jpg', width: 100, height: 50, tags: ['Zoo'], year: 2015 },
    { src: '/images/forest.jpg', width: 100, height: 50, tags: ['Forest'], year: 2018, monochrome: true },
    { src: '/images/city.jpg', width: 100, height: 50, year: 2018 },
];

const shownPhotos = () =>
    [...document.querySelectorAll('.gallery img')].map((img) => img.getAttribute('src'));

test('filters the gallery by tag and keeps the selection in the URL', async () => {
    window.history.replaceState(null, '', '/');
    current = tagged();
    render(<App />);
    expect(shownPhotos()).toHaveLength(3);

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Zoo' })));
    expect(shownPhotos()).toEqual(['/images/zoo.jpg']);
    expect(window.location.search).toBe('?tag=zoo');
    // No zoo photo is from 2018, so that year cannot be combined with it
    expect(screen.getByRole('button', { name: '2018' })).toHaveProperty('disabled', true);

    // Selecting the active tag again clears it
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Zoo' })));
    expect(shownPhotos()).toHaveLength(3);
    expect(window.location.search).toBe('');
});

test('restores the filter from the URL and follows Back', async () => {
    window.history.replaceState(null, '', '/?year=2018&bw');
    current = tagged();
    render(<App />);
    expect(shownPhotos()).toEqual(['/images/forest.jpg']);

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'all' })));
    expect(shownPhotos()).toHaveLength(3);

    await act(async () => {
        window.history.back();
        await new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }));
    });
    expect(shownPhotos()).toEqual(['/images/forest.jpg']);
});

test('ignores a filter for a tag no photo has', async () => {
    window.history.replaceState(null, '', '/?tag=beach');
    current = tagged();
    render(<App />);
    expect(shownPhotos()).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'all' })).toHaveProperty('ariaPressed', 'true');
    expect(screen.getByRole('button', { name: '2018' })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: 'black & white' })).toHaveProperty('disabled', false);
});

test('the lightbox only pages through the filtered photos', async () => {
    window.history.replaceState(null, '', '/?year=2018');
    current = tagged();
    render(<App />);
    await act(async () => {
        fireEvent.click(document.querySelectorAll('.gallery img')[0]);
    });
    const slides = () =>
        [...document.querySelectorAll('.yarl__slide img')].map((img) => img.getAttribute('src'));
    expect(slides()).not.toContain('/images/zoo.jpg');
});
