"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

type Props = { url: string; size?: number };

export function QrCode({ url, size = 280 }: Props) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    QRCode.toDataURL(url, {
      margin: 1,
      width: size,
      color: { dark: "#1A5380", light: "#FFFFFF" },
      errorCorrectionLevel: "M",
    }).then(setSrc);
  }, [url, size]);

  if (!src) return <div className="bg-white rounded-2xl" style={{ width: size, height: size }} />;
  return (
    <img
      src={src}
      alt="Scan om mee te doen"
      width={size}
      height={size}
      className="rounded-2xl bg-white p-2 shadow-lg"
    />
  );
}
