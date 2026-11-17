import { describe, it, expect } from 'vitest';
import { buildItemSearchParams, cleanAttributeFilters } from './itemSearch';

const defaults = {
  distance: 'all',
  category: 'all',
  sort: 'newest',
  search: '',
  minPrice: '',
  maxPrice: '',
  condition: 'all',
  brand: '',
  size: '',
  minRating: '',
  attributes: {},
};

describe('buildItemSearchParams', () => {
  it('returns null when only default filters are active', () => {
    expect(buildItemSearchParams(defaults, { lat: 6.5, lng: 3.4 })).toBeNull();
  });

  it('maps search and advanced filters to API parameters', () => {
    expect(buildItemSearchParams({
      ...defaults,
      search: ' blue widget ',
      category: 'electronics',
      minPrice: '0',
      maxPrice: '25000',
      condition: 'new',
      brand: 'Acme',
      size: 'M',
      minRating: 4.5,
      attributes: { Storage: ' 256GB ', Color: ' ' },
      sort: 'relevance',
    }, null)).toEqual({
      limit: 100,
      page: 1,
      sort: 'relevance',
      search: 'blue widget',
      category: 'electronics',
      min_price: '0',
      max_price: '25000',
      condition: 'new',
      brand: 'Acme',
      size: 'M',
      min_rating: 4.5,
      attributes: '{"Storage":"256GB"}',
    });
  });

  it('adds coordinates for distance filtering and nearest sorting', () => {
    expect(buildItemSearchParams({
      ...defaults,
      distance: 25,
    }, { lat: 6.5, lng: 3.4 })).toMatchObject({
      max_distance: 25,
      lat: 6.5,
      lng: 3.4,
    });

    expect(buildItemSearchParams({
      ...defaults,
      sort: 'nearest',
    }, { lat: 6.5, lng: 3.4 })).toMatchObject({
      sort: 'nearest',
      lat: 6.5,
      lng: 3.4,
    });
  });
});

describe('cleanAttributeFilters', () => {
  it('trims values and drops blank fields', () => {
    expect(cleanAttributeFilters({ Brand: ' Acme ', Size: ' ' })).toEqual({ Brand: 'Acme' });
  });
});
