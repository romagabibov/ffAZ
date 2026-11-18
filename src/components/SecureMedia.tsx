import React, { useEffect, useState } from "react";
import { apiFetch } from "../lib/apiClient";
import { useAuth } from "../context/AuthContext";
export function usePrivateMediaUrl(src: string | undefined) {
  const { currentUser } = useAuth();
  const uid = currentUser?.uid;
  const privateFile = Boolean(src && /^\/api\/media\/[a-f0-9]{64}$/.test(src));
  const [value, setValue] = useState<{ src?: string; uid?: string; url: string }>();
  useEffect(() => {
    if (!privateFile || !src || !uid) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    apiFetch(src, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setValue({ src, uid, url: objectUrl });
      })
      .catch(() => {});
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, uid, privateFile]);
  return privateFile ? (value && value.src === src && value.uid === uid ? value.url : undefined) : src;
}
export function SecureImage({
  src,
  ...props
}: React.ComponentPropsWithRef<"img">) {
  const resolved = usePrivateMediaUrl(src);
  return <img {...props} src={resolved} />;
}
export function SecureAudio({
  src,
  ...props
}: React.ComponentPropsWithRef<"audio">) {
  const resolved = usePrivateMediaUrl(src);
  return <audio {...props} src={resolved} />;
}
export function SecureVideo({
  src,
  ...props
}: React.ComponentPropsWithRef<"video">) {
  const resolved = usePrivateMediaUrl(src);
  return <video {...props} src={resolved} />;
}
export function SecureLink({
  href,
  children,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const resolved = usePrivateMediaUrl(href);
  return (
    <a {...props} href={resolved} rel="noopener noreferrer">
      {children}
    </a>
  );
}
