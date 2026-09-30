"use client";

import type { ReactNode } from "react";
import { LocationProvider } from "./LocationProvider";
import { StormDataProvider } from "./StormDataProvider";
import { ThemeSync } from "./useTheme";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <LocationProvider>
      <StormDataProvider>
        <ThemeSync />
        {children}
      </StormDataProvider>
    </LocationProvider>
  );
}
