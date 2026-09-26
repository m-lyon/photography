import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { RenderPhotoProps } from 'react-photo-album';
import { afterEach, expect, test } from 'vitest';

import { BlurUpPhoto } from './BlurUpPhoto.tsx';
import type { Photo } from './useGetPhotos.tsx';

const photo: Photo = {
    src: '/images/a.jpg',
    width: 100,
    height: 50,
    placeholder: 'data:image/webp;base64,AAA',
};

function renderPhoto() {
    const props = {
        photo,
        imageProps: {
            src: photo.src,
            srcSet: '/images/a-400.webp 400w, /images/a-800.webp 800w',
            sizes: '(max-width: 600px) 100vw, 50vw',
            loading: 'lazy',
            alt: 'a',
            className: 'x',
            style: {},
        },
        wrapperStyle: {},
    } as unknown as RenderPhotoProps<Photo>;
    const { container } = render(<BlurUpPhoto {...props} />);
    return {
        image: screen.getByAltText('a'),
        placeholder: container.querySelector('.blur-up__placeholder')!,
    };
}

afterEach(cleanup);

test('passes responsive image attributes through to the img', () => {
    const { image } = renderPhoto();
    expect(image.getAttribute('srcset')).toBe('/images/a-400.webp 400w, /images/a-800.webp 800w');
    expect(image.getAttribute('sizes')).toBe('(max-width: 600px) 100vw, 50vw');
    expect(image.getAttribute('loading')).toBe('lazy');
});

test('hides the image behind the placeholder until it loads', () => {
    const { image, placeholder } = renderPhoto();
    expect(image.className).not.toContain('blur-up__image--loaded');
    expect(placeholder.className).not.toContain('blur-up__placeholder--hidden');

    fireEvent.load(image);
    expect(image.className).toContain('blur-up__image--loaded');
    expect(placeholder.className).toContain('blur-up__placeholder--hidden');
});

test('reveals the image even if it fails to load', () => {
    const { image, placeholder } = renderPhoto();
    fireEvent.error(image);
    expect(image.className).toContain('blur-up__image--loaded');
    expect(placeholder.className).toContain('blur-up__placeholder--hidden');
});
