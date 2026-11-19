import { useCallback, useState } from 'react';
import L from 'leaflet';
import LeafletMap, { esc } from './LeafletMap';

/* FR-11.3: choose the building of a post on the map.  A click outside every building leaves the field empty. */
export default function BuildingPicker({ campus, buildings, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState(null);

  const draw = useCallback((layer) => {
    for (const b of buildings) {
      const chosen = String(b.id) === String(value);
      L.circleMarker([b.latitude, b.longitude], {
        radius: chosen ? 12 : 9, color: '#0a47b3', weight: 2, fillColor: chosen ? '#0f5de6' : '#ffffff', fillOpacity: 1,
        bubblingMouseEvents: false,
      })
        .bindTooltip(esc(b.name), { permanent: chosen, direction: 'top' })
        .on('click', () => {
          setMessage(null);
          onChange(String(b.id));
        })
        .addTo(layer);
    }
  }, [buildings, value, onChange]);

  if (!campus) return null;
  return (
    <div className="picker">
      <button type="button" className="map-link" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Hide the map' : 'Choose the building on the map'}
      </button>
      {open && (
        <>
          <LeafletMap center={[campus.latitude, campus.longitude]} draw={draw} height={260} label={`Buildings of the ${campus.name} campus`}
            onBackgroundClick={() => {
              onChange('');
              setMessage('Choose a building: click one of the circles.');
            }} />
          {message && <div className="field-error" role="alert">{message}</div>}
        </>
      )}
    </div>
  );
}
