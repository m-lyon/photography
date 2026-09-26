import { act, renderHook } from '@testing-library/react';
import axios from 'axios';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { useGetPhotos, type Photo } from './useGetPhotos.tsx';

const photo = (variantsReady: boolean): Photo => ({
    src: '/images/a.jpg',
    width: 100,
    height: 50,
    variantsReady,
});

let get: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    get = vi.spyOn(axios, 'get');
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

test('keeps polling while a photo is still generating its variants', async () => {
    get.mockResolvedValueOnce({ data: [photo(false)] }).mockResolvedValue({ data: [photo(true)] });

    const { result } = renderHook(() => useGetPhotos());
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current).toHaveLength(1);

    await act(() => vi.advanceTimersByTimeAsync(20000));
    expect(get).toHaveBeenCalledTimes(2);

    // Ready now, so no further polling
    await act(() => vi.advanceTimersByTimeAsync(60000));
    expect(get).toHaveBeenCalledTimes(2);
});

test('keeps retrying with a capped backoff while the request fails', async () => {
    get.mockRejectedValue(new Error('offline'));

    renderHook(() => useGetPhotos());
    await act(() => vi.advanceTimersByTimeAsync(10 * 60 * 1000));
    const calls = get.mock.calls.length;
    expect(calls).toBeGreaterThan(11);

    // Still retrying, so a long outage recovers without a reload
    await act(() => vi.advanceTimersByTimeAsync(10 * 60 * 1000));
    expect(get.mock.calls.length).toBeGreaterThan(calls);
});

test('schedules no further fetch after unmount', async () => {
    get.mockResolvedValue({ data: [photo(false)] });

    const { unmount } = renderHook(() => useGetPhotos());
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(get).toHaveBeenCalledTimes(1);
    unmount();

    await act(() => vi.advanceTimersByTimeAsync(60000));
    expect(get).toHaveBeenCalledTimes(1);
});
