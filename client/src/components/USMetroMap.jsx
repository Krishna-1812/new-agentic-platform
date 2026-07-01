import { useState, useEffect } from 'react';
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from 'react-simple-maps';
import statesTopo from 'us-atlas/states-10m.json';

// Free, keyless US map: react-simple-maps renders state outlines from a bundled
// public-domain Census TopoJSON (us-atlas) — no tiles, no API key, zero external
// network calls (safe inside the Position2 embed). Metro markers are placed by
// centroid via geoAlbersUsa. ZoomableGroup adds scroll/drag zoom; result mode
// auto-fits the view to the selected regions so clustered comparisons aren't a blob.
//
//   mode "select"  → all metros clickable to add/remove from the comparison
//   mode "result"  → home + compared metros sized by volume, colored by Demand Index

const shortName = (name) => name.split(',')[0].split('–')[0].trim();
const US_CENTER = [-97, 38];

// Categorical color by Demand Index (home = purple, then green / amber / blue).
function indexColor(idx, isHome) {
  if (isHome) return 'var(--primary)';
  if (idx == null) return 'var(--text-3)';
  if (idx >= 120) return 'var(--success)';
  if (idx >= 80) return 'var(--warning)';
  return 'var(--info)';
}

function LegendDot({ color, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 9, height: 9, borderRadius: '50%', background: color, opacity: 0.85, border: `1.5px solid ${color}` }} />
      {label}
    </span>
  );
}

function ZoomBtn({ onClick, title, children }) {
  return (
    <button onClick={onClick} title={title}
      style={{
        width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--card)', border: '1px solid var(--border-strong)', borderRadius: 6,
        cursor: 'pointer', color: 'var(--text-2)', fontSize: 15, fontWeight: 600, lineHeight: 1, padding: 0,
        boxShadow: 'var(--shadow-sm)',
      }}>
      {children}
    </button>
  );
}

// Fit zoom/center to a set of {centroidLat,centroidLng} points (result mode).
function fitView(points) {
  if (!points.length) return { coordinates: US_CENTER, zoom: 1 };
  const lats = points.map((p) => p.centroidLat);
  const lngs = points.map((p) => p.centroidLng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const center = [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
  const lngSpan = Math.max(0.5, maxLng - minLng);
  const latSpan = Math.max(0.5, maxLat - minLat);
  // At zoom 1 the map shows ~58° lng / ~30° lat; fit with margin, clamp 1–6.
  const zoom = Math.min(6, Math.max(1, Math.min(58 / (lngSpan * 1.6), 30 / (latSpan * 1.6))));
  return { coordinates: center, zoom };
}

export default function USMetroMap({ mode = 'result', metros = [], rows = [], homeIds = [], selectedIds = [], onToggle }) {
  const [pos, setPos] = useState(mode === 'result' ? fitView(rows) : { coordinates: US_CENTER, zoom: 1 });
  const z = pos.zoom;

  // Re-fit whenever the result set changes (new comparison).
  useEffect(() => {
    if (mode === 'result') setPos(fitView(rows));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, rows]);

  const homeSet = new Set(homeIds);
  const selSet = new Set(selectedIds);
  const maxVol = mode === 'result' ? Math.max(...rows.map((r) => r.clusterVolume || 0), 1) : 1;
  const showLabels = z >= 2.5; // declutter until zoomed in

  const clampZoom = (v) => Math.min(8, Math.max(1, v));
  const zoomBy = (f) => setPos((p) => ({ ...p, zoom: clampZoom(p.zoom * f) }));
  const resetView = () => setPos(mode === 'result' ? fitView(rows) : { coordinates: US_CENTER, zoom: 1 });

  return (
    <div>
      <div style={{ position: 'relative', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 5, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <ZoomBtn onClick={() => zoomBy(1.6)} title="Zoom in">+</ZoomBtn>
          <ZoomBtn onClick={() => zoomBy(1 / 1.6)} title="Zoom out">−</ZoomBtn>
          <ZoomBtn onClick={resetView} title="Reset view">⤾</ZoomBtn>
        </div>

        <ComposableMap
          projection="geoAlbersUsa"
          width={800}
          height={460}
          projectionConfig={{ scale: 1000 }}
          style={{ width: '100%', height: 'auto', display: 'block' }}
        >
          <ZoomableGroup zoom={z} center={pos.coordinates} minZoom={1} maxZoom={8} onMoveEnd={(p) => setPos(p)}>
            <Geographies geography={statesTopo}>
              {({ geographies }) => geographies.map((geo) => (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill="var(--card)"
                  stroke="var(--border-strong)"
                  strokeWidth={0.6 / z}
                  style={{
                    default: { outline: 'none' },
                    hover: { outline: 'none', fill: 'var(--card)' },
                    pressed: { outline: 'none', fill: 'var(--card)' },
                  }}
                />
              ))}
            </Geographies>

            {/* Selection mode — every metro is a clickable dot (constant screen size) */}
            {mode === 'select' && metros.map((m) => {
              const isHome = homeSet.has(m.id);
              const isSel = selSet.has(m.id);
              const fill = isHome ? 'var(--primary)' : isSel ? 'var(--success)' : 'var(--card)';
              const stroke = isHome ? 'var(--primary)' : isSel ? 'var(--success)' : 'var(--text-3)';
              const r = (isHome ? 6.5 : isSel ? 5.5 : 3.5) / z;
              return (
                <Marker
                  key={m.id}
                  coordinates={[m.centroidLng, m.centroidLat]}
                  onClick={() => !isHome && onToggle && onToggle(m)}
                  style={{ default: { cursor: isHome ? 'default' : 'pointer' }, hover: { cursor: isHome ? 'default' : 'pointer' }, pressed: {} }}
                >
                  <circle r={r} fill={fill} fillOpacity={isHome || isSel ? 0.95 : 0.6} stroke={stroke} strokeWidth={1.5 / z} />
                  <title>{m.displayName}{isHome ? ' (home)' : isSel ? ' (selected)' : ' — click to add'}</title>
                  {(isHome || isSel || z >= 3) && (
                    <text textAnchor="middle" y={-r - 3 / z} fontSize={8 / z} fontWeight={600} fill="var(--text-2)"
                      style={{ paintOrder: 'stroke', stroke: 'var(--card)', strokeWidth: 3 / z }}>
                      {shortName(m.displayName)}
                    </text>
                  )}
                </Marker>
              );
            })}

            {/* Result mode — bubbles sized by volume, colored by Demand Index */}
            {mode === 'result' && rows.map((r) => {
              const rad = (4 + Math.sqrt((r.clusterVolume || 0) / maxVol) * 14) / z;
              const color = indexColor(r.demandIndex, r.isHome);
              const showThis = showLabels || r.isHome;
              return (
                <Marker key={r.geoId} coordinates={[r.centroidLng, r.centroidLat]}>
                  {/* soft glow */}
                  <circle r={rad * 1.7} fill={color} fillOpacity={0.1} stroke="none" />
                  <circle r={rad} fill={color} fillOpacity={0.5} stroke={color} strokeWidth={1.5 / z} />
                  <title>{r.region}: Demand Index {r.demandIndex ?? 'n/a'}</title>
                  {showThis && (
                    <>
                      <text textAnchor="middle" y={-rad - 3 / z} fontSize={8.5 / z} fontWeight={r.isHome ? 700 : 600} fill="var(--text)"
                        style={{ paintOrder: 'stroke', stroke: 'var(--card)', strokeWidth: 3 / z }}>
                        {shortName(r.region)}
                      </text>
                      {r.demandIndex != null && (
                        <text textAnchor="middle" y={3 / z} fontSize={8 / z} fontWeight={700} fill={color}
                          style={{ paintOrder: 'stroke', stroke: 'var(--card)', strokeWidth: 2.5 / z }}>
                          {r.demandIndex}
                        </text>
                      )}
                    </>
                  )}
                </Marker>
              );
            })}
          </ZoomableGroup>
        </ComposableMap>
      </div>

      <div style={{ display: 'flex', gap: 14, marginTop: 8, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-3)', alignItems: 'center' }}>
        {mode === 'select' ? (
          <>
            <LegendDot color="var(--primary)" label="Home market" />
            <LegendDot color="var(--success)" label="Selected to compare" />
            <LegendDot color="var(--text-3)" label="Available — click to add" />
            <span>· scroll or drag to explore · +/− to zoom</span>
          </>
        ) : (
          <>
            <LegendDot color="var(--primary)" label="Home (100)" />
            <LegendDot color="var(--success)" label="≥ 120" />
            <LegendDot color="var(--warning)" label="80–120" />
            <LegendDot color="var(--info)" label="< 80" />
            <span>· bubble size = search volume · scroll or drag to zoom{!showLabels ? ' in for labels' : ''}</span>
          </>
        )}
      </div>
    </div>
  );
}
