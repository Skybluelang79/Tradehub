export function cleanAttributeFilters(attributes) {
  return Object.fromEntries(
    Object.entries(attributes || {})
      .map(([name, value]) => [name, String(value ?? '').trim()])
      .filter(([, value]) => value)
  );
}

export function buildItemSearchParams(filters, userLocation) {
  const attributes = cleanAttributeFilters(filters.attributes);
  const hasServerFilters = Boolean(
    filters.search ||
    filters.category !== 'all' ||
    filters.minPrice !== '' ||
    filters.maxPrice !== '' ||
    (filters.condition && filters.condition !== 'all') ||
    filters.brand ||
    filters.size ||
    filters.minRating !== '' ||
    Object.keys(attributes).length ||
    filters.distance !== 'all' ||
    filters.sort !== 'newest'
  );

  if (!hasServerFilters) return null;

  const params = { limit: 100, page: 1, sort: filters.sort || 'newest' };
  if (filters.search) params.search = String(filters.search).trim();
  if (filters.category !== 'all') params.category = filters.category;
  if (filters.minPrice !== '') params.min_price = filters.minPrice;
  if (filters.maxPrice !== '') params.max_price = filters.maxPrice;
  if (filters.condition && filters.condition !== 'all') params.condition = filters.condition;
  if (filters.brand) params.brand = String(filters.brand).trim();
  if (filters.size) params.size = String(filters.size).trim();
  if (filters.minRating !== '') params.min_rating = filters.minRating;
  if (Object.keys(attributes).length) params.attributes = JSON.stringify(attributes);

  const nearest = filters.sort === 'nearest';
  if (filters.distance !== 'all') {
    const distance = Number(filters.distance);
    if (Number.isFinite(distance)) params.max_distance = distance;
  }
  if (
    (filters.distance !== 'all' || nearest) &&
    userLocation &&
    userLocation.lat != null &&
    userLocation.lng != null
  ) {
    params.lat = userLocation.lat;
    params.lng = userLocation.lng;
  }
  return params;
}
