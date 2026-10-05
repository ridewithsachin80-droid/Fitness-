/**
 * Downscale a photo to at most 1280 px on its long side and re-encode it as
 * JPEG at 0.8 quality. Phone photos are 3–8 MB; this keeps the upload small on
 * patchy mobile data and the vision model just as accurate.
 * Same numbers as the chat's photo logging (components/AIChatLog.jsx).
 * @returns {Promise<string>} base64 JPEG, without the data: prefix
 */
export function downscaleImage(file, max = 1280) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = () => reject(new Error('Could not read the photo'));
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.8).split(',')[1]);
    };
    img.onerror = () => reject(new Error('That file is not a readable image'));
    reader.readAsDataURL(file);
  });
}
