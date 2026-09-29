import { useEffect, useState } from 'react';
import { isLocalMediaRef, resolveMediaUrl } from '../utils/mediaUrl.js';

/*
 * LocalMediaImage — media.src 가 로컬 데모 저장소 참조(idb:)여도 보이는 <img>.
 * https:/data: 는 그대로, idb: 는 IndexedDB Blob 의 object URL 로 바꿔 표시한다.
 */
export default function LocalMediaImage({ src, alt, ...rest }) {
  const [url, setUrl] = useState(isLocalMediaRef(src) ? '' : src);

  useEffect(() => {
    let active = true;
    if (!isLocalMediaRef(src)) {
      setUrl(src);
      return undefined;
    }
    resolveMediaUrl(src).then((resolved) => {
      if (active) setUrl(resolved || '');
    });
    return () => {
      active = false;
    };
  }, [src]);

  if (!url) return <span className="local-media-empty" aria-label={alt}>미리보기 없음</span>;
  return <img src={url} alt={alt} {...rest} />;
}
