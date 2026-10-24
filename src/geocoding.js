const { hash, HttpError } = require('./domain');
function addressFeature(feature) {
  const p = feature.properties || {};
  const [longitude, latitude] = feature.geometry?.coordinates || [];
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  if (p.countrycode && p.countrycode.toLowerCase() !== 'ir') return null;
  const city = p.city || p.town || p.village || p.county || p.state || '';
  const street = p.street || p.name || p.district || '';
  const province = p.state || p.county || city;
  const label = [...new Set([province, city, street].filter(Boolean))].join('، ').slice(0, 300);
  if (!label) return null;
  return { id: hash(JSON.stringify([latitude, longitude, label])), latitude, longitude, province, city, street, label };
}
function createGeocoder({ redis, config }) {
  async function fetchPlaces(path, params) {
    const url = new URL(path, config.PHOTON_URL || 'https://photon.komoot.io');
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    const key = `geocode:v1:${hash(url.href)}`;
    const cached = await redis.get(key);
    if (cached) {
      const places = JSON.parse(cached);
      for (const place of places) await redis.set(`place:${place.id}`, JSON.stringify(place), 'EX', 3600);
      return places;
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'Accept-Language': 'fa', 'User-Agent': 'Khodrochare/1.0' } });
      if (!response.ok) throw new Error('Geocoder unavailable');
      const data = await response.json();
      if (!Array.isArray(data.features)) throw new Error('Invalid geocoder response');
      const places = data.features.map(addressFeature).filter(Boolean);
      await redis.set(key, JSON.stringify(places), 'EX', 900);
      for (const place of places) await redis.set(`place:${place.id}`, JSON.stringify(place), 'EX', 3600);
      return places;
    } catch { throw new HttpError(503, 'Address search unavailable'); }
  }
  async function resolve(id, point) {
    if (id) {
      const value = await redis.get(`place:${id}`);
      if (!value) throw new HttpError(400, 'Address selection expired; search again');
      return JSON.parse(value);
    }
    const places = await fetchPlaces('/reverse', { lat: point.latitude, lon: point.longitude, limit: 1 });
    if (!places.length) throw new HttpError(400, 'Street address not found');
    // Reverse geocoding names the selected point without moving it to a street centroid.
    const place = { ...places[0], ...point };
    place.id = hash(JSON.stringify([place.latitude, place.longitude, place.label]));
    return place;
  }
  return { search: query => fetchPlaces('/api', { q: query, limit: 5, countrycode: 'IR', layer: 'street' }), resolve };
}
module.exports = { createGeocoder, addressFeature };
