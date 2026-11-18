// Phone photos are 3–8 MB; we downscale to 1280px and re-encode at 0.8 JPEG
// before upload. That keeps the request small, the AI just as accurate, and
// avoids members on patchy mobile data waiting on a huge upload.
export const downscale = (file) => new Promise((resolve, reject) => {
  const img = new Image();
  const reader = new FileReader();
  reader.onload = () => { img.src = reader.result; };
  reader.onerror = () => reject(new Error('Could not read the photo'));
  img.onload = () => {
    const MAX = 1280;
    const scale = Math.min(1, MAX / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    resolve(dataUrl.split(',')[1]);
  };
  img.onerror = () => reject(new Error('That file is not a readable image'));
  reader.readAsDataURL(file);
});

export const readFileAsBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = () => reject(new Error('Could not read that file'));
  r.readAsDataURL(file);
});
