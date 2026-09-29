import { useEffect, useRef, useState } from 'react';
import { validatePanoramaFile } from '../utils/panoramaImage.js';
import { PANORAMA_MAX_COUNT } from '../utils/panoramaTour.js';
import { resolveMediaUrl } from '../utils/mediaUrl.js';

/*
 * PanoramaUploadField — 360 투어 사진 선택·순서·라벨 편집 (등록·수정 폼 공용).
 *
 * items: [{ id, label, file?, src?, previewUrl? }]
 *   - file 이 있으면 새로 올릴 항목, src 만 있으면 이미 저장된 항목(수정 폼).
 *   - 배열 순서 = 찍은 순서 = 투어 이동 순서. 저장 시 order 로 기록된다.
 * onChange(nextItems)
 *
 * 선택 즉시 2:1 비율을 검사해 360 사진이 아닌 파일은 이유와 함께 거른다.
 * 실제 축소·업로드는 제출 시(propertyRegistration.uploadPropertyPanoramas) 한다.
 */

let idSeed = 0;
function newPanoramaId() {
  idSeed += 1;
  return `pano-${Date.now().toString(36)}${idSeed.toString(36)}`;
}

export function createPanoramaItem(file) {
  return { id: newPanoramaId(), label: '', file, previewUrl: URL.createObjectURL(file) };
}

function ExistingPreview({ src, alt }) {
  const [url, setUrl] = useState(src && !src.startsWith('idb:') ? src : '');
  useEffect(() => {
    let active = true;
    resolveMediaUrl(src).then((resolved) => {
      if (active) setUrl(resolved || '');
    });
    return () => {
      active = false;
    };
  }, [src]);
  return url ? <img src={url} alt={alt} loading="lazy" /> : <span className="pano-thumb-empty">미리보기 없음</span>;
}

export default function PanoramaUploadField({ items, onChange, disabled = false, idPrefix = 'pano' }) {
  const [rejected, setRejected] = useState([]); // [{ name, reason }]
  const [checking, setChecking] = useState(false);
  const inputRef = useRef(null);
  const remaining = Math.max(0, PANORAMA_MAX_COUNT - items.length);

  // 컴포넌트가 사라질 때 새 항목의 object URL 정리
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(
    () => () => {
      itemsRef.current.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
    },
    [],
  );

  const handleSelect = async (event) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = ''; // 같은 파일 재선택 허용
    if (files.length === 0) return;

    setChecking(true);
    const accepted = [];
    const failures = [];
    for (const file of files.slice(0, remaining)) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await validatePanoramaFile(file);
        accepted.push(createPanoramaItem(file));
      } catch (error) {
        failures.push({ name: file.name, reason: error.message });
      }
    }
    if (files.length > remaining) {
      failures.push({ name: `${files.length - remaining}장`, reason: `최대 ${PANORAMA_MAX_COUNT}장까지 등록됩니다 — 초과분은 제외했습니다.` });
    }
    setRejected(failures);
    setChecking(false);
    if (accepted.length > 0) onChange([...items, ...accepted]);
  };

  const move = (index, offset) => {
    const target = index + offset;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const remove = (index) => {
    const item = items[index];
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    onChange(items.filter((_, i) => i !== index));
  };

  const setLabel = (index, label) => {
    onChange(items.map((item, i) => (i === index ? { ...item, label } : item)));
  };

  return (
    <div className="register-360-field">
      <label htmlFor={`${idPrefix}-input`}>
        360 투어 사진 <small>(선택 — 합성된 360 JPG, 최대 {PANORAMA_MAX_COUNT}장)</small>
      </label>
      <ul className="pano-guide" aria-label="촬영 안내">
        <li>카메라 앞면을 진행 방향으로 향하게 세워 들고, 한 걸음씩 이동하며 찍으세요. 올린 순서대로 앞·뒤 화살표가 자동으로 이어집니다.</li>
        <li>Insta360 앱에서 사진을 폰으로 받으면 합성된 360 JPG 가 갤러리에 생깁니다. 그 파일을 올려주세요 (.insp 원본은 아직 지원하지 않습니다).</li>
        <li>서류·사진·얼굴이 찍히지 않게 정리한 뒤 촬영하세요. 360 사진은 방 전체가 담깁니다.</li>
      </ul>
      <input
        ref={inputRef}
        id={`${idPrefix}-input`}
        type="file"
        accept="image/jpeg,.jpg,.jpeg"
        multiple
        disabled={disabled || checking || remaining === 0}
        aria-label="360 투어 사진 선택"
        onChange={handleSelect}
      />
      {checking && <p className="register-hint">사진 크기를 확인하는 중…</p>}
      {rejected.length > 0 && (
        <ul className="pano-rejected" role="alert">
          {rejected.map((item) => (
            <li key={`${item.name}-${item.reason}`}>
              <strong>{item.name}</strong> — {item.reason}
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <ol className="pano-list" aria-label="360 투어 지점 순서">
          {items.map((item, index) => (
            <li key={item.id} className="pano-item">
              <div className="pano-thumb">
                {item.previewUrl ? (
                  <img src={item.previewUrl} alt={`지점 ${index + 1} 미리보기`} />
                ) : (
                  <ExistingPreview src={item.src} alt={`지점 ${index + 1} 미리보기`} />
                )}
                <span className="pano-order">{index + 1}</span>
              </div>
              <div className="pano-meta">
                <input
                  type="text"
                  value={item.label}
                  placeholder={`지점 ${index + 1} 이름 (예: 현관, 거실)`}
                  maxLength={20}
                  disabled={disabled}
                  aria-label={`지점 ${index + 1} 이름`}
                  onChange={(event) => setLabel(index, event.target.value)}
                />
                <small>{item.file ? `${item.file.name} · ${(item.file.size / 1024 / 1024).toFixed(1)}MB` : '저장된 사진'}</small>
              </div>
              <div className="pano-controls">
                <button type="button" disabled={disabled || index === 0} aria-label="앞으로" onClick={() => move(index, -1)}>↑</button>
                <button type="button" disabled={disabled || index === items.length - 1} aria-label="뒤로" onClick={() => move(index, 1)}>↓</button>
                <button type="button" className="pano-remove" disabled={disabled} aria-label="삭제" onClick={() => remove(index)}>×</button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="register-hint">
        {items.length}/{PANORAMA_MAX_COUNT}장 · 올리면 상세 페이지의 “360 투어” 탭에서 지점 사이를 화살표로 이동하며 볼 수 있습니다. 사진은 4096×2048 로 줄여 저장됩니다.
      </p>
    </div>
  );
}
