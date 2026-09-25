"use client";

import type { ReactNode } from "react";
import { LocationProvider } from "./LocationProvider";
import { StormDataProvider } from "./StormDataProvider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <LocationProvider>
      <StormDataProvider>{children}</StormDataProvider>
    </LocationProvider>
  );
}
