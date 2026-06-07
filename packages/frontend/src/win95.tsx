import type { ReactNode } from "react";
import original from "react95/dist/themes/original";
import msSansSerif from "react95/dist/fonts/ms_sans_serif.woff2";
import msSansSerifBold from "react95/dist/fonts/ms_sans_serif_bold.woff2";
import { ThemeProvider, createGlobalStyle } from "styled-components";

/**
 * Pixel-perfect MS Sans Serif, shipped by react95. Registered globally so
 * both react95 components and Tailwind's `font-sans` resolve to it.
 */
const Win95Fonts = createGlobalStyle`
  @font-face {
    font-family: "MS Sans Serif";
    src: url("${msSansSerif}") format("woff2");
    font-weight: 400;
    font-style: normal;
  }
  @font-face {
    font-family: "MS Sans Serif";
    src: url("${msSansSerifBold}") format("woff2");
    font-weight: 700;
    font-style: normal;
  }
`;

/** react95 theme + font registration for the whole app. */
export function Win95Provider({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={original}>
      <Win95Fonts />
      {children}
    </ThemeProvider>
  );
}
