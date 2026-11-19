import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** Escapes text placed in a Leaflet tooltip, which takes HTML. */
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/* A Leaflet map (zoom and move, FR-11.1).  `draw(layer)` adds the markers; it runs again whenever it changes,
   so callers wrap it in useCallback.  `onBackgroundClick` fires for clicks outside every marker. */
export default function LeafletMap({ center, zoom = 17, draw, onBackgroundClick, label, height = 460 }) {
  const box = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const click = useRef(onBackgroundClick);
  click.current = onBackgroundClick;

  useEffect(() => {
    const m = L.map(box.current, { scrollWheelZoom: false }).setView(center, zoom);
    L.tileLayer(TILES, { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    m.on('click', (e) => click.current?.(e));
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    map.current?.setView(center, zoom);
  }, [center[0], center[1], zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    layer.current.clearLayers();
    draw?.(layer.current);
  }, [draw]);

  return <div ref={box} className="leaflet-box" style={{ height }} role="region" aria-label={label} />;
}
