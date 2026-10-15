import { panoramaMediaItem } from '../utils/panoramaTour.js';

// Stage the complete selection before saving a property. A failed batch must
// never silently remove a room from a tour or a photo from an existing listing.
export async function uploadMediaSelection({ storage, prefix, photos = [], panoramas = [], processPhoto, processPanorama, onProgress }) {
  const uploaded = [];
  const media = [];
  let currentName = '';
  const save = async (bucketName, blob, name) => {
    const path = `${prefix}/${name}-${crypto.randomUUID()}.jpg`;
    const bucket = storage.from(bucketName);
    const { data, error } = await bucket.upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    if (error) throw new Error(error.message || '업로드 실패');
    uploaded.push({ bucketName, path: data?.path ?? path });
    return bucket.getPublicUrl(data?.path ?? path).data.publicUrl;
  };
  try {
    for (const [index, file] of photos.entries()) {
      currentName = file.name || `사진 ${index + 1}`;
      const { blob } = await processPhoto(file);
      media.push({ type: 'photo', src: await save('property-photos', blob, 'photo'), label: index === 0 ? '대표 사진' : `사진 ${index + 1}`, alt: `등록 사진 ${index + 1}` });
    }
    let done = 0;
    const total = panoramas.filter(item => item.file).length;
    for (const [index, item] of panoramas.entries()) {
      currentName = item.file?.name || item.label || `지점 ${index + 1}`;
      let src = item.src;
      if (item.file) {
        const { blob } = await processPanorama(item.file);
        src = await save('property-360', blob, 'pano');
        done += 1;
        onProgress?.({ done, total, label: item.label || currentName });
      }
      if (!src) throw new Error('360 사진 파일이 없습니다.');
      media.push(panoramaMediaItem({ ...item, src, order: index + 1 }));
    }
    return media;
  } catch (error) {
    // Only these new objects can be removed; existing listing media is untouched.
    const cleanup = await Promise.allSettled(['property-photos', 'property-360'].map(async bucketName => {
      const paths = uploaded.filter(item => item.bucketName === bucketName).map(item => item.path);
      if (!paths.length) return;
      const result = await storage.from(bucketName).remove(paths);
      if (result.error) throw result.error;
    }));
    const cleanupFailed = cleanup.some(result => result.status === 'rejected');
    throw new Error(`${currentName}: ${error.message || '사진 처리 실패'} 매물은 저장하지 않았습니다. 파일을 확인한 뒤 다시 시도해주세요.${cleanupFailed ? ' 일부 임시 파일 정리에 실패했습니다.' : ''}`);
  }
}
