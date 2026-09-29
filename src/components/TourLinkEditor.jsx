import { useEffect, useMemo, useRef, useState } from 'react';
import { loadPannellum } from '../utils/pannellumLoader.js';
import { resolveMediaUrl } from '../utils/mediaUrl.js';
import {
  addLink,
  DIRECTION_LABELS,
  directionOf,
  effectiveLinks,
  hasExplicitLinks,
  LINK_PITCH,
  normalizeYaw,
  removeLink,
  resetLinks,
} from '../utils/panoramaTour.js';

/*
 * TourLinkEditor — 360 투어 갈래 편집기. 한 지점의 파노라마를 띄워 "어느 방향 → 어느 지점"을 잇는다.
 *
 * items: 지점 배열(배열 순서 = 이동 순서), index: 편집할 지점, onChange(nextItems)
 * 방향 고르기: 파노라마를 클릭(드래그 아님)하거나 각도(0~359°)를 직접 입력.
 *   0° = 사진 정면(카메라 앞면), 90° = 오른쪽, 180° = 뒤, 270° = 왼쪽.
 * 처음 편집하는 지점은 자동 앞·뒤 화살표가 직접 링크로 굳는다 — 기존 화살표가 사라지지 않는다.
 */

const ARRIVE_OPTIONS = [
  { value: 0, label: '정면' },
  { value: 90, label: '오른쪽' },
  { value: 180, label: '뒤' },
  { value: 270, label: '왼쪽' },
];

function pointName(item, index) {
  return (item?.label && String(item.label).trim()) || `지점 ${index + 1}`;
}

export default function TourLinkEditor({ items, index, onChange, disabled = false }) {
  const item = items[index];
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const hotspotIdsRef = useRef([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [picked, setPicked] = useState(null); // { yaw, pitch }
  const [manualYaw, setManualYaw] = useState('');
  const [targetId, setTargetId] = useState('');
  const [arrive, setArrive] = useState(0);
  const [reciprocal, setReciprocal] = useState(true);

  const links = useMemo(() => effectiveLinks(items, index), [items, index]);
  const explicit = hasExplicitLinks(item);
  const others = items.map((other, i) => ({ other, i })).filter(({ i }) => i !== index);
  const imageKey = item?.previewUrl || item?.src || '';

  // 파노라마 뷰어 — 사진이 바뀔 때만 새로 만든다
  useEffect(() => {
    if (!containerRef.current || !imageKey) return undefined;
    let cancelled = false;
    let down = null;
    const container = containerRef.current;
    setStatus('loading');

    const onDown = (event) => {
      down = { x: event.clientX, y: event.clientY };
    };
    const onUp = (event) => {
      if (!down || !viewerRef.current) return;
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      down = null;
      if (moved > 5) return; // 드래그(둘러보기)는 선택이 아니다
      if (event.target.closest?.('.pnlm-controls-container, .pnlm-hotspot-base')) return;
      let coords;
      try {
        coords = viewerRef.current.mouseEventToCoords(event);
      } catch {
        return;
      }
      if (!coords || !Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) return;
      setPicked({ pitch: Math.max(-60, Math.min(60, Math.round(coords[0]))), yaw: Math.round(normalizeYaw(coords[1])) });
    };

    Promise.all([loadPannellum(), item.previewUrl ? Promise.resolve(item.previewUrl) : resolveMediaUrl(item.src)])
      .then(([pannellum, url]) => {
        if (cancelled || !containerRef.current) return;
        if (!url) {
          setStatus('error');
          return;
        }
        viewerRef.current = pannellum.viewer(container, {
          type: 'equirectangular',
          panorama: url,
          autoLoad: true,
          showControls: true,
          showZoomCtrl: true,
          showFullscreenCtrl: false,
          compass: false,
          hfov: 100,
          yaw: 0,
          pitch: 0,
        });
        viewerRef.current.on('load', () => !cancelled && setStatus('ready'));
        viewerRef.current.on('error', () => !cancelled && setStatus('error'));
        container.addEventListener('pointerdown', onDown);
        container.addEventListener('pointerup', onUp);
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
      container.removeEventListener('pointerdown', onDown);
      container.removeEventListener('pointerup', onUp);
      hotspotIdsRef.current = [];
      if (viewerRef.current) {
        try {
          viewerRef.current.destroy();
        } catch {
          // ignore
        }
        viewerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageKey]);

  // 링크·선택 지점을 핫스팟으로 동기화 (뷰어는 다시 만들지 않는다)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || status !== 'ready') return;
    hotspotIdsRef.current.forEach((id) => {
      try {
        viewer.removeHotSpot(id);
      } catch {
        // ignore
      }
    });
    const ids = [];
    links.forEach((link, i) => {
      const id = `link-${i}`;
      const target = items.findIndex((other) => other.id === link.to);
      viewer.addHotSpot({
        id,
        type: 'info',
        yaw: link.yaw,
        pitch: link.pitch,
        text: `→ ${pointName(items[target], target)}`,
        cssClass: `tour-arrow tour-arrow-${directionOf(link.yaw)}`,
      });
      ids.push(id);
    });
    if (picked) {
      viewer.addHotSpot({ id: 'pick', type: 'info', yaw: picked.yaw, pitch: picked.pitch, text: '여기로 화살표', cssClass: 'tour-pick-marker' });
      ids.push('pick');
    }
    hotspotIdsRef.current = ids;
  }, [links, picked, status, items]);

  if (!item) return null;

  const applyManualYaw = () => {
    const value = Number(manualYaw);
    if (manualYaw === '' || !Number.isFinite(value)) return;
    const yaw = Math.round(normalizeYaw(value));
    setPicked({ yaw, pitch: LINK_PITCH });
    if (viewerRef.current) {
      try {
        viewerRef.current.lookAt(0, yaw > 180 ? yaw - 360 : yaw, 100, 600);
      } catch {
        // ignore
      }
    }
  };

  const handleAdd = () => {
    if (!picked || !targetId) return;
    onChange(addLink(items, item.id, { to: targetId, yaw: picked.yaw, pitch: picked.pitch, targetYaw: arrive }, { reciprocal }));
    setPicked(null);
    setManualYaw('');
    setTargetId('');
  };

  return (
    <div className="tour-link-editor">
      <div className="tour-link-head">
        <strong>{pointName(item, index)} — 화살표 편집</strong>
        <span>{explicit ? '직접 연결' : '자동 연결(찍은 순서)'} · 화살표 {links.length}개</span>
      </div>

      <div className="tour-link-canvas-wrap">
        <div ref={containerRef} className="tour-link-canvas" aria-label={`${pointName(item, index)} 파노라마 — 클릭해 화살표 방향 선택`} />
        {status === 'loading' && <div className="viewer-status-overlay">파노라마를 불러오는 중입니다.</div>}
        {status === 'error' && <div className="viewer-status-overlay">파노라마를 표시할 수 없습니다. 아래 각도 입력으로 방향을 정할 수 있습니다.</div>}
      </div>
      <p className="register-hint">
        화살표를 놓을 곳(문·통로)을 <strong>클릭</strong>하세요. 드래그하면 둘러보기입니다.
        각도로 넣을 수도 있습니다 — 0° 정면, 90° 오른쪽, 180° 뒤, 270° 왼쪽.
      </p>

      <div className="tour-link-form">
        <label>
          방향(°)
          <input
            type="number"
            name="tourLinkYaw"
            min="0"
            max="359"
            step="1"
            value={manualYaw}
            placeholder={picked ? String(picked.yaw) : '예: 90'}
            disabled={disabled}
            onChange={(event) => setManualYaw(event.target.value)}
            onBlur={applyManualYaw}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applyManualYaw();
              }
            }}
          />
        </label>
        <label>
          이동할 지점
          <select name="tourLinkTarget" value={targetId} disabled={disabled} onChange={(event) => setTargetId(event.target.value)}>
            <option value="">선택</option>
            {others.map(({ other, i }) => (
              <option key={other.id} value={other.id}>
                {i + 1}. {pointName(other, i)}
              </option>
            ))}
          </select>
        </label>
        <label>
          도착했을 때 시선
          <select name="tourLinkArrive" value={arrive} disabled={disabled} onChange={(event) => setArrive(Number(event.target.value))}>
            {ARRIVE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="tour-link-check">
          <input type="checkbox" name="tourLinkReciprocal" checked={reciprocal} disabled={disabled} onChange={(event) => setReciprocal(event.target.checked)} />
          돌아오는 화살표도 추가
        </label>
        <button type="button" className="tour-link-add" disabled={disabled || !picked || !targetId} onClick={handleAdd}>
          화살표 추가
        </button>
      </div>
      {picked && (
        <p className="register-hint">
          선택한 방향: <strong>{picked.yaw}°</strong> ({DIRECTION_LABELS[directionOf(picked.yaw)]}) — 이동할 지점을 고르고 “화살표 추가”를 누르세요.
        </p>
      )}

      {links.length > 0 ? (
        <ul className="tour-link-list" aria-label="이 지점의 화살표">
          {links.map((link, i) => {
            const target = items.findIndex((other) => other.id === link.to);
            return (
              <li key={`${link.to}-${i}`}>
                <span className={`tour-link-dir tour-link-dir-${directionOf(link.yaw)}`}>{DIRECTION_LABELS[directionOf(link.yaw)]} {link.yaw}°</span>
                <strong>→ {target + 1}. {pointName(items[target], target)}</strong>
                <em>도착 시선 {ARRIVE_OPTIONS.find((o) => o.value === link.targetYaw)?.label ?? `${link.targetYaw}°`}</em>
                <button type="button" className="pano-remove" disabled={disabled} aria-label="화살표 삭제" onClick={() => onChange(removeLink(items, item.id, i))}>
                  삭제
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="register-hint">이 지점에는 화살표가 없습니다. 지점 버튼으로만 이동할 수 있습니다.</p>
      )}

      {explicit && (
        <button type="button" className="auth-text-button" disabled={disabled} onClick={() => onChange(resetLinks(items, item.id))}>
          자동 연결(찍은 순서)로 되돌리기
        </button>
      )}
    </div>
  );
}
