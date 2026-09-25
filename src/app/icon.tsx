import { ImageResponse } from "next/og";
import { IconArt } from "@/components/IconArt";

const SIZES = { small: 192, large: 512 } as const;

export function generateImageMetadata() {
  return Object.entries(SIZES).map(([id, size]) => ({
    id,
    size: { width: size, height: size },
    contentType: "image/png",
  }));
}

export default async function Icon({ id }: { id: Promise<string> }) {
  const size = SIZES[(await id) as keyof typeof SIZES] ?? SIZES.large;
  return new ImageResponse(<IconArt size={size} />, { width: size, height: size });
}
