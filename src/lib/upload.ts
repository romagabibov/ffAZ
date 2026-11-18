import { optimizeImage } from "./imageOptimizer";
import DOMPurify from "dompurify";
import { apiFetch } from "./apiClient";
import { auth } from "./firebase";
import { isIdentityPhoto, maxIdentityPhotoBytes } from "./identityPolicy";
import i18n from "../i18n";
export type UploadStage = "optimizing" | "uploading" | "ready" | "error";
export type UploadPurpose =
  | "avatar"
  | "post"
  | "other"
  | "id_document"
  | "verification_photo"
  | "cv"
  | "chat";
export async function uploadMediaFile(
  file: File,
  onProgress?: (stage: UploadStage, progress: number) => void,
  purpose: UploadPurpose = "other",
): Promise<string> {
  if (!auth.currentUser) throw new Error("Войди в аккаунт перед загрузкой");
  const identityPhoto = isIdentityPhoto(purpose);
  if (identityPhoto && !/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error(i18n.t("identity_upload_format"));
  if (file.size > 50 * 1024 * 1024)
    throw new Error("Максимальный размер файла — 50 МБ");
  if (
    !/^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm|quicktime)|audio\/(webm|mp3|mpeg|wav|ogg|mp4)|application\/pdf)$/.test(
      file.type.split(";")[0],
    )
  )
    throw new Error("Этот формат файла не поддерживается");
  if (file.type.startsWith("image/") && file.type !== "image/gif") {
    onProgress?.("optimizing", 15);
    file = await optimizeImage(file, {
      maxWidth: identityPhoto ? 2200 : 1600,
      maxHeight: identityPhoto ? 2200 : 1600,
      quality: identityPhoto ? 0.9 : 0.8,
      maxFileSizeKB: identityPhoto ? 1100 : 300,
      preferWebP: true,
    });
  }
  if (identityPhoto) {
    if (file.size > maxIdentityPhotoBytes) throw new Error(i18n.t("identity_upload_size"));
    const photo = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(i18n.t("identity_upload_error")));
      reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
      reader.readAsDataURL(file);
    });
    onProgress?.("uploading", 30);
    const response = await apiFetch("/api/media/identity", { method: "POST", body: JSON.stringify({ purpose, photo }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !/^\/api\/media\/[a-f0-9]{64}$/.test(result.url || "")) throw new Error(i18n.t("identity_upload_error"));
    onProgress?.("ready", 100);
    return result.url;
  }
  const resourceType = file.type.startsWith("image/")
    ? "image"
    : file.type.startsWith("video/") || file.type.startsWith("audio/")
      ? "video"
      : "raw";
  const prepare = await apiFetch("/api/media/prepare", {
    method: "POST",
    body: JSON.stringify({ purpose, resourceType }),
  });
  const config = await prepare.json();
  if (!prepare.ok) throw new Error(config.error || "Загрузка недоступна");
  const form = new FormData();
  for (const [key, value] of Object.entries(config.fields))
    form.append(key, String(value));
  form.append("file", file);
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", config.uploadUrl);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        onProgress?.("uploading", Math.round((e.loaded / e.total) * 95));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error("Не удалось загрузить файл"));
    };
    xhr.onerror = () => reject(new Error("Проверь подключение к интернету"));
    xhr.ontimeout = () =>
      reject(new Error("Загрузка заняла слишком много времени"));
    xhr.timeout = 180000;
    xhr.send(form);
  });
  const complete = await apiFetch("/api/media/complete", {
      method: "POST",
      body: JSON.stringify({
        publicId: config.publicId,
        resourceType,
        deliveryType: config.fields.type,
      }),
    }),
    result = await complete.json();
  if (!complete.ok) throw new Error(result.error || "Файл не прошёл проверку");
  onProgress?.("ready", 100);
  return result.url;
}
export async function uploadBase64Media(
  dataUrl: string,
  purpose: UploadPurpose = "other",
): Promise<string> {
  if (!dataUrl.startsWith("data:")) return dataUrl;
  const response = await fetch(dataUrl),
    blob = await response.blob();
  return uploadMediaFile(
    new File([blob], `upload.${blob.type.split("/")[1] || "bin"}`, {
      type: blob.type,
    }),
    undefined,
    purpose,
  );
}
export async function deleteMediaFile(url: string): Promise<void> {
  const response = await apiFetch("/api/delete-media", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
  if (!response.ok) throw new Error("Не удалось удалить файл");
}

export async function sanitizeAndPersistHtmlMedia(html: string) {
  let output = html;
  const urls = [...new Set(html.match(/data:(?:image|video)\/[^"']+/g) || [])];
  for (const item of urls) {
    const uploaded = await uploadBase64Media(item, "post");
    output = output.split(item).join(uploaded);
  }
  return DOMPurify.sanitize(output, { USE_PROFILES: { html: true } });
}
export async function uploadBatchMediaFiles(
  files: File[],
  onProgress?: (completed: number, total: number) => void,
  purpose: UploadPurpose = "other",
) {
  const result: string[] = [];
  for (let i = 0; i < files.length; i++) {
    result.push(await uploadMediaFile(files[i], undefined, purpose));
    onProgress?.(i + 1, files.length);
  }
  return result;
}
export async function deleteMediaUrls(urls: string[]) {
  for (const url of [...new Set(urls)]) await deleteMediaFile(url);
}
export function extractAllMediaUrlsFromNews(item: any): string[] {
  if (!item) return [];
  const urls = new Set<string>();

  if (item.imageUrl && typeof item.imageUrl === "string") {
    urls.add(item.imageUrl.trim());
  }
  if (item.videoUrl && typeof item.videoUrl === "string") {
    urls.add(item.videoUrl.trim());
  }

  if (Array.isArray(item.images)) {
    item.images.forEach((img: any) => {
      if (typeof img === "string" && img.trim()) {
        urls.add(img.trim());
      } else if (img && typeof img === "object" && img.url) {
        urls.add(img.url.trim());
      }
    });
  }

  if (Array.isArray(item.videos)) {
    item.videos.forEach((vid: any) => {
      if (typeof vid === "string" && vid.trim()) {
        urls.add(vid.trim());
      } else if (vid && typeof vid === "object" && vid.url) {
        urls.add(vid.url.trim());
      }
    });
  }

  const content = item.content || item.bio || "";
  if (typeof content === "string" && content) {
    const srcRegex = /src=["']([^"']+)["']/g;
    let match;
    while ((match = srcRegex.exec(content)) !== null) {
      if (
        match[1] &&
        (match[1].includes("cloudinary.com") || match[1].includes("/uploads/"))
      ) {
        urls.add(match[1].trim());
      }
    }
  }

  return Array.from(urls);
}
